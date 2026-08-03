const crypto = require('crypto');

const ACCOUNT_TYPES = new Set(['saving_card', 'credit_card', 'alipay', 'wechat', 'custom']);
const ACCOUNT_TYPE_ALIASES = new Map([
  ['savings', 'saving_card'], ['debit', 'saving_card'], ['saving_card', 'saving_card'],
  ['credit', 'credit_card'], ['credit_card', 'credit_card'], ['alipay', 'alipay'],
  ['wechat', 'wechat'], ['custom', 'custom'],
]);
const SENSITIVE_KEYS = new Set(['accountNumber', 'account_number', 'cardNumber', 'card_number', 'fullIdentifier']);

function assetAccountError(code, statusCode = 400) {
  return Object.assign(new Error(code), { code, statusCode });
}

function text(value, code, maxLength = 128, optional = false) {
  const normalized = String(value || '').trim();
  if (!normalized && optional) return null;
  if (!normalized || normalized.length > maxLength) throw assetAccountError(code);
  return normalized;
}

function roles(actor = {}) {
  return new Set(Array.isArray(actor.roles) ? actor.roles.map(String) : [String(actor.role || '')]);
}

function isAdmin(actor) {
  const values = roles(actor);
  return values.has('admin') || values.has('super_admin');
}

function assertNoSecret(input = {}) {
  if (Object.keys(input).some(key => SENSITIVE_KEYS.has(key) && input[key])) {
    throw assetAccountError('ASSET_ACCOUNT_SECRET_FORBIDDEN', 400);
  }
  const masked = String(input.maskedIdentifier || input.masked_identifier || '');
  if (/\d{8,}/.test(masked)) throw assetAccountError('ASSET_ACCOUNT_SECRET_FORBIDDEN', 400);
}

function canonicalAccountType(value) {
  const accountType = ACCOUNT_TYPE_ALIASES.get(String(value || '').trim());
  if (!accountType || !ACCOUNT_TYPES.has(accountType)) throw assetAccountError('ASSET_ACCOUNT_TYPE_INVALID');
  return accountType;
}

