'use strict';

const crypto = require('node:crypto');
const { types } = require('node:util');
const { isVNextPg17DisposableHandleForRuntime, withVNextPg17SyntheticQuery } = require('./disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('./catalogAssertion');
const { isVNextPg17AccessContextResolverForHandle } = require('./accessContextResolver');

const ROLES = new Set(['super_admin', 'teacher', 'student', 'family_member']);
const CONFIG_KEYS = ['runtime', 'handle', 'resolver', 'now', 'idFactory', 'testHooks'];
const GRANT_KEYS = ['type', 'targetAccountId', 'role', 'expectedTargetRowVersion', 'idempotencyKey', 'reasonCode'];
const REVOKE_KEYS = ['type', 'targetGrantId', 'expectedTargetRowVersion', 'idempotencyKey', 'reasonCode'];

function failure(code) { return Object.assign(new Error(code), { code }); }
function hash(value) { return crypto.createHash('sha256').update(value, 'utf8').digest('hex'); }
function stable(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) throw failure('ROLE_MUTATION_INPUT_INVALID');
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}
function instant(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value; }
function text(value, code = 'ROLE_MUTATION_INPUT_INVALID') { if (typeof value !== 'string' || value.trim() === '') throw failure(code); return value.trim(); }
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
  if (!value || typeof value !== 'object' || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) throw failure('ROLE_MUTATION_INPUT_INVALID');
  const typeDescriptor = Object.getOwnPropertyDescriptor(value, 'type');
  if (!typeDescriptor || !Object.hasOwn(typeDescriptor, 'value')) throw failure('ROLE_MUTATION_INPUT_INVALID');
  const keys = typeDescriptor.value === 'role.grant' ? GRANT_KEYS : typeDescriptor.value === 'role.revoke' ? REVOKE_KEYS : null;
  const copy = keys && ownData(value, keys);
  if (!copy || Reflect.ownKeys(copy).length !== keys.length) throw failure('ROLE_MUTATION_INPUT_INVALID');
  for (const key of keys) if (!['type', 'expectedTargetRowVersion'].includes(key)) copy[key] = text(copy[key]);
  if (!Number.isSafeInteger(copy.expectedTargetRowVersion) || copy.expectedTargetRowVersion < (copy.type === 'role.grant' ? 0 : 1)) throw failure('ROLE_MUTATION_INPUT_INVALID');
  if (copy.type === 'role.grant' && (!ROLES.has(copy.role) || copy.expectedTargetRowVersion !== 0)) throw failure('ROLE_MUTATION_INPUT_INVALID');
  return Object.freeze(copy);
}
function allowed(context, timestamp) {
  return !!context && context.surface === 'desktop' && typeof context.authorityId === 'string' && typeof context.accountId === 'string' && typeof context.linkId === 'string'
    && Array.isArray(context.roles) && context.roles.includes('super_admin') && Array.isArray(context.capabilityIds) && context.capabilityIds.includes('access.manage')
    && instant(context.reauthenticatedUntil) && Date.parse(context.reauthenticatedUntil) > Date.parse(timestamp) && Number.isSafeInteger(context.policyRevision) && context.policyRevision >= 1;
}

