'use strict';

const crypto = require('node:crypto');
const { types } = require('node:util');
const {
  isVNextPg17DisposableHandleForRuntime,
  withVNextPg17SyntheticQuery,
} = require('./disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('./catalogAssertion');
const {
  isVNextPg17AccessContextResolverForHandle,
} = require('./accessContextResolver');

const CONFIG_KEYS = Object.freeze(['runtime', 'handle', 'resolver', 'now']);
const COMMAND_KEYS = Object.freeze(['type', 'targetLinkId', 'expectedTargetRowVersion', 'idempotencyKey', 'reasonCode']);

function failure(code) { return Object.assign(new Error(code), { code }); }
function unavailable() { return failure('VNEXT_PG17_LINK_REVOCATION_PARITY_UNAVAILABLE'); }
function hash(value) { return crypto.createHash('sha256').update(value, 'utf8').digest('hex'); }
function stable(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) throw unavailable();
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}
function canonicalInstant(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;
}
function ownData(value, allowed, required = allowed) {
  if (!value || typeof value !== 'object' || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => typeof key !== 'string' || !allowed.includes(key)) || required.some(key => !keys.includes(key))) return null;
  const copy = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
    copy[key] = descriptor.value;
  }
  return copy;
}
function text(value) {
  if (typeof value !== 'string' || value.trim() === '') throw unavailable();
  return value.trim();
}
function commandSnapshot(value) {
  const copy = ownData(value, COMMAND_KEYS);
  if (!copy || Reflect.ownKeys(copy).length !== COMMAND_KEYS.length || copy.type !== 'account_device_link.revoke'
    || !Number.isSafeInteger(copy.expectedTargetRowVersion) || copy.expectedTargetRowVersion < 1) throw failure('VNEXT_PG17_LINK_REVOCATION_PARITY_INVALID');
  for (const key of ['targetLinkId', 'idempotencyKey', 'reasonCode']) {
    if (typeof copy[key] !== 'string' || copy[key].trim() === '') throw failure('VNEXT_PG17_LINK_REVOCATION_PARITY_INVALID');
    copy[key] = copy[key].trim();
  }
  return Object.freeze(copy);
}
function configSnapshot(value) {
  const copy = ownData(value, CONFIG_KEYS);
  if (!copy || typeof copy.now !== 'function' || types.isProxy(copy.now)) return null;
  return copy;
}
function allowed(context, timestamp) {
  return !!context && context.surface === 'desktop'
    && typeof context.authorityId === 'string' && context.authorityId.trim() !== ''
    && typeof context.accountId === 'string' && context.accountId.trim() !== ''
    && typeof context.linkId === 'string' && context.linkId.trim() !== ''
    && Array.isArray(context.roles) && context.roles.includes('super_admin')
    && Array.isArray(context.capabilityIds) && context.capabilityIds.includes('device.revoke')
    && canonicalInstant(context.reauthenticatedUntil)
    && Date.parse(context.reauthenticatedUntil) > Date.parse(timestamp)
    && Number.isSafeInteger(context.policyRevision) && context.policyRevision >= 1;
}
function exactKeys(value, expected) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const actual = Object.keys(value).sort();
  const keys = [...expected].sort();
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}
function validStoredContext(value, actorAccountId) {
  return exactKeys(value, ['accountId', 'linkId', 'policyRevision'])
    && value.accountId === actorAccountId
    && typeof value.linkId === 'string' && value.linkId.trim() !== ''
    && Number.isSafeInteger(value.policyRevision) && value.policyRevision >= 1;
}

