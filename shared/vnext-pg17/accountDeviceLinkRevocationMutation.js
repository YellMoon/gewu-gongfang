'use strict';

const crypto = require('node:crypto');
const { types } = require('node:util');
const { isVNextPg17DisposableHandleForRuntime, withVNextPg17SyntheticQuery } = require('./disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('./catalogAssertion');
const { isVNextPg17AccessContextResolverForHandle } = require('./accessContextResolver');

const CONFIG_KEYS = ['runtime', 'handle', 'resolver', 'now', 'idFactory', 'testHooks'];
const COMMAND_KEYS = ['type', 'targetLinkId', 'expectedTargetRowVersion', 'idempotencyKey', 'reasonCode'];

function failure(code) { return Object.assign(new Error(code), { code }); }
function hash(value) { return crypto.createHash('sha256').update(value, 'utf8').digest('hex'); }
function stable(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) throw failure('ACCOUNT_DEVICE_LINK_REVOCATION_INPUT_INVALID');
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}
function instant(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value; }
function text(value, code = 'ACCOUNT_DEVICE_LINK_REVOCATION_INPUT_INVALID') { if (typeof value !== 'string' || value.trim() === '') throw failure(code); return value.trim(); }
function ownData(value, keys, required = keys) {
  if (!value || typeof value !== 'object' || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
  const own = Reflect.ownKeys(value);
  if (own.some(key => typeof key !== 'string' || !keys.includes(key)) || required.some(key => !own.includes(key))) return null;
  const copy = {};
  for (const key of own) { const d = Object.getOwnPropertyDescriptor(value, key); if (!d || !d.enumerable || !Object.hasOwn(d, 'value')) return null; copy[key] = d.value; }
  return copy;
}
function configSnapshot(value) {
  const copy = ownData(value, CONFIG_KEYS, ['runtime', 'handle', 'resolver', 'now', 'idFactory']);
  if (!copy || types.isProxy(copy.now) || types.isProxy(copy.idFactory) || typeof copy.now !== 'function' || typeof copy.idFactory !== 'function') return null;
  if (copy.testHooks !== undefined) { const hooks = ownData(copy.testHooks, ['afterWrite']); if (!hooks || types.isProxy(hooks.afterWrite) || typeof hooks.afterWrite !== 'function') return null; }
  return copy;
}
function commandSnapshot(value) {
  const copy = ownData(value, COMMAND_KEYS);
  if (!copy || Reflect.ownKeys(copy).length !== COMMAND_KEYS.length || copy.type !== 'account_device_link.revoke' || !Number.isSafeInteger(copy.expectedTargetRowVersion) || copy.expectedTargetRowVersion < 1) throw failure('ACCOUNT_DEVICE_LINK_REVOCATION_INPUT_INVALID');
  for (const key of ['targetLinkId', 'idempotencyKey', 'reasonCode']) copy[key] = text(copy[key]);
  return Object.freeze(copy);
}
function allowed(context, timestamp) {
  return !!context && context.surface === 'desktop' && typeof context.authorityId === 'string' && typeof context.accountId === 'string' && typeof context.linkId === 'string'
    && Array.isArray(context.roles) && context.roles.includes('super_admin') && Array.isArray(context.capabilityIds) && context.capabilityIds.includes('device.revoke')
    && instant(context.reauthenticatedUntil) && Date.parse(context.reauthenticatedUntil) > Date.parse(timestamp) && Number.isSafeInteger(context.policyRevision) && context.policyRevision >= 1;
}
function validExecutionContext(value, accountId) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const keys = Object.keys(value).sort();
  return keys.length === 3 && keys[0] === 'accountId' && keys[1] === 'linkId' && keys[2] === 'policyRevision'
    && value.accountId === accountId && typeof value.linkId === 'string' && value.linkId.trim() !== ''
    && Number.isSafeInteger(value.policyRevision) && value.policyRevision >= 1;
}
function exactKeys(value, keys) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function validReplayEnvelope(receipt, result, command, authorityId, actorAccountId) {
  const common = receipt.authority_id === authorityId && receipt.actor_key === `account:${actorAccountId}` && receipt.actor_account_id === actorAccountId
    && receipt.command_type === command.type && receipt.target_kind === 'account_device_link' && receipt.target_id === command.targetLinkId
    && String(receipt.expected_row_version) === String(command.expectedTargetRowVersion) && validExecutionContext(result.context, actorAccountId);
  if (!common || typeof result.code !== 'string' || typeof result.status !== 'string' || receipt.result_code !== result.code) return false;
  if (result.status === 'accepted') {
    return exactKeys(result, ['code', 'context', 'linkId', 'status']) && result.code === 'ACCOUNT_DEVICE_LINK_REVOKED' && result.linkId === command.targetLinkId
      && receipt.outcome === 'accepted' && receipt.committed_revocation_version === null
      && ['committed_auth_version', 'committed_access_version', 'committed_target_row_version'].every(key => Number.isSafeInteger(Number(receipt[key])) && Number(receipt[key]) >= 1);
  }
  if (result.status === 'noop') {
    return exactKeys(result, ['code', 'context', 'linkId', 'status']) && result.code === 'LINK_ALREADY_REVOKED' && result.linkId === command.targetLinkId
      && receipt.outcome === 'noop' && ['committed_auth_version', 'committed_access_version', 'committed_revocation_version', 'committed_target_row_version'].every(key => receipt[key] === null);
  }
  return exactKeys(result, ['code', 'context', 'status']) && result.status === 'rejected'
    && ['SELF_LINK_REVOKE_FORBIDDEN', 'TARGET_LINK_NOT_ACTIVE', 'LINK_VERSION_CONFLICT'].includes(result.code)
    && receipt.outcome === 'rejected' && ['committed_auth_version', 'committed_access_version', 'committed_revocation_version', 'committed_target_row_version'].every(key => receipt[key] === null);
}