function project(row) {
  if (!row) return null;
  return Object.freeze({
    accountId: row.account_id,
    authorityId: row.authority_id,
    ownerUserId: row.owner_user_id,
    accountType: row.account_type,
    provider: row.provider || null,
    label: row.label,
    maskedIdentifier: row.masked_identifier || null,
    balance: Number(row.balance),
    currency: row.currency,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function createPersonalAssetAccountService({
  db,
  now = () => new Date().toISOString(),
  createId = () => crypto.randomUUID(),
} = {}) {
  if (!db || typeof db.prepare !== 'function') {
    throw assetAccountError('ASSET_ACCOUNT_DATABASE_REQUIRED', 500);
  }
  const find = db.prepare('SELECT * FROM asset_accounts WHERE account_id=?');

  function currentTime() {
    const value = new Date(now());
    if (!Number.isFinite(value.getTime())) throw assetAccountError('ASSET_ACCOUNT_CLOCK_INVALID', 500);
    return value.toISOString();
  }

  function actorId(actor = {}) {
    return text(actor.userId || actor.id, 'ASSET_ACCOUNT_ACTOR_REQUIRED');
  }

  function create(input = {}) {
    assertNoSecret(input);
    const owner = actorId(input.actor);
    const authorityId = text(input.authorityId, 'ASSET_ACCOUNT_AUTHORITY_REQUIRED');
    const accountType = canonicalAccountType(input.accountType);
    const accountId = text(createId(), 'ASSET_ACCOUNT_ID_INVALID');
    const timestamp = currentTime();
    const balance = Number(input.balance || 0);
    if (!Number.isFinite(balance)) throw assetAccountError('ASSET_ACCOUNT_BALANCE_INVALID');
    db.prepare(`INSERT INTO asset_accounts
      (account_id,authority_id,owner_user_id,account_type,provider,label,masked_identifier,balance,currency,status,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,'active',?,?)`)
      .run(
        accountId,
        authorityId,
        owner,
        accountType,
        text(input.provider, 'ASSET_ACCOUNT_PROVIDER_INVALID', 128, true),
        text(input.label, 'ASSET_ACCOUNT_LABEL_REQUIRED', 128),
        text(input.maskedIdentifier, 'ASSET_ACCOUNT_MASK_INVALID', 64, true),
        balance,
        text(input.currency || 'CNY', 'ASSET_ACCOUNT_CURRENCY_INVALID', 8),
        timestamp,
        timestamp
      );
    return project(find.get(accountId));
  }

  function list({ actor, authorityId, ownerUserId } = {}) {
    const requester = actorId(actor);
    const authority = text(authorityId, 'ASSET_ACCOUNT_AUTHORITY_REQUIRED');
    const requestedOwner = String(ownerUserId || requester).trim();
    if (requestedOwner !== requester && !isAdmin(actor)) {
      throw assetAccountError('ASSET_ACCOUNT_FORBIDDEN', 403);
    }
    return Object.freeze(db.prepare(`SELECT * FROM asset_accounts
      WHERE authority_id=? AND owner_user_id=? AND status='active' ORDER BY created_at,account_id`)
      .all(authority, requestedOwner).map(project));
  }

  function update({ actor, accountId, changes = {} } = {}) {
    assertNoSecret(changes);
    const requester = actorId(actor);
    const id = text(accountId, 'ASSET_ACCOUNT_ID_REQUIRED');
    const existing = find.get(id);
    if (!existing) throw assetAccountError('ASSET_ACCOUNT_NOT_FOUND', 404);
    if (existing.owner_user_id !== requester && !isAdmin(actor)) {
      throw assetAccountError('ASSET_ACCOUNT_FORBIDDEN', 403);
    }
    const allowed = new Set(['provider', 'label', 'maskedIdentifier', 'balance', 'currency', 'status']);
    if (!changes || typeof changes !== 'object' || Object.keys(changes).some(key => !allowed.has(key))) {
      throw assetAccountError('ASSET_ACCOUNT_CHANGES_INVALID');
    }
    const next = {
      provider: Object.hasOwn(changes, 'provider')
        ? text(changes.provider, 'ASSET_ACCOUNT_PROVIDER_INVALID', 128, true) : existing.provider,
      label: Object.hasOwn(changes, 'label')
        ? text(changes.label, 'ASSET_ACCOUNT_LABEL_REQUIRED', 128) : existing.label,
      maskedIdentifier: Object.hasOwn(changes, 'maskedIdentifier')
        ? text(changes.maskedIdentifier, 'ASSET_ACCOUNT_MASK_INVALID', 64, true) : existing.masked_identifier,
      balance: Object.hasOwn(changes, 'balance') ? Number(changes.balance) : Number(existing.balance),
      currency: Object.hasOwn(changes, 'currency')
        ? text(changes.currency, 'ASSET_ACCOUNT_CURRENCY_INVALID', 8) : existing.currency,
      status: Object.hasOwn(changes, 'status') ? String(changes.status) : existing.status,
    };
    if (!Number.isFinite(next.balance)) throw assetAccountError('ASSET_ACCOUNT_BALANCE_INVALID');
    if (!['active', 'archived'].includes(next.status)) throw assetAccountError('ASSET_ACCOUNT_STATUS_INVALID');
    db.prepare(`UPDATE asset_accounts SET
      provider=?,label=?,masked_identifier=?,balance=?,currency=?,status=?,updated_at=? WHERE account_id=?`)
      .run(next.provider, next.label, next.maskedIdentifier, next.balance, next.currency, next.status, currentTime(), id);
    return project(find.get(id));
  }

  function recognizeOrCreate(input = {}) {
    assertNoSecret(input);
    const owner = actorId(input.actor);
    const authorityId = text(input.authorityId, 'ASSET_ACCOUNT_AUTHORITY_REQUIRED');
    const accountType = canonicalAccountType(input.accountType);
    const provider = text(input.provider, 'ASSET_ACCOUNT_PROVIDER_INVALID', 128);
    const maskedIdentifier = text(input.maskedIdentifier, 'ASSET_ACCOUNT_MASK_REQUIRED', 64);
    if (!/[\*\u2022]/.test(maskedIdentifier)) throw assetAccountError('ASSET_ACCOUNT_MASK_REQUIRED');
    const matches = db.prepare(`SELECT * FROM asset_accounts
      WHERE authority_id=? AND owner_user_id=? AND account_type=? AND provider IS ?
        AND masked_identifier=? AND status='active' ORDER BY account_id`)
      .all(authorityId, owner, accountType, provider, maskedIdentifier);
    if (matches.length > 1) throw assetAccountError('ASSET_ACCOUNT_CANDIDATE_AMBIGUOUS', 409);
    if (matches.length === 1) return Object.freeze({ account: project(matches[0]), created: false });
    return Object.freeze({
      account: create({ ...input, accountType, provider, maskedIdentifier }),
      created: true,
    });
  }

  return Object.freeze({ create, list, update, recognizeOrCreate });
}

module.exports = { createPersonalAssetAccountService, assetAccountError };
