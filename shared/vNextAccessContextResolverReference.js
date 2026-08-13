'use strict';

const { assertVNextControlPlaneReferenceSchema } = require('./vNextControlPlaneReferenceKernel');
const policy = require('./vNextAuthorizationPolicyReference');
const { isVNextTrustedSessionVerifierBoundary } = require('./vNextTrustedSessionVerifierBoundaryReference');
const { types } = require('node:util');

const UNAVAILABLE = 'VNEXT_ACCESS_CONTEXT_UNAVAILABLE';
const error = () => Object.assign(new Error(UNAVAILABLE), { code: UNAVAILABLE });
const active = value => value === 'active';

function instant(value) {
  if (typeof value !== 'string' || !value || Number.isNaN(Date.parse(value))) throw error();
  return Date.parse(value);
}

function frozen(value) { return Object.freeze(value); }

function exactConfig(config) {
  if (!config || typeof config !== 'object' || types.isProxy(config) || Object.getPrototypeOf(config) !== Object.prototype) return null;
  const keys = Reflect.ownKeys(config);
  if (keys.some(key => typeof key !== 'string' || !['db','verifierBoundary','surface','now'].includes(key)) || !['db','verifierBoundary','surface'].every(key => keys.includes(key))) return null;
  const values = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(config, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
    values[key] = descriptor.value;
  }
  return values;
}

