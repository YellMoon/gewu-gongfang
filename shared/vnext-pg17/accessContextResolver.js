'use strict';

const { types } = require('node:util');
const { isVNextPg17DisposableHandleForRuntime, withVNextPg17SyntheticQuery } = require('./disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('./catalogAssertion');
const { isVNextPg17TrustedSessionVerifierBoundaryForHandle } = require('./trustedSessionVerifierBoundary');
const policy = require('../vNextAuthorizationPolicyReference');

const resolvers = new WeakSet();
const bindings = new WeakMap();
const CONFIG_KEYS = ['runtime', 'handle', 'verifierBoundary', 'surface', 'now'];

function failure() { return Object.assign(new Error('VNEXT_PG17_ACCESS_CONTEXT_UNAVAILABLE'), { code: 'VNEXT_PG17_ACCESS_CONTEXT_UNAVAILABLE' }); }
function exactConfig(value) {
  if (!value || typeof value !== 'object' || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => typeof key !== 'string' || !CONFIG_KEYS.includes(key)) || !['runtime', 'handle', 'verifierBoundary', 'surface'].every(key => keys.includes(key))) return null;
  const copy = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
    copy[key] = descriptor.value;
  }
  return copy;
}
function iso(value) {
  const output = value instanceof Date ? value.toISOString() : value;
  if (typeof output !== 'string' || new Date(output).toISOString() !== output) throw failure();
  return output;
}
function atMillis(value) { return Date.parse(iso(value)); }
function freeze(value) {
  if (Array.isArray(value)) { for (const item of value) freeze(item); }
  else if (value && typeof value === 'object') { for (const item of Object.values(value)) freeze(item); }
  return Object.freeze(value);
}

