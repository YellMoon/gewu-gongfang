'use strict';

const { v4: uuidv4 } = require('uuid');
const {
  canReviewUsers,
  normalizePhone,
} = require('./authorizationPolicy');

const REQUEST_STATUSES = new Set(['submitted', 'approved', 'rejected', 'expired']);

function bindingError(code, statusCode = 400, details) {
  const error = new Error(code);
  error.code = code;
  error.statusCode = statusCode;
  if (details) error.details = details;
  return error;
}

function maskPhone(phone) {
  const value = String(phone || '');
  return /^1\d{10}$/.test(value)
    ? `${value.slice(0, 3)}****${value.slice(-4)}`
    : '';
}

function createMiniappWechatBindingService({
  db,
  now = () => new Date(),
  uuid = uuidv4,
} = {}) {
  if (!db || typeof db.prepare !== 'function' || typeof db.transaction !== 'function') {
    throw new TypeError('db is required');
  }

  const findUserById = db.prepare('SELECT * FROM users WHERE id=? AND deleted=0');
  const findUserByOpenid = db.prepare('SELECT * FROM users WHERE wechat_openid=? AND deleted=0');
  const findRequest = db.prepare(`SELECT request.*, user.name AS target_name, user.nickname AS target_nickname
    FROM miniapp_wechat_binding_requests request
    INNER JOIN users user ON user.id=request.target_user_id
    WHERE request.id=?`);
  const findActiveByOpenid = db.prepare(`SELECT request.*, user.name AS target_name, user.nickname AS target_nickname
    FROM miniapp_wechat_binding_requests request
    INNER JOIN users user ON user.id=request.target_user_id
    WHERE request.candidate_openid=? AND request.status='submitted'`);
  const findActiveByTarget = db.prepare(`SELECT request.*, user.name AS target_name, user.nickname AS target_nickname
    FROM miniapp_wechat_binding_requests request
    INNER JOIN users user ON user.id=request.target_user_id
    WHERE request.target_user_id=? AND request.status='submitted'`);
  const insertRequest = db.prepare(`INSERT INTO miniapp_wechat_binding_requests
    (id, target_user_id, phone_normalized, candidate_openid, candidate_unionid,
     status, revision, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'submitted', 1, ?, ?)`);
  const bindTarget = db.prepare(`UPDATE users
    SET wechat_openid=?, wechat_unionid=COALESCE(wechat_unionid, ?),
        auth_version=auth_version+1, updated_at=?
    WHERE id=? AND deleted=0 AND phone_normalized=? AND wechat_openid IS NULL`);
  const approveRequest = db.prepare(`UPDATE miniapp_wechat_binding_requests
    SET status='approved', revision=revision+1, reviewed_by=?,
        review_note=NULL, updated_at=?, resolved_at=?
    WHERE id=? AND status='submitted' AND revision=?`);
  const rejectRequest = db.prepare(`UPDATE miniapp_wechat_binding_requests
    SET status='rejected', revision=revision+1, reviewed_by=?,
        review_note=?, updated_at=?, resolved_at=?
    WHERE id=? AND status='submitted' AND revision=?`);
  const insertAudit = db.prepare(`INSERT INTO authorization_audit_log
    (id, actor_user_id, actor_phone, target_user_id, action, before_json, after_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);

  function timestamp() {
    const value = now();
    return (value instanceof Date ? value : new Date(value)).toISOString();
  }

  function present(row) {
    if (!row) return null;
    return {
      id: row.id,
      targetUserId: row.target_user_id,
      targetName: row.target_name || row.target_nickname || '',
      phoneMasked: maskPhone(row.phone_normalized),
      status: row.status,
      revision: Number(row.revision),
      reviewedBy: row.reviewed_by || null,
      reviewNote: row.review_note || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      resolvedAt: row.resolved_at || null,
    };
  }

  function requireReviewer(actor) {
    if (!canReviewUsers(actor)) {
      throw bindingError('WECHAT_BINDING_REVIEW_FORBIDDEN', 403);
    }
  }

  function validateExpectedRevision(value) {
    const revision = Number(value);
    if (!Number.isInteger(revision) || revision < 1) {
      throw bindingError('WECHAT_BINDING_REVISION_REQUIRED');
    }
    return revision;
  }

  const requestTransaction = db.transaction(input => {
    const target = findUserById.get(input.targetUserId);
    if (!target) throw bindingError('WECHAT_BINDING_TARGET_NOT_FOUND', 404);
    const targetPhone = normalizePhone(target.phone_normalized || target.phone);
    if (targetPhone !== input.phone) {
      throw bindingError('WECHAT_BINDING_TARGET_CHANGED', 409);
    }
    const openidOwner = findUserByOpenid.get(input.openid);
    if (openidOwner) {
      throw bindingError('WECHAT_BINDING_REQUEST_CONFLICT', 409);
    }

    const activeOpenid = findActiveByOpenid.get(input.openid);
    if (activeOpenid) {
      if (activeOpenid.target_user_id === target.id
        && activeOpenid.phone_normalized === input.phone) {
        return present(activeOpenid);
      }
      throw bindingError('WECHAT_BINDING_REQUEST_CONFLICT', 409);
    }
    const activeTarget = findActiveByTarget.get(target.id);
    if (activeTarget) {
      if (activeTarget.candidate_openid === input.openid
        && activeTarget.phone_normalized === input.phone) {
        return present(activeTarget);
      }
      throw bindingError('WECHAT_BINDING_REQUEST_CONFLICT', 409);
    }

    const createdAt = timestamp();
    const requestId = uuid();
    insertRequest.run(
      requestId,
      target.id,
      input.phone,
      input.openid,
      input.unionid,
      createdAt,
      createdAt,
    );
    return present(findRequest.get(requestId));
  });

  function requestBinding(input = {}) {
    const normalized = {
      targetUserId: String(input.targetUserId || '').trim(),
      phone: normalizePhone(input.phone),
      openid: String(input.openid || '').trim(),
      unionid: String(input.unionid || '').trim() || null,
    };
    if (!normalized.targetUserId || !/^1\d{10}$/.test(normalized.phone) || !normalized.openid) {
      throw bindingError('WECHAT_BINDING_REQUEST_INVALID');
    }
    try {
      return requestTransaction.immediate(normalized);
    } catch (error) {
      if (error?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        throw bindingError('WECHAT_BINDING_REQUEST_CONFLICT', 409);
      }
      throw error;
    }
  }

  function list({ status = 'submitted', limit = 100 } = {}) {
    const normalizedStatus = String(status || 'submitted').trim();
    if (!REQUEST_STATUSES.has(normalizedStatus)) {
      throw bindingError('WECHAT_BINDING_STATUS_INVALID');
    }
    const normalizedLimit = Math.min(Math.max(Number(limit) || 100, 1), 200);
    const rows = db.prepare(`SELECT request.*, user.name AS target_name, user.nickname AS target_nickname
      FROM miniapp_wechat_binding_requests request
      INNER JOIN users user ON user.id=request.target_user_id
      WHERE request.status=?
      ORDER BY request.created_at DESC, request.id DESC
      LIMIT ?`).all(normalizedStatus, normalizedLimit);
    return { items: rows.map(present), total: rows.length };
  }

  const approveTransaction = db.transaction(input => {
    const row = findRequest.get(input.requestId);
    if (!row) throw bindingError('WECHAT_BINDING_REQUEST_NOT_FOUND', 404);
    if (row.status === 'approved' && Number(row.revision) === input.expectedRevision + 1) {
      return present(row);
    }
    if (row.status !== 'submitted') {
      throw bindingError('WECHAT_BINDING_REVIEW_NOT_ALLOWED', 409);
    }
    if (Number(row.revision) !== input.expectedRevision) {
      throw bindingError('WECHAT_BINDING_REVISION_CONFLICT', 409);
    }
    const target = findUserById.get(row.target_user_id);
    if (!target || normalizePhone(target.phone_normalized || target.phone) !== row.phone_normalized) {
      throw bindingError('WECHAT_BINDING_TARGET_CHANGED', 409);
    }
    if (target.wechat_openid) {
      throw bindingError('WECHAT_BINDING_TARGET_ALREADY_BOUND', 409);
    }
    const openidOwner = findUserByOpenid.get(row.candidate_openid);
    if (openidOwner) {
      throw bindingError('WECHAT_BINDING_REQUEST_CONFLICT', 409);
    }

    const changedAt = timestamp();
    if (bindTarget.run(
      row.candidate_openid,
      row.candidate_unionid,
      changedAt,
      target.id,
      row.phone_normalized,
    ).changes !== 1) {
      throw bindingError('WECHAT_BINDING_TARGET_CHANGED', 409);
    }
    if (approveRequest.run(
      input.actor.id,
      changedAt,
      changedAt,
      row.id,
      input.expectedRevision,
    ).changes !== 1) {
      throw bindingError('WECHAT_BINDING_REVISION_CONFLICT', 409);
    }
    insertAudit.run(
      uuid(),
      input.actor.id,
      normalizePhone(input.actor.phone),
      target.id,
      'approve_wechat_binding',
      JSON.stringify({ status: row.status, revision: Number(row.revision) }),
      JSON.stringify({ status: 'approved', revision: Number(row.revision) + 1 }),
      changedAt,
    );
    return present(findRequest.get(row.id));
  });

  function approve(input = {}) {
    requireReviewer(input.actor);
    const requestId = String(input.requestId || '').trim();
    if (!requestId) throw bindingError('WECHAT_BINDING_REQUEST_NOT_FOUND', 404);
    return approveTransaction.immediate({
      actor: input.actor,
      requestId,
      expectedRevision: validateExpectedRevision(input.expectedRevision),
    });
  }

  const rejectTransaction = db.transaction(input => {
    const row = findRequest.get(input.requestId);
    if (!row) throw bindingError('WECHAT_BINDING_REQUEST_NOT_FOUND', 404);
    if (row.status === 'rejected' && Number(row.revision) === input.expectedRevision + 1) {
      return present(row);
    }
    if (row.status !== 'submitted') {
      throw bindingError('WECHAT_BINDING_REVIEW_NOT_ALLOWED', 409);
    }
    if (Number(row.revision) !== input.expectedRevision) {
      throw bindingError('WECHAT_BINDING_REVISION_CONFLICT', 409);
    }
    const changedAt = timestamp();
    if (rejectRequest.run(
      input.actor.id,
      input.reason,
      changedAt,
      changedAt,
      row.id,
      input.expectedRevision,
    ).changes !== 1) {
      throw bindingError('WECHAT_BINDING_REVISION_CONFLICT', 409);
    }
    insertAudit.run(
      uuid(),
      input.actor.id,
      normalizePhone(input.actor.phone),
      row.target_user_id,
      'reject_wechat_binding',
      JSON.stringify({ status: row.status, revision: Number(row.revision) }),
      JSON.stringify({ status: 'rejected', revision: Number(row.revision) + 1 }),
      changedAt,
    );
    return present(findRequest.get(row.id));
  });

  function reject(input = {}) {
    requireReviewer(input.actor);
    const requestId = String(input.requestId || '').trim();
    if (!requestId) throw bindingError('WECHAT_BINDING_REQUEST_NOT_FOUND', 404);
    return rejectTransaction.immediate({
      actor: input.actor,
      requestId,
      expectedRevision: validateExpectedRevision(input.expectedRevision),
      reason: String(input.reason || '').trim().slice(0, 500) || null,
    });
  }

  return {
    approve,
    list,
    reject,
    requestBinding,
  };
}

module.exports = {
  createMiniappWechatBindingService,
  maskPhone,
};