function createVNextAccessContextResolverReference(config) {
  const values = exactConfig(config);
  const { db, verifierBoundary, surface, now = () => new Date().toISOString() } = values || {};
  if (!db || ['prepare','transaction','pragma','exec'].some(method => typeof db[method] !== 'function') || !isVNextTrustedSessionVerifierBoundary(verifierBoundary) || !['desktop', 'miniapp'].includes(surface) || typeof now !== 'function') throw error();

  let resolveSnapshot;
  try { resolveSnapshot = db.transaction((sessionId, at) => {
      assertVNextControlPlaneReferenceSchema(db);
      const atMillis = instant(at);
      const session = db.prepare(`SELECT s.*, a.status AS authority_status, ac.auth_version AS account_auth_current, ac.access_version AS account_access_current, ac.revocation_version AS account_revocation_current, ac.status AS account_status, d.status AS device_status, d.credential_version AS device_credential_current, d.risk_version AS device_risk_current, i.status AS installation_status, i.credential_version AS installation_credential_current, l.status AS link_status, l.auth_version AS link_auth_current, l.access_version AS link_access_current, l.row_version AS link_row_current
        FROM vNext_sessions s
        JOIN vNext_authorities a ON a.authority_id=s.authority_id
        JOIN vNext_accounts ac ON ac.authority_id=s.authority_id AND ac.account_id=s.account_id
        JOIN vNext_trusted_devices d ON d.authority_id=s.authority_id AND d.device_id=s.device_id
        JOIN vNext_device_installations i ON i.authority_id=s.authority_id AND i.device_id=s.device_id AND i.installation_id=s.installation_id
        JOIN vNext_account_device_links l ON l.authority_id=s.authority_id AND l.account_id=s.account_id AND l.device_id=s.device_id AND l.installation_id=s.installation_id AND l.link_id=s.link_id
        WHERE s.session_id=?`).get(sessionId);
      if (!session || session.session_kind !== 'online' || !active(session.status) || !active(session.authority_status) || !active(session.account_status) || !active(session.device_status) || !active(session.installation_status) || !active(session.link_status)) throw error();
      if (instant(session.issued_at) > atMillis || instant(session.expires_at) <= atMillis) throw error();
      const vectors = [
        ['account_auth_version', 'account_auth_current'], ['account_access_version', 'account_access_current'], ['account_revocation_version', 'account_revocation_current'],
        ['device_credential_version', 'device_credential_current'], ['device_risk_version', 'device_risk_current'], ['installation_credential_version', 'installation_credential_current'],
        ['link_auth_version', 'link_auth_current'], ['link_access_version', 'link_access_current'], ['link_row_version', 'link_row_current'],
      ];
      if (vectors.some(([captured, current]) => session[captured] !== session[current])) throw error();

      const publication = db.prepare(`SELECT * FROM vNext_authorization_policy_publications WHERE authority_id=? ORDER BY policy_revision DESC LIMIT 1`).get(session.authority_id);
      if (!publication || publication.policy_contract_version !== 1) throw error();
      const manifest = JSON.parse(publication.canonical_manifest_json);
      const canonical = policy.canonicalizePolicyManifest(manifest);
      if (canonical !== publication.canonical_manifest_json || policy.policyManifestSha256(manifest) !== publication.policy_manifest_sha256) throw error();

      const roleRows = db.prepare('SELECT role,status,starts_at,ends_at FROM vNext_role_grants WHERE authority_id=? AND account_id=?').all(session.authority_id, session.account_id);
      const roles = roleRows.filter(row => row.status === 'active' && instant(row.starts_at) <= atMillis && (row.ends_at === null || instant(row.ends_at) > atMillis)).map(row => row.role).sort();
      const effectiveRoles = roles.length ? [...new Set(roles)] : ['visitor'];
      const overrides = db.prepare('SELECT capability_id,effect,status,starts_at,ends_at FROM vNext_capability_overrides WHERE authority_id=? AND account_id=?').all(session.authority_id, session.account_id)
        .map(row => ({ capabilityId: row.capability_id, effect: row.effect, status: row.status, startsAt: row.starts_at, ...(row.ends_at === null ? {} : { endsAt: row.ends_at }) }));
      const scopeRows = db.prepare('SELECT scope_type,scope_value_hash,effect,status,starts_at,ends_at FROM vNext_data_scope_grants WHERE authority_id=? AND account_id=?').all(session.authority_id, session.account_id);
      const scopesInput = scopeRows.map(row => ({ scopeType: row.scope_type, scopeValueHash: row.scope_value_hash, effect: row.effect, status: row.status, startsAt: row.starts_at, ...(row.ends_at === null ? {} : { endsAt: row.ends_at }) }));
      const capabilities = policy.resolveEffectiveCapabilityIds({ manifest, roles: effectiveRoles, overrides, surface, at });
      const scopes = policy.canonicalizeEffectiveScopes(scopesInput, at);

      const reauth = db.prepare(`SELECT expires_at FROM vNext_recent_reauthentication_events WHERE authority_id=? AND session_id=? AND julianday(verified_at)<=julianday(?) AND julianday(expires_at)>julianday(?) AND account_auth_version=? AND account_access_version=? AND account_revocation_version=? AND device_credential_version=? AND device_risk_version=? AND installation_credential_version=? AND link_auth_version=? AND link_access_version=? AND link_row_version=? ORDER BY julianday(expires_at) DESC LIMIT 1`)
        .get(session.authority_id, session.session_id, at, at, session.account_auth_version, session.account_access_version, session.account_revocation_version, session.device_credential_version, session.device_risk_version, session.installation_credential_version, session.link_auth_version, session.link_access_version, session.link_row_version);
      return frozen({
        authorityId: session.authority_id, accountId: session.account_id, deviceId: session.device_id, installationId: session.installation_id, linkId: session.link_id, sessionId: session.session_id,
        surface, policyRevision: publication.policy_revision, policyManifestSha256: publication.policy_manifest_sha256,
        roles: frozen(effectiveRoles), capabilityIds: capabilities.capabilityIds, capabilitySha256: capabilities.capabilitySha256,
        scopes, scopeSha256: policy.scopeSha256(scopesInput, at), reauthenticatedUntil: reauth ? reauth.expires_at : null,
      });
  }); } catch { throw error(); }

  function resolve(assertion) {
    try {
      const trustedSession = verifierBoundary.unwrap(assertion);
      if (!trustedSession || typeof trustedSession.sessionId !== 'string') throw error();
      const at = now();
      if (typeof at !== 'string') throw error();
      return resolveSnapshot(trustedSession.sessionId, at);
    } catch {
      throw error();
    }
  }

  return frozen({ resolve });
}

module.exports = frozen({ createVNextAccessContextResolverReference });