function createVNextPg17AccountDeviceLinkRevocationMutation(config) {
  const settings = configSnapshot(config);
  if (!settings || !isVNextPg17DisposableHandleForRuntime(settings.runtime, settings.handle) || !isVNextPg17AccessContextResolverForHandle(settings.resolver, settings.handle)) throw failure('ACCOUNT_DEVICE_LINK_REVOCATION_WRITER_INVALID');
  const catalog = createVNextPg17CatalogBoundary(settings.runtime);
  const nextId = kind => text(settings.idFactory(kind), 'ACCOUNT_DEVICE_LINK_REVOCATION_ID_INVALID');
  const hook = async stage => { if (settings.testHooks) await settings.testHooks.afterWrite(Object.freeze({ stage })); };

  async function execute(assertion, input) {
    const command = commandSnapshot(input);
    let context; try { context = await settings.resolver.resolve(assertion); } catch (_) { throw failure('ACCOUNT_DEVICE_LINK_REVOCATION_UNAUTHORIZED'); }
    let timestamp; try { timestamp = settings.now(); } catch (_) { throw failure('ACCOUNT_DEVICE_LINK_REVOCATION_INPUT_INVALID'); }
    if (!instant(timestamp) || !allowed(context, timestamp)) throw failure('ACCOUNT_DEVICE_LINK_REVOCATION_UNAUTHORIZED');
    const authorityId = text(context.authorityId, 'ACCOUNT_DEVICE_LINK_REVOCATION_UNAUTHORIZED');
    const actorAccountId = text(context.accountId, 'ACCOUNT_DEVICE_LINK_REVOCATION_UNAUTHORIZED');
    const executionContext = Object.freeze({ accountId: actorAccountId, linkId: text(context.linkId, 'ACCOUNT_DEVICE_LINK_REVOCATION_UNAUTHORIZED'), policyRevision: context.policyRevision });
    const requestHash = hash(stable({ type: command.type, targetLinkId: command.targetLinkId, expectedTargetRowVersion: command.expectedTargetRowVersion, reasonCode: command.reasonCode }));
    await catalog.assert(settings.handle);
    return withVNextPg17SyntheticQuery(settings.handle, 'fixture-provisioner', async facade => {
      try {
        await facade.query('BEGIN');
        await facade.query("SELECT pg_advisory_xact_lock(hashtextextended('vnext:link:' || $1, 0))", [authorityId]);
        const existing = await facade.query('SELECT * FROM vnext_control_plane.vnext_authorization_command_receipts WHERE authority_id=$1 AND actor_key=$2 AND idempotency_key=$3 FOR UPDATE', [authorityId, `account:${actorAccountId}`, command.idempotencyKey]);
        if (existing.rows.length === 1) {
          const receipt = existing.rows[0];
          if (receipt.canonical_request_sha256 !== requestHash) throw failure('IDEMPOTENCY_KEY_CONFLICT');
          let result; try { result = JSON.parse(receipt.canonical_result_json); } catch (_) { throw failure('IDEMPOTENCY_RECEIPT_INVALID'); }
          const audit = await facade.query('SELECT reason_code,context_sha256 FROM vnext_control_plane.vnext_authorization_audit_events WHERE authority_id=$1 AND receipt_id=$2', [authorityId, receipt.receipt_id]);
          const outbox = await facade.query('SELECT * FROM vnext_control_plane.vnext_authorization_outbox_events WHERE authority_id=$1 AND receipt_id=$2', [authorityId, receipt.receipt_id]);
          if (hash(receipt.canonical_result_json) !== receipt.canonical_result_sha256 || stable(result) !== receipt.canonical_result_json || !validReplayEnvelope(receipt, result, command, authorityId, actorAccountId) || audit.rows.length !== 1 || audit.rows[0].reason_code !== command.reasonCode || audit.rows[0].context_sha256 !== hash(stable(result.context))) throw failure('IDEMPOTENCY_RECEIPT_INVALID');
          if (result.status === 'accepted') {
            const links = await facade.query('SELECT * FROM vnext_control_plane.vnext_account_device_links WHERE authority_id=$1 AND link_id=$2', [authorityId, result.linkId]);
            const payload = stable({ authorityId, linkAuthVersion: Number(receipt.committed_auth_version), linkId: result.linkId, linkAccessVersion: Number(receipt.committed_access_version), linkRowVersion: Number(receipt.committed_target_row_version) });
            if (links.rows.length !== 1 || links.rows[0].status !== 'revoked' || String(links.rows[0].auth_version) !== String(receipt.committed_auth_version) || String(links.rows[0].access_version) !== String(receipt.committed_access_version) || String(links.rows[0].row_version) !== String(receipt.committed_target_row_version) || outbox.rows.length !== 1 || outbox.rows[0].event_type !== 'authorization.account_device_link_revoked' || outbox.rows[0].aggregate_kind !== 'account_device_link' || outbox.rows[0].aggregate_id !== result.linkId || String(outbox.rows[0].aggregate_version) !== String(receipt.committed_target_row_version) || outbox.rows[0].canonical_payload_json !== payload || outbox.rows[0].payload_sha256 !== hash(payload)) throw failure('IDEMPOTENCY_RECEIPT_INVALID');
          } else if (outbox.rows.length !== 0) throw failure('IDEMPOTENCY_RECEIPT_INVALID');
          await facade.query('COMMIT'); const { context: ignored, ...output } = result; return Object.freeze({ ...output, replayed: true });
        }
        const authority = await facade.query("SELECT authority_id FROM vnext_control_plane.vnext_authorities WHERE authority_id=$1 AND status='active' FOR UPDATE", [authorityId]);
        const actor = await facade.query("SELECT account_id FROM vnext_control_plane.vnext_accounts WHERE authority_id=$1 AND account_id=$2 AND status='active' FOR UPDATE", [authorityId, actorAccountId]);
        if (authority.rows.length !== 1 || actor.rows.length !== 1) throw failure('ACCOUNT_DEVICE_LINK_REVOCATION_UNAUTHORIZED');
        const record = async ({ outcome, code, result, versions = {}, outbox = null }) => {
          const stored = { ...result, context: executionContext }; const json = stable(stored); const receiptId = nextId('link-receipt');
          await facade.query('INSERT INTO vnext_control_plane.vnext_authorization_command_receipts(receipt_id,authority_id,actor_key,actor_account_id,idempotency_key,command_type,target_kind,target_id,canonical_request_sha256,expected_row_version,outcome,result_code,canonical_result_json,canonical_result_sha256,committed_auth_version,committed_access_version,committed_revocation_version,committed_target_row_version,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NULL,$17,$18)', [receiptId, authorityId, `account:${actorAccountId}`, actorAccountId, command.idempotencyKey, command.type, 'account_device_link', command.targetLinkId, requestHash, command.expectedTargetRowVersion, outcome, code, json, hash(json), versions.auth || null, versions.access || null, versions.target || null, timestamp]);
          await hook('receipt');
          await facade.query('INSERT INTO vnext_control_plane.vnext_authorization_audit_events(event_id,authority_id,receipt_id,reason_code,context_sha256,created_at) VALUES($1,$2,$3,$4,$5,$6)', [nextId('link-audit'), authorityId, receiptId, command.reasonCode, hash(stable(executionContext)), timestamp]);
          await hook('audit');
          if (outbox) { const payload = stable(outbox); await facade.query("INSERT INTO vnext_control_plane.vnext_authorization_outbox_events(event_id,authority_id,receipt_id,event_type,aggregate_kind,aggregate_id,aggregate_version,canonical_payload_json,payload_sha256,occurred_at) VALUES($1,$2,$3,'authorization.account_device_link_revoked','account_device_link',$4,$5,$6,$7,$8)", [nextId('link-outbox'), authorityId, receiptId, command.targetLinkId, versions.target, payload, hash(payload), timestamp]); await hook('outbox'); }
          return Object.freeze({ ...result, replayed: false });
        };
        if (command.targetLinkId === executionContext.linkId) { const result = await record({ outcome: 'rejected', code: 'SELF_LINK_REVOKE_FORBIDDEN', result: { code: 'SELF_LINK_REVOKE_FORBIDDEN', status: 'rejected' } }); await facade.query('COMMIT'); return result; }
        const targets = await facade.query('SELECT * FROM vnext_control_plane.vnext_account_device_links WHERE authority_id=$1 AND link_id=$2 FOR UPDATE', [authorityId, command.targetLinkId]);
        if (targets.rows.length !== 1) { const result = await record({ outcome: 'rejected', code: 'TARGET_LINK_NOT_ACTIVE', result: { code: 'TARGET_LINK_NOT_ACTIVE', status: 'rejected' } }); await facade.query('COMMIT'); return result; }
        const target = targets.rows[0];
        if (target.status === 'revoked') { const result = await record({ outcome: 'noop', code: 'LINK_ALREADY_REVOKED', result: { code: 'LINK_ALREADY_REVOKED', linkId: target.link_id, status: 'noop' } }); await facade.query('COMMIT'); return result; }
        if (target.status !== 'active' || String(target.row_version) !== String(command.expectedTargetRowVersion)) { const result = await record({ outcome: 'rejected', code: 'LINK_VERSION_CONFLICT', result: { code: 'LINK_VERSION_CONFLICT', status: 'rejected' } }); await facade.query('COMMIT'); return result; }
        const updated = await facade.query("UPDATE vnext_control_plane.vnext_account_device_links SET status='revoked',auth_version=auth_version+1,access_version=access_version+1,row_version=row_version+1,revoked_at=$1,updated_at=$1 WHERE authority_id=$2 AND link_id=$3 AND status='active' AND row_version=$4", [timestamp, authorityId, target.link_id, target.row_version]);
        if (updated.rowCount !== 1) throw failure('LINK_VERSION_CONFLICT');
        await hook('target');
        const versions = { auth: Number(target.auth_version) + 1, access: Number(target.access_version) + 1, target: Number(target.row_version) + 1 };
        const result = await record({ outcome: 'accepted', code: 'ACCOUNT_DEVICE_LINK_REVOKED', result: { code: 'ACCOUNT_DEVICE_LINK_REVOKED', linkId: target.link_id, status: 'accepted' }, versions, outbox: { authorityId, linkAuthVersion: versions.auth, linkId: target.link_id, linkAccessVersion: versions.access, linkRowVersion: versions.target } });
        await facade.query('COMMIT'); return result;
      } catch (error) {
        try { await facade.query('ROLLBACK'); } catch (_) { /* no-op */ }
        if (error && typeof error.code === 'string' && /^(ACCOUNT_DEVICE_LINK_REVOCATION_|LINK_|SELF_|TARGET_|IDEMPOTENCY_)/.test(error.code)) throw error;
        throw failure('ACCOUNT_DEVICE_LINK_REVOCATION_UNAVAILABLE');
      }
    });
  }
  return Object.freeze({ execute });
}
module.exports = Object.freeze({ createVNextPg17AccountDeviceLinkRevocationMutation });
