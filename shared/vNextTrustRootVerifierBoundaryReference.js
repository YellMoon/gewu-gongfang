'use strict';

const { types } = require('node:util');

const HASH = /^[0-9a-f]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const MAX_TTL_MS = 5 * 60 * 1000;
const boundaryBindings = new WeakMap();

const BOOTSTRAP_KEYS = Object.freeze(['kind', 'bootstrapIntentId', 'authorityId', 'accountId', 'deviceId', 'installationId', 'installationPublicKey', 'installationKeyFingerprint', 'policyManifestSha256', 'expiresAt', 'approvalVersion', 'assertionEvidenceSha256']);
const RECOVERY_KEYS = Object.freeze(['kind', 'recoveryEventId', 'authorityId', 'replacementAccountId', 'replacementDeviceId', 'replacementInstallationId', 'replacementInstallationPublicKey', 'replacementInstallationKeyFingerprint', 'backupId', 'backupManifestSha256', 'reasonCode', 'expiresAt', 'approvalVersion', 'assertionEvidenceSha256']);

function error(code) { return Object.assign(new Error(code), { code }); }
function isCanonicalInstant(value) {
  if (typeof value !== 'string') return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}
function exactOwnData(value, keys) {
  if (!value || typeof value !== 'object' || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some(key => typeof key !== 'string' || !keys.includes(key))) return null;
  const copy = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
    copy[key] = descriptor.value;
  }
  return copy;
}
function snapshotResult(value, expectedKind, now) {
  const keys = expectedKind === 'deployment_bootstrap' ? BOOTSTRAP_KEYS : RECOVERY_KEYS;
  const copy = exactOwnData(value, keys);
  if (!copy || copy.kind !== expectedKind || copy.approvalVersion !== 1 || !isCanonicalInstant(copy.expiresAt) || !isCanonicalInstant(now)) return null;
  const stringFields = keys.filter(key => !['approvalVersion'].includes(key));
  if (stringFields.some(key => typeof copy[key] !== 'string' || copy[key].length === 0)) return null;
  const hashFields = expectedKind === 'deployment_bootstrap'
    ? ['installationKeyFingerprint', 'policyManifestSha256', 'assertionEvidenceSha256']
    : ['replacementInstallationKeyFingerprint', 'backupManifestSha256', 'assertionEvidenceSha256'];
  if (hashFields.some(key => !HASH.test(copy[key]))) return null;
  const idFields = expectedKind === 'deployment_bootstrap'
    ? ['bootstrapIntentId', 'authorityId', 'accountId', 'deviceId', 'installationId']
    : ['recoveryEventId', 'authorityId', 'replacementAccountId', 'replacementDeviceId', 'replacementInstallationId', 'backupId', 'reasonCode'];
  if (idFields.some(key => !ID.test(copy[key]))) return null;
  const publicKey = expectedKind === 'deployment_bootstrap' ? copy.installationPublicKey : copy.replacementInstallationPublicKey;
  if (publicKey.trim().length === 0 || publicKey.length > 16 * 1024) return null;
  const ttl = Date.parse(copy.expiresAt) - Date.parse(now);
  if (ttl <= 0 || ttl > MAX_TTL_MS) return null;
  return Object.freeze(copy);
}
function exactConfig(config) {
  const keys = ['databaseBinding', 'verifyBootstrapPresentation', 'verifyRecoveryPresentation', 'now'];
  const copy = exactOwnData(config, keys);
  if (!copy || types.isProxy(copy.databaseBinding) || types.isProxy(copy.verifyBootstrapPresentation) || types.isProxy(copy.verifyRecoveryPresentation) || types.isProxy(copy.now) || !copy.databaseBinding || (typeof copy.databaseBinding !== 'object' && typeof copy.databaseBinding !== 'function') || typeof copy.verifyBootstrapPresentation !== 'function' || typeof copy.verifyRecoveryPresentation !== 'function' || typeof copy.now !== 'function') return null;
  return copy;
}

function createVNextTrustRootVerifierBoundaryReference(config) {
  const settings = exactConfig(config);
  if (!settings) throw error('VNEXT_TRUST_ROOT_VERIFIER_INVALID');
  const assertions = new WeakMap();
  async function issue(expectedKind, presentation) {
    try {
      let result = expectedKind === 'deployment_bootstrap'
        ? settings.verifyBootstrapPresentation(presentation)
        : settings.verifyRecoveryPresentation(presentation);
      if (types.isPromise(result)) result = await result;
      const keys = expectedKind === 'deployment_bootstrap' ? BOOTSTRAP_KEYS : RECOVERY_KEYS;
      const returnedSnapshot = exactOwnData(result, keys);
      const now = settings.now();
      const snapshot = returnedSnapshot && snapshotResult(returnedSnapshot, expectedKind, now);
      if (!snapshot) throw error('VNEXT_TRUST_ROOT_PRESENTATION_REJECTED');
      const assertion = Object.freeze({});
      assertions.set(assertion, snapshot);
      return assertion;
    } catch {
      throw error('VNEXT_TRUST_ROOT_PRESENTATION_REJECTED');
    }
  }
  const boundary = Object.freeze({
    verifyBootstrap(presentation) { return issue('deployment_bootstrap', presentation); },
    verifyRecovery(presentation) { return issue('owner_recovery_event', presentation); },
    unwrap(assertion, expectedKind) {
      const snapshot = assertions.get(assertion);
      if (!snapshot || snapshot.kind !== expectedKind) throw error('VNEXT_TRUST_ROOT_ASSERTION_INVALID');
      return snapshot;
    },
  });
  boundaryBindings.set(boundary, settings.databaseBinding);
  return boundary;
}
function isVNextTrustRootVerifierBoundaryReferenceForDatabase(boundary, databaseBinding) {
  return boundaryBindings.has(boundary) && boundaryBindings.get(boundary) === databaseBinding;
}

module.exports = Object.freeze({ createVNextTrustRootVerifierBoundaryReference, isVNextTrustRootVerifierBoundaryReferenceForDatabase });