function createVNextPg17AccountDeviceLinkRevocationCanonicalParity(config) {
  const settings = configSnapshot(config);
  if (!settings || !isVNextPg17DisposableHandleForRuntime(settings.runtime, settings.handle)
    || !isVNextPg17AccessContextResolverForHandle(settings.resolver, settings.handle)) {
    throw failure('VNEXT_PG17_LINK_REVOCATION_PARITY_INVALID');
  }
  const catalog = createVNextPg17CatalogBoundary(settings.runtime);

  async function inspect(assertion, input) {
    const command = commandSnapshot(input);
    let context;
    let timestamp;
    try {
      context = await settings.resolver.resolve(assertion);
      timestamp = settings.now();
      if (!canonicalInstant(timestamp) || !allowed(context, timestamp)) throw unavailable();
    } catch (_) {
      throw unavailable();
    }
    const authorityId = text(context.authorityId);
    const actorAccountId = text(context.accountId);
    const executionContext = Object.freeze({
      accountId: actorAccountId,
      linkId: text(context.linkId),
      policyRevision: context.policyRevision,
    });
    const request = stable({
      type: command.type,
      targetLinkId: command.targetLinkId,
      expectedTargetRowVersion: command.expectedTargetRowVersion,
      reasonCode: command.reasonCode,
    });
    return withVNextPg17SyntheticQuery(settings.handle, 'verifier', async facade => {
      let began = false;
      try {
        await facade.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        began = true;
        const catalogFacade = catalog.createVerifierQueryFacade((query, values) => facade.query(query, values));
        await catalog.assertQueryFacade(catalogFacade);
        const authority = await facade.query(
          `SELECT authority_id FROM vnext_control_plane.vnext_authorities
           WHERE authority_id=$1 AND status='active'`,
          [authorityId],
        );
        const actor = await facade.query(
          `SELECT account_id FROM vnext_control_plane.vnext_accounts
           WHERE authority_id=$1 AND account_id=$2 AND status='active'`,
          [authorityId, actorAccountId],
        );
        if (authority.rows.length !== 1 || actor.rows.length !== 1) throw unavailable();
        const existing = await facade.query(
          `SELECT *
           FROM vnext_control_plane.vnext_authorization_command_receipts
           WHERE authority_id=$1 AND actor_key=$2 AND idempotency_key=$3`,
          [authorityId, `account:${actorAccountId}`, command.idempotencyKey],
        );
        if (existing.rows.length > 1) throw failure('VNEXT_PG17_LINK_REVOCATION_PARITY_RECEIPT_INVALID');
        if (existing.rows.length === 1) {
          const receipt = existing.rows[0];
          if (receipt.canonical_request_sha256 !== hash(request)) throw failure('VNEXT_PG17_LINK_REVOCATION_PARITY_IDEMPOTENCY_CONFLICT');
          let result;
          try { result = JSON.parse(receipt.canonical_result_json); } catch (_) { throw failure('VNEXT_PG17_LINK_REVOCATION_PARITY_RECEIPT_INVALID'); }
          const common = receipt.authority_id === authorityId
            && receipt.actor_key === `account:${actorAccountId}`
            && receipt.actor_account_id === actorAccountId
            && receipt.command_type === command.type
            && receipt.target_kind === 'account_device_link'
            && receipt.target_id === command.targetLinkId
            && String(receipt.expected_row_version) === String(command.expectedTargetRowVersion)
            && receipt.result_code === result.code
            && stable(result) === receipt.canonical_result_json
            && hash(receipt.canonical_result_json) === receipt.canonical_result_sha256
            && validStoredContext(result.context, actorAccountId);
          if (!common) throw failure('VNEXT_PG17_LINK_REVOCATION_PARITY_RECEIPT_INVALID');
          const audit = await facade.query(
            `SELECT reason_code,context_sha256
             FROM vnext_control_plane.vnext_authorization_audit_events
             WHERE authority_id=$1 AND receipt_id=$2`,
            [authorityId, receipt.receipt_id],
          );
          if (audit.rows.length !== 1 || audit.rows[0].reason_code !== command.reasonCode
            || audit.rows[0].context_sha256 !== hash(stable(result.context))) {
            throw failure('VNEXT_PG17_LINK_REVOCATION_PARITY_RECEIPT_INVALID');
          }
          const outbox = await facade.query(
            `SELECT *
             FROM vnext_control_plane.vnext_authorization_outbox_events
             WHERE authority_id=$1 AND receipt_id=$2`,
            [authorityId, receipt.receipt_id],
          );
          const vector = {
            outcome: receipt.outcome,
            resultCode: receipt.result_code,
            requestSha256: receipt.canonical_request_sha256,
            resultJson: receipt.canonical_result_json,
            resultSha256: receipt.canonical_result_sha256,
            auditContextSha256: audit.rows[0].context_sha256,
          };
          if (result.status === 'accepted') {
            if (!exactKeys(result, ['code', 'context', 'linkId', 'status'])
              || result.code !== 'ACCOUNT_DEVICE_LINK_REVOKED' || result.linkId !== command.targetLinkId
              || receipt.outcome !== 'accepted' || receipt.committed_revocation_version !== null
              || ['committed_auth_version', 'committed_access_version', 'committed_target_row_version'].some(key => !Number.isSafeInteger(Number(receipt[key])) || Number(receipt[key]) < 1)
              || outbox.rows.length !== 1) {
              throw failure('VNEXT_PG17_LINK_REVOCATION_PARITY_RECEIPT_INVALID');
            }
            const links = await facade.query(
              `SELECT status,auth_version,access_version,row_version
               FROM vnext_control_plane.vnext_account_device_links
               WHERE authority_id=$1 AND link_id=$2`,
              [authorityId, result.linkId],
            );
            if (links.rows.length !== 1 || links.rows[0].status !== 'revoked'
              || String(links.rows[0].auth_version) !== String(receipt.committed_auth_version)
              || String(links.rows[0].access_version) !== String(receipt.committed_access_version)
              || String(links.rows[0].row_version) !== String(receipt.committed_target_row_version)) {
              throw failure('VNEXT_PG17_LINK_REVOCATION_PARITY_RECEIPT_INVALID');
            }
            const payload = stable({
              authorityId,
              linkAuthVersion: Number(receipt.committed_auth_version),
              linkId: result.linkId,
              linkAccessVersion: Number(receipt.committed_access_version),
              linkRowVersion: Number(receipt.committed_target_row_version),
            });
            const event = outbox.rows[0];
            if (event.event_type !== 'authorization.account_device_link_revoked'
              || event.aggregate_kind !== 'account_device_link'
              || event.aggregate_id !== result.linkId
              || String(event.aggregate_version) !== String(receipt.committed_target_row_version)
              || event.canonical_payload_json !== payload
              || event.payload_sha256 !== hash(payload)) {
              throw failure('VNEXT_PG17_LINK_REVOCATION_PARITY_RECEIPT_INVALID');
            }
            vector.outboxPayloadJson = event.canonical_payload_json;
            vector.outboxPayloadSha256 = event.payload_sha256;
          } else if (result.status === 'noop') {
            if (!exactKeys(result, ['code', 'context', 'linkId', 'status'])
              || result.code !== 'LINK_ALREADY_REVOKED' || result.linkId !== command.targetLinkId
              || receipt.outcome !== 'noop'
              || ['committed_auth_version', 'committed_access_version', 'committed_revocation_version', 'committed_target_row_version'].some(key => receipt[key] !== null)
              || outbox.rows.length !== 0) {
              throw failure('VNEXT_PG17_LINK_REVOCATION_PARITY_RECEIPT_INVALID');
            }
          } else if (result.status === 'rejected') {
            if (!exactKeys(result, ['code', 'context', 'status'])
              || !['SELF_LINK_REVOKE_FORBIDDEN', 'TARGET_LINK_NOT_ACTIVE', 'LINK_VERSION_CONFLICT'].includes(result.code)
              || receipt.outcome !== 'rejected'
              || ['committed_auth_version', 'committed_access_version', 'committed_revocation_version', 'committed_target_row_version'].some(key => receipt[key] !== null)
              || outbox.rows.length !== 0) {
              throw failure('VNEXT_PG17_LINK_REVOCATION_PARITY_RECEIPT_INVALID');
            }
          } else {
            throw failure('VNEXT_PG17_LINK_REVOCATION_PARITY_RECEIPT_INVALID');
          }
          await facade.query('COMMIT');
          began = false;
          return Object.freeze(vector);
        }
        const target = await facade.query(
          `SELECT link_id,status,auth_version,access_version,row_version
           FROM vnext_control_plane.vnext_account_device_links
           WHERE authority_id=$1 AND link_id=$2`,
          [authorityId, command.targetLinkId],
        );
        let outcome;
        let resultCode;
        let result;
        let payload = null;
        if (command.targetLinkId === executionContext.linkId) {
          outcome = 'rejected';
          resultCode = 'SELF_LINK_REVOKE_FORBIDDEN';
          result = { code: resultCode, context: executionContext, status: 'rejected' };
        } else if (target.rows.length !== 1) {
          outcome = 'rejected';
          resultCode = 'TARGET_LINK_NOT_ACTIVE';
          result = { code: resultCode, context: executionContext, status: 'rejected' };
        } else {
          const targetRow = target.rows[0];
          if (targetRow.status === 'revoked') {
            outcome = 'noop';
            resultCode = 'LINK_ALREADY_REVOKED';
            result = { code: resultCode, context: executionContext, linkId: targetRow.link_id, status: 'noop' };
          } else if (targetRow.status !== 'active' || String(targetRow.row_version) !== String(command.expectedTargetRowVersion)) {
            outcome = 'rejected';
            resultCode = 'LINK_VERSION_CONFLICT';
            result = { code: resultCode, context: executionContext, status: 'rejected' };
          } else {
            outcome = 'accepted';
            resultCode = 'ACCOUNT_DEVICE_LINK_REVOKED';
            result = { code: resultCode, context: executionContext, linkId: targetRow.link_id, status: 'accepted' };
            payload = {
              authorityId,
              linkAuthVersion: Number(targetRow.auth_version) + 1,
              linkId: targetRow.link_id,
              linkAccessVersion: Number(targetRow.access_version) + 1,
              linkRowVersion: Number(targetRow.row_version) + 1,
            };
          }
        }
        const resultJson = stable(result);
        const payloadJson = payload === null ? null : stable(payload);
        await facade.query('COMMIT');
        began = false;
        return Object.freeze({
          outcome,
          resultCode,
          requestSha256: hash(request),
          resultJson,
          resultSha256: hash(resultJson),
          auditContextSha256: hash(stable(executionContext)),
          ...(payloadJson === null ? {} : {
            outboxPayloadJson: payloadJson,
            outboxPayloadSha256: hash(payloadJson),
          }),
        });
      } catch (error) {
        if (began) {
          try { await facade.query('ROLLBACK'); } catch (_) { /* read-only facade failure is intentionally opaque */ }
        }
        if (error && ['VNEXT_PG17_LINK_REVOCATION_PARITY_IDEMPOTENCY_CONFLICT', 'VNEXT_PG17_LINK_REVOCATION_PARITY_RECEIPT_INVALID'].includes(error.code)) throw error;
        throw unavailable();
      }
    });
  }

  return Object.freeze({ inspect });
}

module.exports = Object.freeze({ createVNextPg17AccountDeviceLinkRevocationCanonicalParity });
