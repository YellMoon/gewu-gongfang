/**
 * 认证路由（微信小程序登录预留）
 */
const { Router } = require('express');
const jwt = require('jsonwebtoken');
const { getInstance } = require('../database');
const { authMiddleware, JWT_SECRET } = require('../middleware/auth');
const { createAuthRateLimiter } = require('../services/authRateLimiter');
const { normalizePhone } = require('../services/authorizationPolicy');
const {
  EXPERIENCE_AUDIENCE,
  FORMAL_AUDIENCE,
  FORMAL_TOKEN_USE,
  TOKEN_ISSUER,
  UNRECOGNIZED_TOKEN_USE,
  VISITOR_TOKEN_USE,
  createMiniappIdentityService,
} = require('../services/miniappIdentityService');
const {
  resolveWechatIdentity,
  resolveWechatPhoneNumber,
} = require('../services/wechatMiniappService');

const router = Router();
const authRateLimiter = createAuthRateLimiter({
  maxAttempts: Number(process.env.MINIAPP_AUTH_RATE_LIMIT_MAX || 10),
  windowMs: Number(process.env.MINIAPP_AUTH_RATE_LIMIT_WINDOW_MS || 60_000),
});
let cachedIdentityDb = null;
let cachedIdentityService = null;

function identityServiceFor(database) {
  if (!cachedIdentityService || cachedIdentityDb !== database.db) {
    cachedIdentityDb = database.db;
    cachedIdentityService = createMiniappIdentityService({ db: database.db, jwtSecret: JWT_SECRET });
  }
  return cachedIdentityService;
}

router.get('/desktop-session', authMiddleware, (req, res) => {
  if (req.authz?.tokenUse !== 'desktop-session' || req.authz?.clientType !== 'desktop' || !req.authz?.userApproved || !req.authz?.deviceId) {
    return res.status(403).json({ success: false, code: 'TRUSTED_DESKTOP_SESSION_REQUIRED' });
  }
  res.json({ success: true, session: { userId: req.authz.userId, deviceId: req.authz.deviceId, tokenUse: req.authz.tokenUse } });
});

/**
 * POST /api/auth/wechat-login
 * 微信小程序登录
 * 
 * Body: { code: "微信登录code", phone?: "手填手机号", phoneCode?: "微信手机号动态码" }
 * Response: { token: "jwt...", user: { id, nickname, ... } }
 */
router.post('/wechat-login', async (req, res) => {
  try {
    const { code, phone, phoneCode, userInfo, miniappVersion, platform } = req.body || {};
    
    if (!code) {
      return res.status(400).json({
        success: false,
        code: 'WECHAT_LOGIN_CODE_REQUIRED',
        error: 'WeChat login code is required',
      });
    }

    if (!phoneCode && !normalizePhone(phone)) {
      return res.status(400).json({
        success: false,
        code: 'MANUAL_PHONE_REQUIRED',
        error: 'Manual phone is required',
      });
    }

    authRateLimiter.prune();
    const rateLimit = authRateLimiter.consume(req.ip || req.socket?.remoteAddress || 'unknown');
    if (!rateLimit.allowed) {
      res.setHeader('retry-after', Math.max(1, Math.ceil(rateLimit.retryAfterMs / 1000)));
      return res.status(429).json({ success: false, code: 'AUTH_RATE_LIMITED', error: 'Too many login attempts' });
    }

    const { openid, unionid } = await resolveWechatIdentity(code);
    const nickname = userInfo?.nickName || '\u7ba1\u7406\u5458';
    const avatarUrl = userInfo?.avatarUrl || null;
    const profileNickname = userInfo?.nickName ? nickname : null;
    const profile = { nickname: profileNickname, avatarUrl };

    const db = getInstance();
    let login;
    if (phoneCode) {
      let verifiedPhone;
      try {
        verifiedPhone = await resolveWechatPhoneNumber(phoneCode);
      } catch (_error) {
        const error = new Error('WeChat phone exchange failed');
        error.code = 'WECHAT_PHONE_EXCHANGE_FAILED';
        throw error;
      }
      const claimedPhone = normalizePhone(phone);
      if (claimedPhone && claimedPhone !== normalizePhone(verifiedPhone)) {
        const error = new Error('WeChat verified phone does not match the claimed phone');
        error.code = 'WECHAT_PHONE_MISMATCH';
        throw error;
      }
      login = identityServiceFor(db).loginWithVerifiedWechat({
        openid,
        unionid,
        phone: verifiedPhone,
        profile,
        miniappVersion,
        platform,
      });
    } else {
      login = identityServiceFor(db).loginWithClaimedWechat({
        openid,
        unionid,
        phone,
        profile,
        miniappVersion,
        platform,
      });
    }

    return res.json({
      success: true,
      data: {
        token: login.token,
        user: login.user,
        userId: login.user.id,
        nickname: login.user.nickname,
        avatarUrl: login.user.avatarUrl,
        role: login.user.role,
        accountState: login.user.account_state,
      }
    });
  } catch (err) {
    const code = err.code || 'MINIAPP_LOGIN_FAILED';
    if (code === 'WECHAT_BINDING_REVIEW_REQUIRED') {
      return res.status(202).json({
        success: false,
        code,
        data: err.details,
        error: 'WeChat binding review is required',
      });
    }
    const conflictCodes = new Set([
      'PHONE_WECHAT_BINDING_CONFLICT',
      'OPENID_PHONE_BINDING_CONFLICT',
      'FORMAL_IDENTITY_MAPPING_INVALID',
      'WECHAT_BINDING_REQUEST_CONFLICT',
      'WECHAT_PHONE_MISMATCH',
    ]);
    const validationCodes = new Set([
      'MANUAL_PHONE_REQUIRED',
      'MANUAL_PHONE_INVALID',
      'WECHAT_LOGIN_CODE_REQUIRED',
    ]);
    const status = conflictCodes.has(code) ? 409
      : validationCodes.has(code) ? 400
        : code === 'MINIAPP_LOGIN_DISABLED' ? 403 : 502;
    const error = conflictCodes.has(code)
      ? 'Phone and WeChat bindings conflict'
      : validationCodes.has(code)
        ? 'Miniapp login input is invalid'
      : code === 'MINIAPP_LOGIN_DISABLED'
        ? 'This account is disabled'
        : 'WeChat login verification failed';
    return res.status(status).json({ success: false, code, error });
  }
});

