'use strict';

const Database = require('better-sqlite3');
const { types } = require('util');
const { createHash } = require('crypto');
const { withVNextPg17CopyOnlyRehearsalTarget } = require('./disposableRuntime');

const sources = new WeakMap();
const COLLECTIONS = Object.freeze(['authorities', 'accounts', 'trustedDevices', 'installations', 'links', 'roleGrants', 'capabilityCatalog', 'capabilityOverrides', 'dataScopeGrants', 'profileBindings', 'verifiedContacts', 'receipts', 'auditEvents', 'outboxEvents', 'legacySessions', 'legacyDeviceGrants', 'legacyOfflineLicenses', 'legacyCredentials', 'legacyTokens', 'legacyPasswords', 'legacyPrivateKeys', 'legacyBackups']);
const IDENTITY_COLLECTIONS = Object.freeze(['authorities', 'accounts', 'trustedDevices', 'installations', 'links']);
const DEFERRED_MAPPED_COLLECTIONS = Object.freeze(COLLECTIONS.filter(key => !IDENTITY_COLLECTIONS.includes(key) && !key.startsWith('legacy')));
const INERT_ARCHIVE_COLLECTIONS = Object.freeze(COLLECTIONS.filter(key => key.startsWith('legacy')));
const IDENTITY_FIELDS = Object.freeze({
  authorities: Object.freeze(['authority_id', 'status', 'created_at', 'updated_at']),
  accounts: Object.freeze(['account_id', 'authority_id', 'status', 'auth_version', 'access_version', 'revocation_version', 'row_version', 'created_at', 'updated_at']),
  trustedDevices: Object.freeze(['device_id', 'authority_id', 'status', 'hardware_evidence_hash', 'risk_code', 'credential_version', 'risk_version', 'row_version', 'created_at', 'updated_at', 'revoked_at']),
  installations: Object.freeze(['installation_id', 'authority_id', 'device_id', 'installation_public_key', 'key_fingerprint', 'status', 'credential_version', 'row_version', 'created_at', 'updated_at', 'revoked_at']),
  links: Object.freeze(['link_id', 'authority_id', 'account_id', 'device_id', 'installation_id', 'status', 'auth_version', 'access_version', 'row_version', 'created_at', 'updated_at', 'revoked_at']),
});

