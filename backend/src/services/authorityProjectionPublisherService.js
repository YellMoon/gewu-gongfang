const {
  AUTHORITY_PROJECTION_PROTOCOL,
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

  async function publishAll({ authorityId, hostEpochId } = {}) {
    const authority = String(authorityId || '').trim();
    const epoch = String(hostEpochId || '').trim();
    if (!authority || !epoch) throw publisherError('AUTHORITY_PROJECTION_TARGET_REQUIRED');
    const { createAuthorityRuntimeHostEpochService } = require('./authorityRuntimeHostEpochService');
    const activeEpoch = createAuthorityRuntimeHostEpochService({ db }).find(epoch);
    if (!activeEpoch || activeEpoch.authority_id !== authority) throw publisherError('AUTHORITY_PROJECTION_HOST_EPOCH_INACTIVE');
    await prepareRemote({ authorityId: authority, hostEpochId: epoch });
    const version = Number(db.prepare(`SELECT version FROM authority_projection_versions
      WHERE authority_id=? AND host_epoch_id=?`).get(authority, epoch)?.version || 0);
    const source = await loadSource({ authorityId: authority, hostEpochId: epoch });
    let published = 0;
    const failures = [];
    for (const scope of scopesFor(authority)) {
      try {
        const existing = store.read({
          authorityId: authority,
          userId: scope.userId,
          role: scope.kind,
        });
        const document = existing
          && existing.hostEpochId === epoch
          && Number(existing.sourceVersion) === version
          ? existing
          : await signProjection({
            protocol: AUTHORITY_PROJECTION_PROTOCOL,
            authorityId: authority,
            hostEpochId: epoch,
            userId: scope.userId,
            role: scope.kind,
            sourceVersion: version,
            generatedAt: generatedAt(),
            payload: projectAuthorityData(scope, source),
          });
        if (document !== existing) store.publish(document);
        await publishRemote(document);
        published += 1;
      } catch (error) {
        failures.push(Object.freeze({
          userId: scope.userId,
          role: scope.kind,
          code: error?.code || error?.message || 'AUTHORITY_PROJECTION_PUBLISH_FAILED',
        }));
      }
    }
    return Object.freeze({
      authorityId: authority,
      hostEpochId: epoch,
      sourceVersion: version,
      published,
      failed: failures.length,
      failures: Object.freeze(failures),
    });
  }

  return Object.freeze({ publishAll });
}

module.exports = { createAuthorityProjectionPublisherService, publisherError };
