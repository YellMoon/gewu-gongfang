const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { normalizePhone, roleForUser } = require('./authorizationPolicy');

const TOKEN_ISSUER = 'gewu-miniapp-auth';
const FORMAL_AUDIENCE = 'gewu-api';
const EXPERIENCE_AUDIENCE = 'gewu-miniapp-experience';
const FORMAL_TOKEN_USE = 'miniapp-session';
const VISITOR_TOKEN_USE = 'miniapp-visitor';
const UNRECOGNIZED_TOKEN_USE = 'unrecognized-student';
const FORMAL_ROLES = new Set(['super_admin', 'admin', 'teacher', 'student']);
const LOGIN_EVENT_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;
const VISITOR_CAPABILITIES = Object.freeze([
  'projection:read',
  'role-application:read',
  'role-application:submit',
  'question-preview:read',
]);
const UNRECOGNIZED_CAPABILITIES = Object.freeze([
  'experience:read',
  'profile-application:read',
  'profile-application:submit',
  'sample-questions:view',
  'sample-paper-export',
]);

function serviceError(code, details) {
  const error = new Error(code);
  error.code = code;
  if (details && typeof details === 'object') error.details = details;
  return error;
}

function isEnabled(value) {
  return value === 1 || value === true || value === '1' || value === 'true';
}

function isDisabled(user) {
  return !user
    || user.deleted === 1
    || user.deleted === true
    || user.status === 0
    || user.status === 'inactive'
    || user.status === 'disabled'
    || Boolean(user.disabled_at);
}

function asIso(value) {
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}

