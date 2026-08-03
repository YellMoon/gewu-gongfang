const {
  AUTHORITY_PROJECTION_PROTOCOL,
  normalizedProjection,
} = require('../../../shared/authorityProjectionProtocol');
const { resolveActingScope } = require('./authorityAccessService');
const { projectAuthorityData } = require('./authorityProjectionService');
const { createAuthorityProjectionStoreService } = require('./authorityProjectionStoreService');

function publisherError(code) {
  return Object.assign(new Error(code), { code });
}

function createAuthorityProjectionPublisherService({
  db,
  loadSource,
  signProjection,
  prepareRemote = async () => {},
  publishRemote = async () => {},
  now = () => new Date().toISOString(),
} = {}) {
  if (!db || typeof db.prepare !== 'function'
    || typeof loadSource !== 'function'
    || typeof signProjection !== 'function'
    || typeof prepareRemote !== 'function'
    || typeof publishRemote !== 'function') {
    throw publisherError('AUTHORITY_PROJECTION_PUBLISHER_DEPENDENCY_REQUIRED');
  }
  const store = createAuthorityProjectionStoreService({ db });

  function generatedAt() {
    const timestamp = new Date(now());
    if (!Number.isFinite(timestamp.getTime())) {
      throw publisherError('AUTHORITY_PROJECTION_CLOCK_INVALID');
    }
    return timestamp.toISOString();
  }

  function scopesFor(authorityId) {
    const accounts = db.prepare(`SELECT user_id FROM authority_accounts
      WHERE authority_id=? AND status='active' ORDER BY user_id`).all(authorityId);
    const grants = db.prepare(`SELECT user_id,role,subject_id,status,grant_version
      FROM authority_role_bindings
      WHERE authority_id=? AND status='active' ORDER BY user_id,role`).all(authorityId);
    const byUser = new Map();
    for (const grant of grants) {
      const list = byUser.get(grant.user_id) || [];
      list.push({
        role: grant.role,
        bindingId: grant.subject_id,
        status: grant.status,
        authorityId,
        grantVersion: grant.grant_version,
      });
      byUser.set(grant.user_id, list);
    }
    const scopes = [];
    for (const account of accounts) {
      scopes.push(resolveActingScope({
        userId: account.user_id,
        actingRole: 'visitor',
        authorityId,
        grants: [],
      }));
      for (const grant of byUser.get(account.user_id) || []) {
        scopes.push(resolveActingScope({
          userId: account.user_id,
          actingRole: grant.role,
          authorityId,
          grants: [grant],
        }));
      }
    }
    return scopes;
  }

  function projectionTarget({ authorityId, hostEpochId } = {}) {
    const authority = String(authorityId || '').trim();
    const epoch = String(hostEpochId || '').trim();
    if (!authority || !epoch) throw publisherError('AUTHORITY_PROJECTION_TARGET_REQUIRED');
    const { createAuthorityRuntimeHostEpochService } = require('./authorityRuntimeHostEpochService');
    const activeEpoch = createAuthorityRuntimeHostEpochService({ db }).find(epoch);
    if (!activeEpoch || activeEpoch.authority_id !== authority) throw publisherError('AUTHORITY_PROJECTION_HOST_EPOCH_INACTIVE');
    return { authority, epoch };
  }

  const finalizeMaterialization = db.transaction(({ authority, epoch, writes, failures }) => {
    projectionTarget({ authorityId: authority, hostEpochId: epoch });
    for (const item of writes) {
      if (item.publish) store.publish(item.document);
    }
    const activeScopeKeys = new Set(scopesFor(authority).map(scope => `${scope.userId}\u0000${scope.kind}`));
    const failedScopeKeys = new Set(failures.map(failure => `${failure.userId}\u0000${failure.role}`));
    const storedScopes = db.prepare(`SELECT host_epoch_id,user_id,role FROM authority_scoped_projections
      WHERE authority_id=?`).all(authority);
    const remove = db.prepare(`DELETE FROM authority_scoped_projections
      WHERE authority_id=? AND user_id=? AND role=?`);
    let pruned = 0;
    for (const stored of storedScopes) {
      const scopeKey = `${stored.user_id}\u0000${stored.role}`;
      const failedCurrentEpoch = stored.host_epoch_id === epoch && failedScopeKeys.has(scopeKey);
      if (!activeScopeKeys.has(scopeKey) || failedCurrentEpoch) {
        pruned += remove.run(authority, stored.user_id, stored.role).changes;
      }
    }
    return pruned;
  });

  async function materializeAll(input = {}) {
    const { authority, epoch } = projectionTarget(input);
    let version = Number(db.prepare(`SELECT version FROM authority_projection_versions
      WHERE authority_id=? AND host_epoch_id=?`).get(authority, epoch)?.version || 0);
    const source = await loadSource({ authorityId: authority, hostEpochId: epoch });
    const scopeCandidates = scopesFor(authority).map(scope => {
      const payload = projectAuthorityData(scope, source);
      const existing = store.read({
        authorityId: authority,
        userId: scope.userId,
        role: scope.kind,
      });
      const normalized = normalizedProjection({
        protocol: AUTHORITY_PROJECTION_PROTOCOL,
        authorityId: authority,
        hostEpochId: epoch,
        userId: scope.userId,
        role: scope.kind,
        sourceVersion: version,
        generatedAt: generatedAt(),
        payload,
      });
      return { scope, payload, existing, payloadHash: normalized.payloadHash };
    });
    const policyOutputChanged = scopeCandidates.some(candidate => (
      candidate.existing
      && candidate.existing.hostEpochId === epoch
      && Number(candidate.existing.sourceVersion) === version
      && candidate.existing.payloadHash !== candidate.payloadHash
    ));
    if (policyOutputChanged) {
      const { createAuthorityProjectionVersionService } = require('./authorityProjectionVersionService');
      version = createAuthorityProjectionVersionService({ db, now }).next({
        authorityId: authority,
        hostEpochId: epoch,
      });
    }
    const documents = [];
    const writes = [];
    const failures = [];
    for (const candidate of scopeCandidates) {
      const { scope, payload, existing, payloadHash } = candidate;
      try {
        const document = existing
          && existing.hostEpochId === epoch
          && Number(existing.sourceVersion) === version
          && existing.payloadHash === payloadHash
          ? existing
          : await signProjection({
            protocol: AUTHORITY_PROJECTION_PROTOCOL,
            authorityId: authority,
            hostEpochId: epoch,
            userId: scope.userId,
            role: scope.kind,
            sourceVersion: version,
            generatedAt: generatedAt(),
            payload,
          });
        writes.push({ document, publish: document !== existing });
        documents.push(document);
      } catch (error) {
        failures.push(Object.freeze({
          userId: scope.userId,
          role: scope.kind,
          code: error?.code || error?.message || 'AUTHORITY_PROJECTION_PUBLISH_FAILED',
        }));
      }
    }
    const pruned = finalizeMaterialization({ authority, epoch, writes, failures });
    return Object.freeze({
      authorityId: authority,
      hostEpochId: epoch,
      sourceVersion: version,
      materialized: documents.length,
      pruned,
      failed: failures.length,
      failures: Object.freeze(failures),
      documents: Object.freeze(documents),
    });
  }

  async function publishAll(input = {}) {
    const local = await materializeAll(input);
    let published = 0;
    const failures = [...local.failures];
    try {
      await prepareRemote({
        authorityId: local.authorityId,
        hostEpochId: local.hostEpochId,
      });
    } catch (error) {
      for (const document of local.documents) {
        failures.push(Object.freeze({
          userId: document.userId,
          role: document.role,
          code: error?.code || error?.message || 'AUTHORITY_PROJECTION_PREPARE_REMOTE_FAILED',
        }));
      }
      return Object.freeze({
        authorityId: local.authorityId,
        hostEpochId: local.hostEpochId,
        sourceVersion: local.sourceVersion,
        published,
        failed: failures.length,
        failures: Object.freeze(failures),
      });
    }
    for (const document of local.documents) {
      try {
        await publishRemote(document);
        published += 1;
      } catch (error) {
        failures.push(Object.freeze({
          userId: document.userId,
          role: document.role,
          code: error?.code || error?.message || 'AUTHORITY_PROJECTION_PUBLISH_FAILED',
        }));
      }
    }
    return Object.freeze({
      authorityId: local.authorityId,
      hostEpochId: local.hostEpochId,
      sourceVersion: local.sourceVersion,
      published,
      failed: failures.length,
      failures: Object.freeze(failures),
    });
  }

  return Object.freeze({ materializeAll, publishAll });
}

module.exports = { createAuthorityProjectionPublisherService, publisherError };
