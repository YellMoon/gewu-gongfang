/**
 * 认证路由（微信小程序登录预留）
 */
const { Router } = require('express');
const { getInstance } = require('../database');
const { generateToken, JWT_SECRET } = require('../middleware/auth');
const {
  buildMiniappLoginUser,
  getMiniappLoginDenialReason,
} = require('../services/miniappAuthPolicy');
const { resolveWechatPhoneNumber } = require('../services/wechatMiniappService');

const router = Router();

function isProductionRuntime() {
  return process.env.NODE_ENV === 'production' || process.env.APP_ENV === 'prod';
}

function canUseDevWechatIdentity() {
  return process.env.ALLOW_DEV_WECHAT_LOGIN === 'true' || !isProductionRuntime();
}

function makeDevOpenid(code) {
  return `dev_${String(code || 'mock').replace(/[^a-zA-Z0-9]/g, '').slice(0, 32)}`;
}

async function resolveWechatIdentity(code) {
  const appid = process.env.WECHAT_APPID;
  const secret = process.env.WECHAT_APPSECRET;
  if (appid && secret && process.env.WECHAT_USE_MOCK_LOGIN !== 'true') {
    const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
    url.searchParams.set('appid', appid);
    url.searchParams.set('secret', secret);
    url.searchParams.set('js_code', code);
    url.searchParams.set('grant_type', 'authorization_code');
    const response = await fetch(url);
    const payload = await response.json();
    if (!response.ok || payload.errcode || !payload.openid) {
      const detail = payload.errmsg || `HTTP ${response.status}`;
      const error = new Error(`wechat code exchange failed: ${detail}`);
      error.code = 'WECHAT_CODE_EXCHANGE_FAILED';
      throw error;
    }
    return { openid: payload.openid, unionid: payload.unionid || null };
  }
  if (!canUseDevWechatIdentity()) {
    const error = new Error('WECHAT_APPID/WECHAT_APPSECRET are required');
    error.code = 'WECHAT_CONFIG_REQUIRED';
    throw error;
  }
  return { openid: makeDevOpenid(code), unionid: null };
}

/**
 * POST /api/auth/wechat-login
 * 微信小程序登录
 * 
 * Body: { code: "微信登录code" }
 * Response: { token: "jwt...", user: { id, nickname, ... } }
 */
router.post('/wechat-login', async (req, res) => {
  try {
    const { code, phoneCode, userInfo } = req.body;
    
    if (!code) {
      return res.status(400).json({ error: '缺少登录code' });
    }

    const { openid, unionid } = await resolveWechatIdentity(code);
    const nickname = userInfo?.nickName || '管理员';
    const avatarUrl = userInfo?.avatarUrl || null;

    const db = getInstance();
    let rawUser = db.getMiniappUserByWechat(openid);
    if (!rawUser && phoneCode) {
      const verifiedPhone = await resolveWechatPhoneNumber(phoneCode);
      const phoneUser = db.getMiniappUserByPhone(verifiedPhone);
      const phoneDenialReason = getMiniappLoginDenialReason(phoneUser);
      if (phoneDenialReason) {
        db.recordMiniappLoginAttempt({ openid, unionid, nickname, avatarUrl, denialReason: phoneDenialReason });
        return res.status(403).json({
          success: false,
          code: phoneDenialReason,
          error: 'Miniapp account is not authorized on the data host',
        });
      }
      rawUser = db.bindMiniappUserWechatByVerifiedPhone(verifiedPhone, openid, unionid, { nickname, avatarUrl });
    }
    const denialReason = getMiniappLoginDenialReason(rawUser);
    if (denialReason) {
      db.recordMiniappLoginAttempt({ openid, unionid, nickname, avatarUrl, denialReason });
      return res.status(403).json({
        success: false,
        code: denialReason,
        error: 'Miniapp account is not authorized on the data host',
      });
    }

    const user = db.findAuthorizedMiniappUserByWechat(openid);
    if (!user) {
      return res.status(403).json({
        success: false,
        code: 'MINIAPP_USER_NOT_PREAUTHORIZED',
        error: 'Miniapp account is not authorized on the data host',
      });
    }
    const loginUser = buildMiniappLoginUser(user);
    const token = generateToken(user);

    res.json({
      success: true,
      data: {
        token,
        user: loginUser,
        userId: loginUser.id,
        nickname: loginUser.nickname,
        avatarUrl: loginUser.avatarUrl,
        role: loginUser.role
      }
    });
  } catch (err) {
    const forbiddenCodes = new Set(['MINIAPP_PHONE_ALREADY_BOUND', 'MINIAPP_WECHAT_ALREADY_BOUND']);
    const status = forbiddenCodes.has(err.code) ? 403 : 500;
    res.status(status).json({ success: false, code: err.code || 'MINIAPP_LOGIN_FAILED', error: err.message });
  }
});

/**
 * GET /api/auth/me
 * 获取当前用户信息（需认证）
 */
router.get('/me', (req, res) => {
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