function createMiniappIdentityService({
  db,
  jwtSecret,
  now = () => new Date(),
  uuid = uuidv4,
  tokenExpiresIn = '7d',
  authorityId = '',
} = {}) {
  if (!db || typeof db.prepare !== 'function' || typeof db.transaction !== 'function') {
    throw serviceError('MINIAPP_IDENTITY_DB_REQUIRED');
  }
  if (!jwtSecret) throw serviceError('JWT_SECRET_REQUIRED');

  const findByPhone = db.prepare('SELECT * FROM users WHERE phone_normalized = ? AND deleted = 0');
  const findByOpenid = db.prepare('SELECT * FROM users WHERE wechat_openid = ? AND deleted = 0');
  const findById = db.prepare('SELECT * FROM users WHERE id = ? AND deleted = 0');
  const findAuthorityAccount = db.prepare(`SELECT user_id,authority_id,status
    FROM authority_accounts WHERE user_id=?`);
  const readConfiguredAuthority = db.prepare(
    "SELECT value FROM authority_metadata WHERE key='database_authority_id'"
  );
  const readActiveAuthorities = db.prepare(`SELECT DISTINCT db_authority_id
    FROM primary_host_epochs WHERE status='active' ORDER BY db_authority_id`);
  const studentExists = db.prepare('SELECT 1 FROM students WHERE id = ? AND deleted = 0');
  const teacherExists = db.prepare('SELECT 1 FROM teachers WHERE id = ? AND deleted = 0');
  const findMembership = db.prepare(`SELECT status, ends_at FROM account_memberships
    WHERE subject_type = ? AND subject_id = ?`);
  const insertEvent = db.prepare(`INSERT INTO miniapp_login_events
    (id, user_id, phone_normalized, identity_kind, result_code, session_id,
     miniapp_version, platform, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertUnrecognizedUser = db.prepare(`INSERT INTO users
    (id, wechat_openid, wechat_unionid, phone, phone_normalized, name, nickname, avatar_url,
     role, identity_kind, status, login_enabled, review_status, auth_version, deleted, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'unrecognized', 1, 0, 'pending', 1, 0, ?, ?)`);
  const insertVisitorUser = db.prepare(`INSERT INTO users
    (id, wechat_openid, wechat_unionid, phone, phone_normalized, name, nickname, avatar_url,
     role, identity_kind, status, login_enabled, review_status, auth_version, deleted, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'visitor', 'visitor', 1, 1, 'approved', 1, 0, ?, ?)`);
  const insertAuthorityAccount = db.prepare(`INSERT INTO authority_accounts
    (user_id,authority_id,status,created_at,updated_at) VALUES (?,?,'active',?,?)`);

  function timestamp() {
    return asIso(now());
  }

  function formalRole(user) {
    const role = roleForUser(user);
    return FORMAL_ROLES.has(role) ? role : null;
  }

  function membershipFor(user, role = formalRole(user)) {
    const subjectType = role === 'student' ? 'student'
      : role === 'teacher' ? 'teacher'
        : role === 'admin' || role === 'super_admin' ? 'user' : null;
    const subjectId = role === 'student' ? user?.student_id
      : role === 'teacher' ? user?.teacher_id : user?.id;
    if (!subjectType || !subjectId) return null;
    return findMembership.get(subjectType, subjectId) || null;
  }

  function isActiveMembership(membership) {
    if (!membership || membership.status !== 'active') return false;
    if (!membership.ends_at) return true;
    const expiresAt = Date.parse(membership.ends_at);
    return Number.isFinite(expiresAt) && expiresAt > new Date(now()).getTime();
  }

  function hasValidFormalMapping(user, role = formalRole(user)) {
    if (!role) return false;
    const reconciledMembership = isActiveMembership(membershipFor(user, role));
    if (role === 'student') {
      return Boolean(user.student_id && (studentExists.get(user.student_id) || reconciledMembership));
    }
    if (role === 'teacher') {
      return Boolean(user.teacher_id && (teacherExists.get(user.teacher_id) || reconciledMembership));
    }
    return role === 'admin' || role === 'super_admin';
  }

  function isFormal(user) {
    if (isDisabled(user) || user.review_status !== 'approved' || !isEnabled(user.login_enabled)) return false;
    const role = formalRole(user);
    return Boolean(role && hasValidFormalMapping(user, role));
  }

  function hasEnabledFormalState(user) {
    return Boolean(formalRole(user))
      && user?.review_status === 'approved'
      && isEnabled(user?.login_enabled);
  }

  function authorityAccountFor(user) {
    return user?.id ? findAuthorityAccount.get(user.id) || null : null;
  }

  function isVisitor(user) {
    if (isDisabled(user) || user.review_status !== 'approved' || !isEnabled(user.login_enabled)) return false;
    if (String(user.role || '') !== 'visitor' || String(user.identity_kind || '') !== 'visitor') return false;
    return authorityAccountFor(user)?.status === 'active';
  }

  function authorityIdForNewVisitor() {
    const explicit = String(authorityId || '').trim();
    if (explicit) return explicit;
    const configured = String(readConfiguredAuthority.get()?.value || '').trim();
    if (configured) return configured;
    const active = readActiveAuthorities.all().map(row => String(row.db_authority_id || '').trim()).filter(Boolean);
    if (active.length !== 1) throw serviceError('MINIAPP_VISITOR_AUTHORITY_UNAVAILABLE');
    return active[0];
  }

  function accountStateFor(user) {
    if (isFormal(user)) return 'formal';
    if (isVisitor(user)) return 'visitor';
    return 'unrecognized';
  }

  function identityKind(user, accountState) {
    if (accountState === 'visitor') return 'visitor';
    if (accountState === 'unrecognized') return 'unrecognized';
    return user.identity_kind || formalRole(user) || 'unrecognized';
  }

  function presentUser(user, accountState) {
    const role = accountState === 'formal'
      ? formalRole(user)
      : accountState === 'visitor' ? 'visitor' : 'student';
    const membership = accountState === 'formal' ? membershipFor(user, role) : null;
    const member = isActiveMembership(membership);
    const tokenUse = accountState === 'formal'
      ? FORMAL_TOKEN_USE
      : accountState === 'visitor' ? VISITOR_TOKEN_USE : UNRECOGNIZED_TOKEN_USE;
    const authorityAccount = accountState === 'visitor' ? authorityAccountFor(user) : null;
    return {
      id: user.id,
      name: user.name || user.nickname || '',
      nickname: user.nickname || user.name || '',
      avatar: user.avatar_url || null,
      avatarUrl: user.avatar_url || null,
      phone: user.phone || null,
      role,
      user_type: role,
      identity_kind: identityKind(user, accountState),
      account_state: accountState,
      token_use: tokenUse,
      ...(accountState === 'visitor' ? {
        authority_id: authorityAccount?.authority_id || null,
        capabilities: [...VISITOR_CAPABILITIES],
      } : {}),
      ...(accountState === 'unrecognized' ? { capabilities: [...UNRECOGNIZED_CAPABILITIES] } : {}),
      student_id: accountState === 'formal' ? user.student_id || null : null,
      teacher_id: accountState === 'formal' ? user.teacher_id || null : null,
      is_member: member,
      membership_status: membership?.status || null,
      ...(accountState === 'formal' ? {
        membership: membership ? { status: membership.status, endsAt: membership.ends_at || null } : null,
      } : {}),
    };
  }

  function issueToken(user, sessionId, tokenUse, audience) {
    const claims = {
      sub: String(user.id),
      sid: String(sessionId),
      token_use: tokenUse,
      auth_version: Number(user.auth_version || 1),
      iss: TOKEN_ISSUER,
      aud: audience,
    };
    if (tokenUse === FORMAL_TOKEN_USE) {
      claims.role = formalRole(user);
      claims.identity_kind = identityKind(user, 'formal');
    } else if (tokenUse === VISITOR_TOKEN_USE) {
      const account = authorityAccountFor(user);
      if (!account || account.status !== 'active') throw serviceError('MINIAPP_VISITOR_ACCOUNT_INACTIVE');
      claims.role = 'visitor';
      claims.identity_kind = 'visitor';
      claims.authority_id = account.authority_id;
    }
    const token = jwt.sign(claims, jwtSecret, {
      algorithm: 'HS256',
      expiresIn: tokenExpiresIn,
    });
    return { token, claims, sessionId };
  }

  function issueFormalToken(user, sessionId = uuid()) {
    if (!isFormal(user)) throw serviceError('FORMAL_IDENTITY_NOT_ELIGIBLE');
    return issueToken(user, sessionId, FORMAL_TOKEN_USE, FORMAL_AUDIENCE);
  }

  function issueUnrecognizedToken(user, sessionId = uuid()) {
    if (isDisabled(user)) throw serviceError('MINIAPP_LOGIN_DISABLED');
    if (isFormal(user) || hasEnabledFormalState(user)) throw serviceError('FORMAL_IDENTITY_RELOGIN_REQUIRED');
    return issueToken(user, sessionId, UNRECOGNIZED_TOKEN_USE, EXPERIENCE_AUDIENCE);
  }

  function issueVisitorToken(user, sessionId = uuid()) {
    if (!isVisitor(user)) throw serviceError('MINIAPP_VISITOR_NOT_ELIGIBLE');
    return issueToken(user, sessionId, VISITOR_TOKEN_USE, FORMAL_AUDIENCE);
  }

  function writeEvent({ user, phone, resultCode, sessionId = null, miniappVersion = null, platform = null }) {
    const eventId = uuid();
    insertEvent.run(
      eventId,
      user?.id || null,
      phone,
      user ? identityKind(user, accountStateFor(user)) : null,
      resultCode,
      sessionId,
      miniappVersion ? String(miniappVersion).slice(0, 64) : null,
      platform ? String(platform).slice(0, 32) : null,
      timestamp(),
    );
    return eventId;
  }

  function conflictOutcome(code, user, input) {
    writeEvent({
      user,
      phone: input.phone,
      resultCode: code,
      miniappVersion: input.miniappVersion,
      platform: input.platform,
    });
    return { error: { code } };
  }

  function createUnrecognizedUser(input, currentTime = timestamp()) {
    const userId = uuid();
    insertUnrecognizedUser.run(
      userId,
      input.openid,
      input.unionid,
      input.phone,
      input.phone,
      input.nickname || '\u4f53\u9a8c\u8d26\u53f7',
      input.nickname,
      input.avatarUrl,
      currentTime,
      currentTime,
    );
    return findById.get(userId);
  }

  function createVisitorUser(input, currentTime = timestamp()) {
    const userId = uuid();
    insertVisitorUser.run(
      userId,
      input.openid,
      input.unionid,
      input.phone,
      input.phone,
      input.nickname || '\u8bbf\u5ba2',
      input.nickname,
      input.avatarUrl,
      currentTime,
      currentTime,
    );
    insertAuthorityAccount.run(
      userId,
      authorityIdForNewVisitor(),
      currentTime,
      currentTime,
    );
    return findById.get(userId);
  }

  function loginOutcomeForUser(user, input) {
    if (user.review_status === 'approved' && isEnabled(user.login_enabled)
      && !isFormal(user) && !isVisitor(user)) {
      return conflictOutcome('FORMAL_IDENTITY_MAPPING_INVALID', user, input);
    }
    const accountState = accountStateFor(user);
    const sessionId = uuid();
    const issued = accountState === 'formal'
      ? issueFormalToken(user, sessionId)
      : accountState === 'visitor'
        ? issueVisitorToken(user, sessionId)
        : issueUnrecognizedToken(user, sessionId);
    const loginEventId = writeEvent({
      user,
      phone: input.phone,
      resultCode: accountState === 'formal'
        ? 'FORMAL_LOGIN_SUCCESS'
        : accountState === 'visitor' ? 'VISITOR_LOGIN_SUCCESS' : 'UNRECOGNIZED_LOGIN_SUCCESS',
      sessionId,
      miniappVersion: input.miniappVersion,
      platform: input.platform,
    });
    return {
      login: {
        ...issued,
        loginEventId,
        user: presentUser(user, accountState),
      },
    };
  }

  const performLogin = db.transaction(input => {
    let phoneOwner = findByPhone.get(input.phone);
    const openidOwner = findByOpenid.get(input.openid);
    if (phoneOwner?.wechat_openid && phoneOwner.wechat_openid !== input.openid) {
      return conflictOutcome('PHONE_WECHAT_BINDING_CONFLICT', phoneOwner, input);
    }
    if (openidOwner && (!phoneOwner || openidOwner.id !== phoneOwner.id)) {
      return conflictOutcome('OPENID_PHONE_BINDING_CONFLICT', openidOwner, input);
    }
    if (phoneOwner && isDisabled(phoneOwner)) {
      return conflictOutcome('MINIAPP_LOGIN_DISABLED', phoneOwner, input);
    }

    const currentTime = timestamp();
    if (!phoneOwner) {
      phoneOwner = createVisitorUser(input, currentTime);
    } else if (!phoneOwner.wechat_openid) {
      const result = db.prepare(`UPDATE users
        SET wechat_openid = ?, wechat_unionid = COALESCE(wechat_unionid, ?),
            nickname = CASE WHEN nickname IS NULL OR nickname = '' THEN ? ELSE nickname END,
            avatar_url = CASE WHEN avatar_url IS NULL OR avatar_url = '' THEN ? ELSE avatar_url END,
            auth_version = auth_version + 1, updated_at = ?
        WHERE id = ? AND wechat_openid IS NULL`)
        .run(input.openid, input.unionid, input.nickname, input.avatarUrl, currentTime, phoneOwner.id);
      if (result.changes !== 1) return conflictOutcome('PHONE_WECHAT_BINDING_CONFLICT', phoneOwner, input);
      phoneOwner = findById.get(phoneOwner.id);
    } else if (input.unionid && !phoneOwner.wechat_unionid) {
      db.prepare('UPDATE users SET wechat_unionid=?, updated_at=? WHERE id=? AND wechat_unionid IS NULL')
        .run(input.unionid, currentTime, phoneOwner.id);
      phoneOwner = findById.get(phoneOwner.id);
    }

    return loginOutcomeForUser(phoneOwner, input);
  });

  function normalizedLoginInput(input, phone, openid) {
    return {
      phone,
      openid,
      unionid: input.unionid ? String(input.unionid) : null,
      nickname: String(input.profile?.nickname || input.nickname || '').trim().slice(0, 64) || null,
      avatarUrl: String(input.profile?.avatarUrl || input.avatarUrl || '').trim().slice(0, 512) || null,
      miniappVersion: input.miniappVersion || null,
      platform: input.platform || null,
    };
  }

  function loginWithClaimedWechat(input = {}) {
    const phone = normalizePhone(input.phone);
    const openid = String(input.openid || '').trim();
    if (!phone) throw serviceError('MANUAL_PHONE_REQUIRED');
    if (!/^1\d{10}$/.test(phone)) throw serviceError('MANUAL_PHONE_INVALID');
    if (!openid) throw serviceError('WECHAT_IDENTITY_REQUIRED');
    const normalizedInput = normalizedLoginInput(input, phone, openid);
    let outcome;
    try {
      outcome = performLogin.immediate(normalizedInput);
    } catch (error) {
      if (error?.code !== 'SQLITE_CONSTRAINT_UNIQUE') throw error;
      const phoneOwner = findByPhone.get(phone);
      const openidOwner = findByOpenid.get(openid);
      const code = openidOwner && (!phoneOwner || openidOwner.id !== phoneOwner.id)
        ? 'OPENID_PHONE_BINDING_CONFLICT'
        : 'PHONE_WECHAT_BINDING_CONFLICT';
      writeEvent({
        user: openidOwner || phoneOwner || null,
        phone,
        resultCode: code,
        miniappVersion: normalizedInput.miniappVersion,
        platform: normalizedInput.platform,
      });
      throw serviceError(code);
    }
    if (outcome.error) throw serviceError(outcome.error.code);
    return outcome.login;
  }

  function loginWithVerifiedWechat(input = {}) {
    const phone = normalizePhone(input.phone);
    const openid = String(input.openid || '').trim();
    if (!openid || !/^1\d{10}$/.test(phone)) {
      throw serviceError('VERIFIED_WECHAT_IDENTITY_REQUIRED');
    }
    const normalizedInput = normalizedLoginInput(input, phone, openid);
    let outcome;
    try {
      outcome = performLogin(normalizedInput);
    } catch (error) {
      if (error?.code !== 'SQLITE_CONSTRAINT_UNIQUE') throw error;
      const phoneOwner = findByPhone.get(phone);
      const openidOwner = findByOpenid.get(openid);
      const code = phoneOwner?.wechat_openid && phoneOwner.wechat_openid !== openid
        ? 'PHONE_WECHAT_BINDING_CONFLICT'
        : 'OPENID_PHONE_BINDING_CONFLICT';
      writeEvent({
        user: phoneOwner || openidOwner || null,
        phone,
        resultCode: code,
        miniappVersion: normalizedInput.miniappVersion,
        platform: normalizedInput.platform,
      });
      throw serviceError(code);
    }
    if (outcome.error) throw serviceError(outcome.error.code);
    return outcome.login;
  }

  function readIdentityForToken(claims = {}) {
    const userId = claims.sub || claims.id;
    const user = userId ? findById.get(String(userId)) : null;
    if (!user) throw serviceError('AUTH_USER_NOT_FOUND');
    if (Number(claims.auth_version) !== Number(user.auth_version || 1)) {
      throw serviceError('AUTH_VERSION_MISMATCH');
    }
    if (isDisabled(user)) throw serviceError('MINIAPP_LOGIN_DISABLED');
    if (claims.iss !== TOKEN_ISSUER) throw serviceError('TOKEN_ISSUER_INVALID');
    if (claims.token_use === FORMAL_TOKEN_USE) {
      if (claims.aud !== FORMAL_AUDIENCE || !isFormal(user)) throw serviceError('FORMAL_IDENTITY_NOT_ELIGIBLE');
      return user;
    }
    if (claims.token_use === UNRECOGNIZED_TOKEN_USE) {
      if (claims.aud !== EXPERIENCE_AUDIENCE || isFormal(user) || hasEnabledFormalState(user)) {
        throw serviceError('UNRECOGNIZED_IDENTITY_NOT_ELIGIBLE');
      }
      return user;
    }
    if (claims.token_use === VISITOR_TOKEN_USE) {
      if (claims.aud !== FORMAL_AUDIENCE || !isVisitor(user)) {
        throw serviceError('MINIAPP_VISITOR_NOT_ELIGIBLE');
      }
      const account = authorityAccountFor(user);
      if (claims.role !== 'visitor' || claims.identity_kind !== 'visitor'
        || claims.authority_id !== account?.authority_id) {
        throw serviceError('MINIAPP_VISITOR_CLAIMS_INVALID');
      }
      return user;
    }
    throw serviceError('MINIAPP_TOKEN_USE_INVALID');
  }

  function expireLoginEvents(before) {
    const cutoff = before
      ? asIso(before)
      : new Date(new Date(now()).getTime() - LOGIN_EVENT_RETENTION_MS).toISOString();
    return db.prepare('DELETE FROM miniapp_login_events WHERE created_at < ?').run(cutoff).changes;
  }

  expireLoginEvents();

  return {
    expireLoginEvents,
    issueFormalToken,
    issueUnrecognizedToken,
    issueVisitorToken,
    loginWithClaimedWechat,
    loginWithVerifiedWechat,
    readIdentityForToken,
  };
}

module.exports = {
  EXPERIENCE_AUDIENCE,
  FORMAL_AUDIENCE,
  FORMAL_TOKEN_USE,
  TOKEN_ISSUER,
  UNRECOGNIZED_TOKEN_USE,
  VISITOR_TOKEN_USE,
  createMiniappIdentityService,
};