function createVNextPg17AccessContextResolver(config) {
  const settings = exactConfig(config);
  if (!settings || !isVNextPg17DisposableHandleForRuntime(settings.runtime, settings.handle)
    || !isVNextPg17TrustedSessionVerifierBoundaryForHandle(settings.verifierBoundary, settings.handle)
    || !['desktop', 'miniapp'].includes(settings.surface) || (settings.now !== undefined && (typeof settings.now !== 'function' || types.isProxy(settings.now)))) throw failure();
  const now = settings.now || (() => new Date().toISOString());
  const catalog = createVNextPg17CatalogBoundary(settings.runtime);

  async function resolve(assertion) {
    let session;
    let at;
    try {
      session = settings.verifierBoundary.unwrap(assertion);
      at = iso(now());
      if (!session || typeof session.sessionId !== 'string') throw failure();
      await catalog.assert(settings.handle);
    } catch (_) { throw failure(); }
    return withVNextPg17SyntheticQuery(settings.handle, 'verifier', async facade => {
      try {
        await facade.query('BEGIN READ ONLY');
        const current = await facade.query(`SELECT s.*, au.status AS authority_status, ac.status AS account_status, ac.auth_version AS account_auth_current, ac.access_version AS account_access_current, ac.revocation_version AS account_revocation_current, d.status AS device_status, d.credential_version AS device_credential_current, d.risk_version AS device_risk_current, i.status AS installation_status, i.credential_version AS installation_credential_current, l.status AS link_status, l.auth_version AS link_auth_current, l.access_version AS link_access_current, l.row_version AS link_row_current FROM vnext_control_plane.vnext_sessions s JOIN vnext_control_plane.vnext_authorities au ON au.authority_id=s.authority_id JOIN vnext_control_plane.vnext_accounts ac ON ac.authority_id=s.authority_id AND ac.account_id=s.account_id JOIN vnext_control_plane.vnext_trusted_devices d ON d.authority_id=s.authority_id AND d.device_id=s.device_id JOIN vnext_control_plane.vnext_device_installations i ON i.authority_id=s.authority_id AND i.device_id=s.device_id AND i.installation_id=s.installation_id JOIN vnext_control_plane.vnext_account_device_links l ON l.authority_id=s.authority_id AND l.account_id=s.account_id AND l.device_id=s.device_id AND l.installation_id=s.installation_id AND l.link_id=s.link_id WHERE s.session_id=$1`, [session.sessionId]);
        if (current.rows.length !== 1) throw failure();
        const row = current.rows[0];
        if (row.session_kind !== 'online' || [row.status, row.authority_status, row.account_status, row.device_status, row.installation_status, row.link_status].some(value => value !== 'active')) throw failure();
        const atValue = atMillis(at);
        if (atMillis(row.issued_at) > atValue || atMillis(row.expires_at) <= atValue) throw failure();
        const vectors = [['account_auth_version', 'account_auth_current'], ['account_access_version', 'account_access_current'], ['account_revocation_version', 'account_revocation_current'], ['device_credential_version', 'device_credential_current'], ['device_risk_version', 'device_risk_current'], ['installation_credential_version', 'installation_credential_current'], ['link_auth_version', 'link_auth_current'], ['link_access_version', 'link_access_current'], ['link_row_version', 'link_row_current']];
        if (vectors.some(([captured, actual]) => String(row[captured]) !== String(row[actual]))) throw failure();
        const publicationResult = await facade.query('SELECT * FROM vnext_control_plane.vnext_authorization_policy_publications WHERE authority_id=$1 ORDER BY policy_revision DESC LIMIT 1', [row.authority_id]);
        if (publicationResult.rows.length !== 1 || String(publicationResult.rows[0].policy_contract_version) !== '1') throw failure();
        const publication = publicationResult.rows[0];
        const manifest = JSON.parse(publication.canonical_manifest_json);
        const canonical = policy.canonicalizePolicyManifest(manifest);
        if (canonical !== publication.canonical_manifest_json || policy.policyManifestSha256(manifest) !== publication.policy_manifest_sha256) throw failure();
        const roleRows = await facade.query('SELECT role,status,starts_at,ends_at FROM vnext_control_plane.vnext_role_grants WHERE authority_id=$1 AND account_id=$2', [row.authority_id, row.account_id]);
        const roles = [...new Set(roleRows.rows.filter(item => item.status === 'active' && atMillis(item.starts_at) <= atValue && (item.ends_at === null || atMillis(item.ends_at) > atValue)).map(item => item.role))].sort();
        const effectiveRoles = roles.length ? roles : ['visitor'];
        const overrideRows = await facade.query('SELECT capability_id,effect,status,starts_at,ends_at FROM vnext_control_plane.vnext_capability_overrides WHERE authority_id=$1 AND account_id=$2', [row.authority_id, row.account_id]);
        const overrides = overrideRows.rows.map(item => ({ capabilityId: item.capability_id, effect: item.effect, status: item.status, startsAt: iso(item.starts_at), ...(item.ends_at === null ? {} : { endsAt: iso(item.ends_at) }) }));
        const scopeRows = await facade.query('SELECT scope_type,scope_value_hash,effect,status,starts_at,ends_at FROM vnext_control_plane.vnext_data_scope_grants WHERE authority_id=$1 AND account_id=$2', [row.authority_id, row.account_id]);
        const scopesInput = scopeRows.rows.map(item => ({ scopeType: item.scope_type, scopeValueHash: item.scope_value_hash, effect: item.effect, status: item.status, startsAt: iso(item.starts_at), ...(item.ends_at === null ? {} : { endsAt: iso(item.ends_at) }) }));
        const capabilities = policy.resolveEffectiveCapabilityIds({ manifest, roles: effectiveRoles, overrides, surface: settings.surface, at });
        const scopes = policy.canonicalizeEffectiveScopes(scopesInput, at);
        const reauthResult = await facade.query('SELECT expires_at FROM vnext_control_plane.vnext_recent_reauthentication_events WHERE authority_id=$1 AND session_id=$2 AND verified_at <= $3 AND expires_at > $3 AND account_auth_version=$4 AND account_access_version=$5 AND account_revocation_version=$6 AND device_credential_version=$7 AND device_risk_version=$8 AND installation_credential_version=$9 AND link_auth_version=$10 AND link_access_version=$11 AND link_row_version=$12 ORDER BY expires_at DESC LIMIT 1', [row.authority_id, row.session_id, at, row.account_auth_version, row.account_access_version, row.account_revocation_version, row.device_credential_version, row.device_risk_version, row.installation_credential_version, row.link_auth_version, row.link_access_version, row.link_row_version]);
        await facade.query('COMMIT');
        return freeze({ authorityId: row.authority_id, accountId: row.account_id, deviceId: row.device_id, installationId: row.installation_id, linkId: row.link_id, sessionId: row.session_id, surface: settings.surface, policyRevision: Number(publication.policy_revision), policyManifestSha256: publication.policy_manifest_sha256, roles: effectiveRoles, capabilityIds: capabilities.capabilityIds, capabilitySha256: capabilities.capabilitySha256, scopes, scopeSha256: policy.scopeSha256(scopesInput, at), reauthenticatedUntil: reauthResult.rows.length ? iso(reauthResult.rows[0].expires_at) : null });
      } catch (_) {
        try { await facade.query('ROLLBACK'); } catch (_) { /* no-op */ }
        throw failure();
      }
    });
  }
  const resolver = freeze({ resolve });
  resolvers.add(resolver);
  bindings.set(resolver, settings.handle);
  return resolver;
}

function isVNextPg17AccessContextResolverForHandle(value, handle) {
  return !!value && typeof value === 'object' && resolvers.has(value) && bindings.has(value) && bindings.get(value) === handle;
}

module.exports = Object.freeze({ createVNextPg17AccessContextResolver, isVNextPg17AccessContextResolverForHandle });
