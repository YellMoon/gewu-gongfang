const crypto = require('crypto');
const { types } = require('util');

const fixtureStates = new WeakMap();

const ROW_KEYS = Object.freeze([
  'account_id', 'authority_id', 'owner_user_id', 'account_type', 'provider',
  'label', 'masked_identifier', 'balance', 'currency', 'status', 'created_at',
  'updated_at',
]);

function syntheticError(code, statusCode = 400) {
  return Object.assign(new Error(code), { code, statusCode });
}

function ownPlainData(value, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value)) {
    throw syntheticError(code);
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) throw syntheticError(code);
  const copy = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') throw syntheticError(code);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw syntheticError(code);
    }
    copy[key] = descriptor.value;
  }
  return copy;
}

function exactObject(value, allowedKeys, requiredKeys, code) {
  const copy = ownPlainData(value, code);
  const keys = Object.keys(copy);
  if (keys.some(key => !allowedKeys.includes(key)) || requiredKeys.some(key => !Object.hasOwn(copy, key))) {
    throw syntheticError(code);
  }
  return copy;
}

function denseDataArray(value, code) {
  if (!Array.isArray(value) || types.isProxy(value)) throw syntheticError(code);
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, 'value') || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0) {
    throw syntheticError(code);
  }
  const length = lengthDescriptor.value;
  const expected = new Set(['length']);
  for (let index = 0; index < length; index += 1) expected.add(String(index));
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expected.size || keys.some(key => typeof key !== 'string' || !expected.has(key))) {
    throw syntheticError(code);
  }
  const result = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw syntheticError(code);
    result.push(descriptor.value);
  }
  return result;
}

function requiredText(value, code, { fictional = false } = {}) {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > 128) {
    throw syntheticError(code);
  }
  if (fictional && (/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(value) || /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value) || /\d{6,}/.test(value))) {
    throw syntheticError(code);
  }
  return value;
}

function optionalText(value, code, options) {
  if (value === null) return null;
  return requiredText(value, code, options);
}

function canonicalInstant(value, code) {
  const text = requiredText(value, code);
  const instant = new Date(text);
  if (!Number.isFinite(instant.getTime()) || instant.toISOString() !== text) throw syntheticError(code);
  return text;
}

function cloneRow(value, code) {
  const row = exactObject(value, ROW_KEYS, ROW_KEYS, code);
  const copy = {
    account_id: requiredText(row.account_id, code, { fictional: true }),
    authority_id: requiredText(row.authority_id, code, { fictional: true }),
    owner_user_id: requiredText(row.owner_user_id, code, { fictional: true }),
    account_type: requiredText(row.account_type, code, { fictional: true }),
    provider: optionalText(row.provider, code, { fictional: true }),
    label: requiredText(row.label, code, { fictional: true }),
    masked_identifier: optionalText(row.masked_identifier, code, { fictional: true }),
    balance: row.balance,
    currency: requiredText(row.currency, code, { fictional: true }),
    status: requiredText(row.status, code, { fictional: true }),
    created_at: canonicalInstant(row.created_at, code),
    updated_at: canonicalInstant(row.updated_at, code),
  };
  if (copy.balance !== 0 || !Number.isFinite(copy.balance)) throw syntheticError(code);
  if (!['saving_card', 'credit_card', 'alipay', 'wechat', 'custom'].includes(copy.account_type)) throw syntheticError(code);
  if (!['active', 'archived'].includes(copy.status)) throw syntheticError(code);
  return Object.freeze(copy);
}

function canonicalFixture(rows) {
  return JSON.stringify(rows.map(row => ({
    account_id: row.account_id,
    authority_id: row.authority_id,
    owner_user_id: row.owner_user_id,
    account_type: row.account_type,
    provider: row.provider,
    label: row.label,
    masked_identifier: row.masked_identifier,
    balance: row.balance,
    currency: row.currency,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  })));
}