function fail(code) { const error = new Error(code); error.code = code; return error; }
function clone(value) {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(clone));
  if (!value || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) throw fail('VNEXT_PG17_COPY_REHEARSAL_SOURCE_INVALID');
  return Object.freeze(Object.fromEntries(Reflect.ownKeys(value).sort().map(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) throw fail('VNEXT_PG17_COPY_REHEARSAL_SOURCE_INVALID');
    return [key, clone(descriptor.value)];
  })));
}
function canonical(value) {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).sort().join(',')}]`;
  return `{${Reflect.ownKeys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}
function sha256(value) { return createHash('sha256').update(canonical(value), 'utf8').digest('hex'); }
function canonicalCollectionRows(rows) { return [...rows].sort((left, right) => {
  const leftText = canonical(left);
  const rightText = canonical(right);
  return leftText < rightText ? -1 : leftText > rightText ? 1 : 0;
}); }
function normalizedSnapshot(snapshot, collections = COLLECTIONS) { return collections.map(key => [key, canonicalCollectionRows(snapshot[key])]); }
function normalizeIdentityRow(row) {
  return Object.fromEntries(Reflect.ownKeys(row).sort().map(key => {
    const value = row[key];
    if (key.endsWith('_at') && value !== null) return [key, new Date(value).toISOString()];
    if (key.endsWith('_version')) return [key, Number(value)];
    return [key, value];
  }));
}
function identityLogicalRows(snapshot) { return IDENTITY_COLLECTIONS.map(key => [key, canonicalCollectionRows(snapshot[key].map(normalizeIdentityRow))]); }
function fingerprint(value) { return sha256(normalizedSnapshot(value)); }
function inventory(snapshot) {
  return Object.freeze(Object.fromEntries(INERT_ARCHIVE_COLLECTIONS.map(key => [key, Object.freeze({
    count: snapshot[key].length,
    sha256: sha256(canonicalCollectionRows(snapshot[key])),
  })])));
}
function sameKeys(value, fields) { return Reflect.ownKeys(value).length === fields.length && fields.every(key => Object.prototype.hasOwnProperty.call(value, key)); }
function nonBlank(value) { return typeof value === 'string' && value.trim() !== ''; }
function finiteInstant(value) { return typeof value === 'string' && (() => { try { return new Date(value).toISOString() === value; } catch (_) { return false; } })(); }
function positiveInteger(value) { return Number.isSafeInteger(value) && value >= 1; }
function validVersions(row, keys) { return keys.every(key => positiveInteger(row[key])); }
function validTimestamps(row, keys) { return keys.every(key => finiteInstant(row[key])) && Date.parse(row.updated_at) >= Date.parse(row.created_at); }
function validIdentityTopology(snapshot) {
  const authority = snapshot.authorities[0];
  if (!sameKeys(authority, IDENTITY_FIELDS.authorities) || !nonBlank(authority.authority_id) || authority.status !== 'active' || !validTimestamps(authority, ['created_at', 'updated_at'])) return false;
  const authorityId = authority.authority_id;
  const accounts = new Set();
  for (const row of snapshot.accounts) {
    if (!sameKeys(row, IDENTITY_FIELDS.accounts) || !nonBlank(row.account_id) || row.authority_id !== authorityId || row.status !== 'active'
      || !validVersions(row, ['auth_version', 'access_version', 'revocation_version', 'row_version']) || !validTimestamps(row, ['created_at', 'updated_at']) || accounts.has(row.account_id)) return false;
    accounts.add(row.account_id);
  }
  const devices = new Set();
  for (const row of snapshot.trustedDevices) {
    if (!sameKeys(row, IDENTITY_FIELDS.trustedDevices) || !nonBlank(row.device_id) || row.authority_id !== authorityId || row.status !== 'active' || row.revoked_at !== null
      || ![row.hardware_evidence_hash, row.risk_code].every(value => value === null || nonBlank(value)) || !validVersions(row, ['credential_version', 'risk_version', 'row_version']) || !validTimestamps(row, ['created_at', 'updated_at']) || devices.has(row.device_id)) return false;
    devices.add(row.device_id);
  }
  const installations = new Set();
  for (const row of snapshot.installations) {
    if (!sameKeys(row, IDENTITY_FIELDS.installations) || !nonBlank(row.installation_id) || row.authority_id !== authorityId || !devices.has(row.device_id) || row.status !== 'active' || row.revoked_at !== null
      || !nonBlank(row.installation_public_key) || !/^[0-9a-f]{64}$/.test(row.key_fingerprint) || !validVersions(row, ['credential_version', 'row_version']) || !validTimestamps(row, ['created_at', 'updated_at']) || installations.has(row.installation_id)) return false;
    installations.add(row.installation_id);
  }
  const links = new Set();
  for (const row of snapshot.links) {
    if (!sameKeys(row, IDENTITY_FIELDS.links) || !nonBlank(row.link_id) || row.authority_id !== authorityId || !accounts.has(row.account_id) || !devices.has(row.device_id) || !installations.has(row.installation_id) || row.status !== 'active' || row.revoked_at !== null
      || !validVersions(row, ['auth_version', 'access_version', 'row_version']) || !validTimestamps(row, ['created_at', 'updated_at']) || links.has(row.link_id)) return false;
    links.add(row.link_id);
  }
  return true;
}
function sourceTable(collection) { return `legacy_source_${collection}`; }
function readSnapshot(database) {
  const snapshot = {};
  for (const collection of COLLECTIONS) {
    snapshot[collection] = database.prepare(`SELECT row_json FROM ${sourceTable(collection)} ORDER BY ordinal`).all().map(row => JSON.parse(row.row_json));
  }
  return clone(snapshot);
}

function createVNextPg17SyntheticControlPlaneSource(snapshot) {
  const copy = clone(snapshot);
  if (Reflect.ownKeys(copy).length !== COLLECTIONS.length
    || COLLECTIONS.some(key => !Array.isArray(copy[key]))
    || copy.authorities.length !== 1 || copy.authorities[0].status !== 'active'
    || DEFERRED_MAPPED_COLLECTIONS.some(key => copy[key].length !== 0)
    || !validIdentityTopology(copy)) {
    throw fail('VNEXT_PG17_COPY_REHEARSAL_SOURCE_INVALID');
  }
  const database = new Database(':memory:');
  database.exec(`${COLLECTIONS.map(collection => `CREATE TABLE ${sourceTable(collection)} (ordinal INTEGER PRIMARY KEY, row_json TEXT NOT NULL)`).join(';')}; CREATE TABLE legacy_control_plane_fingerprint (value TEXT NOT NULL)`);
  for (const collection of COLLECTIONS) for (const [ordinal, row] of canonicalCollectionRows(copy[collection]).entries()) database.prepare(`INSERT INTO ${sourceTable(collection)}(ordinal,row_json) VALUES(?,?)`).run(ordinal, canonical(row));
  database.prepare('INSERT INTO legacy_control_plane_fingerprint(value) VALUES(?)').run(fingerprint(copy));
  const source = Object.freeze({});
  sources.set(source, { database });
  return source;
}

async function rehearseVNextPg17ControlPlaneCopy({ source, target, faultPlan } = {}) {
  const state = sources.get(source);
  if (!state || !target) throw fail('VNEXT_PG17_COPY_REHEARSAL_INPUT_INVALID');
  const before = state.database.prepare('SELECT value FROM legacy_control_plane_fingerprint').get().value;
  const snapshot = readSnapshot(state.database);
  if (before !== fingerprint(snapshot)) throw fail('VNEXT_PG17_COPY_REHEARSAL_SOURCE_CHANGED');
  const sourceIdentityLogicalSha256 = sha256(identityLogicalRows(snapshot));
  try {
  const report = await withVNextPg17CopyOnlyRehearsalTarget(target, async facade => {
    if ((await facade.countTargetDataRows()).some(row => row.count !== 0)) throw fail('VNEXT_PG17_COPY_REHEARSAL_TARGET_NOT_EMPTY');
    const row = snapshot.authorities[0];
    await facade.insertAuthority(row);
    for (const collection of ['accounts', 'trustedDevices', 'installations', 'links']) for (const item of snapshot[collection]) await facade.insertFoundation(collection, item);
    const targetIdentity = await facade.readIdentityTopology();
    const targetSnapshot = Object.fromEntries(IDENTITY_COLLECTIONS.map(collection => [collection, targetIdentity[collection]]));
    const targetIdentityLogicalSha256 = sha256(identityLogicalRows(targetSnapshot));
    if (targetIdentityLogicalSha256 !== sourceIdentityLogicalSha256) throw fail('VNEXT_PG17_COPY_REHEARSAL_LOGICAL_MISMATCH');
    return Object.freeze({ status: 'boundary-verified', schemaVersion: 5, migrationVersion: 15, authorityCount: targetSnapshot.authorities.length, accountCount: targetSnapshot.accounts.length, deviceCount: targetSnapshot.trustedDevices.length, installationCount: targetSnapshot.installations.length, linkCount: targetSnapshot.links.length, sourceIdentityLogicalSha256, targetIdentityLogicalSha256, activeRoleGrantCount: 0, activeCapabilityOverrideCount: 0, activeScopeGrantCount: 0, activeSessionCount: 0, activeReauthenticationCount: 0, outboxDispatchedCount: 0, inertInventory: inventory(snapshot), rollback: Object.freeze({ attempted: false, restoredEmpty: false }) });
  }, faultPlan);
  const after = fingerprint(readSnapshot(state.database));
  if (before !== after) throw fail('VNEXT_PG17_COPY_REHEARSAL_SOURCE_CHANGED');
  return Object.freeze({ ...report, sourceFingerprintBefore: before, sourceFingerprintAfter: after });
  } catch (caught) {
    if (caught && caught.code) throw caught;
    throw fail('VNEXT_PG17_COPY_REHEARSAL_ROLLED_BACK');
  }
}

module.exports = { createVNextPg17SyntheticControlPlaneSource, rehearseVNextPg17ControlPlaneCopy };