function createVNextPg17RoleMutation(config) {
  const settings = configSnapshot(config);
  if (!settings || !isVNextPg17DisposableHandleForRuntime(settings.runtime, settings.handle) || !isVNextPg17AccessContextResolverForHandle(settings.resolver, settings.handle)) throw failure('ROLE_MUTATION_WRITER_INVALID');
  const catalog = createVNextPg17CatalogBoundary(settings.runtime);
  const nextId = kind => text(settings.idFactory(kind), 'ROLE_MUTATION_ID_INVALID');
  const hook = async stage => { if (settings.testHooks) await settings.testHooks.afterWrite(Object.freeze({ stage })); };

  async function execute(assertion, input) {
    const command = commandSnapshot(input);
    let context; try { context = await settings.resolver.resolve(assertion); } catch (_) { throw failure('ROLE_MUTATION_UNAUTHORIZED'); }
    let timestamp; try { timestamp = settings.now(); } catch (_) { throw failure('ROLE_MUTATION_INPUT_INVALID'); }
    if (!instant(timestamp) || !allowed(context, timestamp)) throw failure('ROLE_MUTATION_UNAUTHORIZED');
    const authorityId = text(context.authorityId, 'ROLE_MUTATION_UNAUTHORIZED');
    const actorAccountId = text(context.accountId, 'ROLE_MUTATION_UNAUTHORIZED');
    const actorKey = `account:${actorAccountId}`;
    const executionContext = Object.freeze({ accountId: actorAccountId, linkId: text(context.linkId, 'ROLE_MUTATION_UNAUTHORIZED'), policyRevision: context.policyRevision });
    const selector = command.type === 'role.grant' ? { targetAccountId: command.targetAccountId, role: command.role, expectedTargetRowVersion: command.expectedTargetRowVersion } : { targetGrantId: command.targetGrantId, expectedTargetRowVersion: command.expectedTargetRowVersion };
    const requestHash = hash(stable({ type: command.type, ...selector, reasonCode: command.reasonCode }));
    const contextHash = hash(stable(executionContext));
    await catalog.assert(settings.handle);
    return withVNextPg17SyntheticQuery(settings.handle, 'fixture-provisioner', async facade => {
      try {
        await facade.query('BEGIN');
        await facade.query("SELECT pg_advisory_xact_lock(hashtextextended('vnext:role:' || $1, 0))", [authorityId]);
        const existing = await facade.query('SELECT * FROM vnext_control_plane.vnext_authorization_command_receipts WHERE authority_id=$1 AND actor_key=$2 AND idempotency_key=$3 FOR UPDATE', [authorityId, actorKey, command.idempotencyKey]);
        if (existing.rows.length === 1) {
          const receipt = existing.rows[0];
          if (receipt.canonical_request_sha256 !== requestHash) throw failure('IDEMPOTENCY_KEY_CONFLICT');
          let result; try { result = JSON.parse(receipt.canonical_result_json); } catch (_) { throw failure('IDEMPOTENCY_RECEIPT_INVALID'); }
          if (hash(receipt.canonical_result_json) !== receipt.canonical_result_sha256 || stable(result) !== receipt.canonical_result_json || receipt.actor_account_id !== actorAccountId || receipt.command_type !== command.type
            || !result.context || Object.getPrototypeOf(result.context) !== Object.prototype || Reflect.ownKeys(result.context).length !== 3
            || result.context.accountId !== actorAccountId || typeof result.context.linkId !== 'string'
            || !Number.isSafeInteger(result.context.policyRevision) || result.context.policyRevision < 1) throw failure('IDEMPOTENCY_RECEIPT_INVALID');
          const audits = await facade.query('SELECT reason_code,context_sha256 FROM vnext_control_plane.vnext_authorization_audit_events WHERE authority_id=$1 AND receipt_id=$2', [authorityId, receipt.receipt_id]);
          const outbox = await facade.query('SELECT * FROM vnext_control_plane.vnext_authorization_outbox_events WHERE authority_id=$1 AND receipt_id=$2', [authorityId, receipt.receipt_id]);
          const publicKeys = Object.keys(result).filter(key => key !== 'context').sort();
          const expectedResultKeys = result.status === 'accepted' || result.status === 'noop' ? ['code', 'grantId', 'status'] : ['code', 'status'];
          if (audits.rows.length !== 1 || audits.rows[0].reason_code !== command.reasonCode || audits.rows[0].context_sha256 !== hash(stable(result.context))
            || result.status !== receipt.outcome || result.code !== receipt.result_code || publicKeys.length !== expectedResultKeys.length || publicKeys.some((key, index) => key !== expectedResultKeys[index])) throw failure('IDEMPOTENCY_RECEIPT_INVALID');
          if (result.status === 'accepted') {
            const grants = await facade.query('SELECT g.*,a.auth_version,a.access_version,a.revocation_version FROM vnext_control_plane.vnext_role_grants g JOIN vnext_control_plane.vnext_accounts a ON a.authority_id=g.authority_id AND a.account_id=g.account_id WHERE g.authority_id=$1 AND g.grant_id=$2', [authorityId, result.grantId]);
            if (outbox.rows.length !== 1 || grants.rows.length !== 1 || receipt.target_kind !== 'role_grant' || receipt.target_id !== result.grantId || String(receipt.committed_target_row_version) === '' || !receipt.committed_auth_version || !receipt.committed_access_version) throw failure('IDEMPOTENCY_RECEIPT_INVALID');
            const grant = grants.rows[0]; const event = outbox.rows[0]; let payload;
            if (command.type === 'role.grant') {
              payload = stable({ accountId: command.targetAccountId, accessVersion: Number(receipt.committed_access_version), authVersion: Number(receipt.committed_auth_version), grantId: result.grantId, role: command.role });
              if (receipt.expected_row_version !== '0' || receipt.committed_revocation_version !== null || grant.account_id !== command.targetAccountId || grant.role !== command.role || grant.status !== 'active' || String(grant.grant_version) !== String(receipt.committed_target_row_version) || String(grant.row_version) !== String(receipt.committed_target_row_version) || Number(grant.auth_version) < Number(receipt.committed_auth_version) || Number(grant.access_version) < Number(receipt.committed_access_version) || event.event_type !== 'authorization.role_granted') throw failure('IDEMPOTENCY_RECEIPT_INVALID');
            } else {
              payload = stable({ accountId: grant.account_id, accessVersion: Number(receipt.committed_access_version), grantId: result.grantId, revocationVersion: Number(receipt.committed_revocation_version) });
              if (receipt.expected_row_version !== String(command.expectedTargetRowVersion) || !receipt.committed_revocation_version || grant.status !== 'revoked' || Number(grant.grant_version) < Number(receipt.committed_target_row_version) || Number(grant.row_version) < Number(receipt.committed_target_row_version) || Number(grant.auth_version) < Number(receipt.committed_auth_version) || Number(grant.access_version) < Number(receipt.committed_access_version) || Number(grant.revocation_version) < Number(receipt.committed_revocation_version) || event.event_type !== 'authorization.role_revoked') throw failure('IDEMPOTENCY_RECEIPT_INVALID');
            }
            if (event.aggregate_kind !== 'role_grant' || event.aggregate_id !== result.grantId || String(event.aggregate_version) !== String(receipt.committed_target_row_version) || event.canonical_payload_json !== payload || event.payload_sha256 !== hash(payload)) throw failure('IDEMPOTENCY_RECEIPT_INVALID');
          } else if (outbox.rows.length !== 0) throw failure('IDEMPOTENCY_RECEIPT_INVALID');
          await facade.query('COMMIT');
          const { context: ignored, ...output } = result;
          return Object.freeze({ ...output, replayed: true });
        }
        const authority = await facade.query("SELECT authority_id FROM vnext_control_plane.vnext_authorities WHERE authority_id=$1 AND status='active' FOR UPDATE", [authorityId]);
        const actor = await facade.query("SELECT account_id FROM vnext_control_plane.vnext_accounts WHERE authority_id=$1 AND account_id=$2 AND status='active' FOR UPDATE", [authorityId, actorAccountId]);
        if (authority.rows.length !== 1 || actor.rows.length !== 1) throw failure('ROLE_MUTATION_UNAUTHORIZED');
        const record = async ({ outcome, code, result, targetKind, targetId, versions = {}, outbox = null }) => {
          const receiptId = nextId('role-receipt'); const storedResult = { ...result, context: executionContext }; const resultJson = stable(storedResult);
          await facade.query('INSERT INTO vnext_control_plane.vnext_authorization_command_receipts(receipt_id,authority_id,actor_key,actor_account_id,idempotency_key,command_type,target_kind,target_id,canonical_request_sha256,expected_row_version,outcome,result_code,canonical_result_json,canonical_result_sha256,committed_auth_version,committed_access_version,committed_revocation_version,committed_target_row_version,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)', [receiptId, authorityId, actorKey, actorAccountId, command.idempotencyKey, command.type, targetKind, targetId, requestHash, command.expectedTargetRowVersion, outcome, code, resultJson, hash(resultJson), versions.auth || null, versions.access || null, versions.revocation || null, versions.target || null, timestamp]);
          await hook('receipt');
          await facade.query('INSERT INTO vnext_control_plane.vnext_authorization_audit_events(event_id,authority_id,receipt_id,reason_code,context_sha256,created_at) VALUES($1,$2,$3,$4,$5,$6)', [nextId('role-audit'), authorityId, receiptId, command.reasonCode, contextHash, timestamp]);
          await hook('audit');
          if (outbox) { const payload = stable(outbox.payload); await facade.query('INSERT INTO vnext_control_plane.vnext_authorization_outbox_events(event_id,authority_id,receipt_id,event_type,aggregate_kind,aggregate_id,aggregate_version,canonical_payload_json,payload_sha256,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [nextId('role-outbox'), authorityId, receiptId, outbox.type, 'role_grant', outbox.grantId, outbox.version, payload, hash(payload), timestamp]); await hook('outbox'); }
          return Object.freeze({ ...result, replayed: false });
        };
        if (command.type === 'role.grant') {
          const targetResult = await facade.query("SELECT * FROM vnext_control_plane.vnext_accounts WHERE authority_id=$1 AND account_id=$2 AND status='active' FOR UPDATE", [authorityId, command.targetAccountId]);
          if (targetResult.rows.length !== 1) { const value = await record({ outcome: 'rejected', code: 'TARGET_ACCOUNT_NOT_ACTIVE', result: { code: 'TARGET_ACCOUNT_NOT_ACTIVE', status: 'rejected' }, targetKind: 'account', targetId: command.targetAccountId }); await facade.query('COMMIT'); return value; }
          if (command.role === 'super_admin') { const value = await record({ outcome: 'rejected', code: 'FIXED_SUPER_ADMIN_REASSIGN_FORBIDDEN', result: { code: 'FIXED_SUPER_ADMIN_REASSIGN_FORBIDDEN', status: 'rejected' }, targetKind: 'account', targetId: command.targetAccountId }); await facade.query('COMMIT'); return value; }
          const active = await facade.query("SELECT grant_id FROM vnext_control_plane.vnext_role_grants WHERE authority_id=$1 AND account_id=$2 AND role=$3 AND status='active' FOR UPDATE", [authorityId, command.targetAccountId, command.role]);
          if (active.rows.length) { const value = await record({ outcome: 'rejected', code: 'ROLE_GRANT_CONFLICT', result: { code: 'ROLE_GRANT_CONFLICT', status: 'rejected' }, targetKind: 'account', targetId: command.targetAccountId }); await facade.query('COMMIT'); return value; }
          const grantId = nextId('role-grant');
          await facade.query("INSERT INTO vnext_control_plane.vnext_role_grants(grant_id,authority_id,account_id,role,status,grant_version,row_version,starts_at,ends_at,revoked_at,granted_by_account_id,created_at,updated_at) VALUES($1,$2,$3,$4,'active',1,1,$5,NULL,NULL,$6,$5,$5)", [grantId, authorityId, command.targetAccountId, command.role, timestamp, actorAccountId]);
          await hook('target');
          const changed = await facade.query('UPDATE vnext_control_plane.vnext_accounts SET auth_version=auth_version+1,access_version=access_version+1,row_version=row_version+1,updated_at=$1 WHERE authority_id=$2 AND account_id=$3 AND status=\'active\' AND row_version=$4', [timestamp, authorityId, command.targetAccountId, targetResult.rows[0].row_version]);
          if (changed.rowCount !== 1) throw failure('ROLE_MUTATION_CONFLICT');
          await hook('account');
          const account = await facade.query('SELECT auth_version,access_version FROM vnext_control_plane.vnext_accounts WHERE authority_id=$1 AND account_id=$2', [authorityId, command.targetAccountId]);
          const result = { code: 'ROLE_GRANTED', grantId, status: 'accepted' };
          const value = await record({ outcome: 'accepted', code: 'ROLE_GRANTED', result, targetKind: 'role_grant', targetId: grantId, versions: { auth: account.rows[0].auth_version, access: account.rows[0].access_version, target: 1 }, outbox: { type: 'authorization.role_granted', grantId, version: 1, payload: { accountId: command.targetAccountId, accessVersion: Number(account.rows[0].access_version), authVersion: Number(account.rows[0].auth_version), grantId, role: command.role } } });
          await facade.query('COMMIT'); return value;
        }
        const grantResult = await facade.query('SELECT g.*,a.status AS account_status,a.auth_version,a.access_version,a.revocation_version,a.row_version AS account_row_version FROM vnext_control_plane.vnext_role_grants g JOIN vnext_control_plane.vnext_accounts a ON a.authority_id=g.authority_id AND a.account_id=g.account_id WHERE g.authority_id=$1 AND g.grant_id=$2 FOR UPDATE', [authorityId, command.targetGrantId]);
        if (grantResult.rows.length !== 1 || grantResult.rows[0].account_status !== 'active') { const value = await record({ outcome: 'rejected', code: 'ROLE_GRANT_NOT_ACTIVE', result: { code: 'ROLE_GRANT_NOT_ACTIVE', status: 'rejected' }, targetKind: 'role_grant', targetId: command.targetGrantId }); await facade.query('COMMIT'); return value; }
        const grant = grantResult.rows[0];
        if (grant.status === 'revoked') { const value = await record({ outcome: 'noop', code: 'ROLE_ALREADY_REVOKED', result: { code: 'ROLE_ALREADY_REVOKED', grantId: grant.grant_id, status: 'noop' }, targetKind: 'role_grant', targetId: grant.grant_id }); await facade.query('COMMIT'); return value; }
        if (grant.status !== 'active' || String(grant.row_version) !== String(command.expectedTargetRowVersion)) { const value = await record({ outcome: 'rejected', code: 'ROLE_GRANT_VERSION_CONFLICT', result: { code: 'ROLE_GRANT_VERSION_CONFLICT', status: 'rejected' }, targetKind: 'role_grant', targetId: grant.grant_id }); await facade.query('COMMIT'); return value; }
        if (grant.role === 'super_admin') { const value = await record({ outcome: 'rejected', code: 'FIXED_SUPER_ADMIN_REVOKE_FORBIDDEN', result: { code: 'FIXED_SUPER_ADMIN_REVOKE_FORBIDDEN', status: 'rejected' }, targetKind: 'role_grant', targetId: grant.grant_id }); await facade.query('COMMIT'); return value; }
        const revoked = await facade.query("UPDATE vnext_control_plane.vnext_role_grants SET status='revoked',grant_version=grant_version+1,row_version=row_version+1,revoked_at=$1,updated_at=$1 WHERE authority_id=$2 AND grant_id=$3 AND status='active' AND grant_version=$4 AND row_version=$5", [timestamp, authorityId, grant.grant_id, grant.grant_version, grant.row_version]);
        if (revoked.rowCount !== 1) throw failure('ROLE_GRANT_VERSION_CONFLICT'); await hook('target');
        const changed = await facade.query('UPDATE vnext_control_plane.vnext_accounts SET auth_version=auth_version+1,access_version=access_version+1,revocation_version=revocation_version+1,row_version=row_version+1,updated_at=$1 WHERE authority_id=$2 AND account_id=$3 AND status=\'active\' AND auth_version=$4 AND access_version=$5 AND revocation_version=$6 AND row_version=$7', [timestamp, authorityId, grant.account_id, grant.auth_version, grant.access_version, grant.revocation_version, grant.account_row_version]);
        if (changed.rowCount !== 1) throw failure('ROLE_MUTATION_CONFLICT'); await hook('account');
        const account = await facade.query('SELECT auth_version,access_version,revocation_version FROM vnext_control_plane.vnext_accounts WHERE authority_id=$1 AND account_id=$2', [authorityId, grant.account_id]);
        const result = { code: 'ROLE_REVOKED', grantId: grant.grant_id, status: 'accepted' };
        const value = await record({ outcome: 'accepted', code: 'ROLE_REVOKED', result, targetKind: 'role_grant', targetId: grant.grant_id, versions: { auth: account.rows[0].auth_version, access: account.rows[0].access_version, revocation: account.rows[0].revocation_version, target: Number(grant.row_version) + 1 }, outbox: { type: 'authorization.role_revoked', grantId: grant.grant_id, version: Number(grant.row_version) + 1, payload: { accountId: grant.account_id, accessVersion: Number(account.rows[0].access_version), grantId: grant.grant_id, revocationVersion: Number(account.rows[0].revocation_version) } } });
        await facade.query('COMMIT'); return value;
      } catch (error) {
        try { await facade.query('ROLLBACK'); } catch (_) { /* no-op */ }
        if (error && typeof error.code === 'string' && /^(ROLE_|IDEMPOTENCY_)/.test(error.code)) throw error;
        throw failure('ROLE_MUTATION_UNAVAILABLE');
      }
    });
  }
  return Object.freeze({ execute });
}
module.exports = Object.freeze({ createVNextPg17RoleMutation });