router.post('/refresh', (req, res) => {
  const header = String(req.headers.authorization || '');
  const headerToken = header.startsWith('Bearer ') ? header.slice(7) : '';
  const bodyToken = typeof req.body?.token === 'string' ? req.body.token : '';
  const token = bodyToken || headerToken;
  if (!token || (bodyToken && headerToken && bodyToken !== headerToken)) {
    return res.status(401).json({ success: false, code: 'TOKEN_REFRESH_REQUIRES_RELOGIN' });
  }
  try {
    const claims = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'], ignoreExpiration: true });
    const audience = claims.token_use === FORMAL_TOKEN_USE
      ? FORMAL_AUDIENCE
      : claims.token_use === VISITOR_TOKEN_USE ? FORMAL_AUDIENCE
      : claims.token_use === UNRECOGNIZED_TOKEN_USE ? EXPERIENCE_AUDIENCE : null;
    const configuredGraceSeconds = Number(process.env.MINIAPP_REFRESH_GRACE_SECONDS || 86_400);
    const graceSeconds = Number.isFinite(configuredGraceSeconds) && configuredGraceSeconds >= 0
      ? Math.min(configuredGraceSeconds, 7 * 24 * 60 * 60)
      : 86_400;
    const expiredBeyondGrace = !Number.isFinite(claims.exp)
      || Math.floor(Date.now() / 1000) > claims.exp + graceSeconds;
    if (!audience || claims.iss !== TOKEN_ISSUER || claims.aud !== audience || !claims.sid || expiredBeyondGrace) {
      throw new Error('refresh claims invalid');
    }
    const service = identityServiceFor(getInstance());
    const user = service.readIdentityForToken(claims);
    const issued = claims.token_use === FORMAL_TOKEN_USE
      ? service.issueFormalToken(user, claims.sid)
      : claims.token_use === VISITOR_TOKEN_USE
        ? service.issueVisitorToken(user, claims.sid)
        : service.issueUnrecognizedToken(user, claims.sid);
    return res.json({ success: true, token: issued.token });
  } catch (_error) {
    return res.status(401).json({ success: false, code: 'TOKEN_REFRESH_REQUIRES_RELOGIN' });
  }
});

/**
 * GET /api/auth/me
 * 获取当前用户信息（需认证）
 */
router.get('/me', authMiddleware, (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.json({ success: false, error: '未登录' });
  }
  try {
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
    res.json({ success: true, data: decoded });
  } catch {
    res.json({ success: false, error: 'Token无效' });
  }
});

module.exports = router;