function createSyntheticPersonalAssetAccountFixture(value) {
  const code = 'SYNTHETIC_ASSET_ACCOUNT_FIXTURE_INVALID';
  const input = exactObject(value, ['accounts'], ['accounts'], code);
  const rows = denseDataArray(input.accounts, code).map(row => cloneRow(row, code));
  const ids = new Set();
  for (const row of rows) {
    if (ids.has(row.account_id)) throw syntheticError(code);
    ids.add(row.account_id);
  }
  rows.sort((left, right) => left.created_at.localeCompare(right.created_at) || left.account_id.localeCompare(right.account_id));
  const frozenRows = Object.freeze(rows);
  const fixture = Object.freeze({});
  fixtureStates.set(fixture, Object.freeze({
    rows: frozenRows,
    fixtureSha256: crypto.createHash('sha256').update(canonicalFixture(frozenRows)).digest('hex'),
  }));
  return fixture;
}

function actor(value, code) {
  const input = exactObject(value, ['userId', 'id', 'role', 'roles'], [], code);
  if (Object.hasOwn(input, 'userId') && Object.hasOwn(input, 'id')) throw syntheticError(code);
  const actorId = Object.hasOwn(input, 'userId')
    ? requiredText(input.userId, 'ASSET_ACCOUNT_ACTOR_REQUIRED')
    : Object.hasOwn(input, 'id') ? requiredText(input.id, 'ASSET_ACCOUNT_ACTOR_REQUIRED') : (() => { throw syntheticError('ASSET_ACCOUNT_ACTOR_REQUIRED'); })();
  if (Object.hasOwn(input, 'role') && Object.hasOwn(input, 'roles')) throw syntheticError(code);
  let roles = [];
  if (Object.hasOwn(input, 'role')) roles = [requiredText(input.role, code)];
  if (Object.hasOwn(input, 'roles')) roles = denseDataArray(input.roles, code).map(role => requiredText(role, code));
  return Object.freeze({ id: actorId, roles: Object.freeze(roles) });
}

function protect(value) {
  Object.defineProperty(value, 'toJSON', {
    enumerable: false,
    value() { throw syntheticError('SYNTHETIC_ASSET_ACCOUNT_SERIALIZATION_FORBIDDEN'); },
  });
  return Object.freeze(value);
}

function project(row) {
  return protect({
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

function createSyntheticPersonalAssetAccountListAdapter(value) {
  const code = 'SYNTHETIC_ASSET_ACCOUNT_ADAPTER_INVALID';
  const input = exactObject(value, ['fixture'], ['fixture'], code);
  const state = fixtureStates.get(input.fixture);
  if (!state) throw syntheticError(code);
  let operationCount = 0;

  function inspect() {
    return Object.freeze({ fixtureSha256: state.fixtureSha256, operationCount });
  }

  function list(value = {}) {
    const inputCode = 'SYNTHETIC_ASSET_ACCOUNT_INPUT_INVALID';
    try {
      const input = exactObject(value, ['actor', 'authorityId', 'ownerUserId'], [], inputCode);
      if (!Object.hasOwn(input, 'actor')) throw syntheticError('ASSET_ACCOUNT_ACTOR_REQUIRED');
      if (!Object.hasOwn(input, 'authorityId')) throw syntheticError('ASSET_ACCOUNT_AUTHORITY_REQUIRED');
      const currentActor = actor(input.actor, inputCode);
      const authorityId = requiredText(input.authorityId, 'ASSET_ACCOUNT_AUTHORITY_REQUIRED');
      const ownerUserId = Object.hasOwn(input, 'ownerUserId')
        ? requiredText(input.ownerUserId, inputCode) : currentActor.id;
      if (ownerUserId !== currentActor.id && !currentActor.roles.some(role => role === 'super_admin')) {
        throw syntheticError('ASSET_ACCOUNT_FORBIDDEN', 403);
      }
      const rows = state.rows
        .filter(row => row.status === 'active' && row.authority_id === authorityId && row.owner_user_id === ownerUserId)
        .map(project);
      operationCount += 1;
      return protect(rows);
    } catch (error) {
      if (String(error?.code || '').startsWith('ASSET_ACCOUNT_')) operationCount += 1;
      throw error;
    }
  }

  return Object.freeze({ list, inspect });
}

module.exports = {
  createSyntheticPersonalAssetAccountFixture,
  createSyntheticPersonalAssetAccountListAdapter,
};
