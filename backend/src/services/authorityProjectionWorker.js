const { createHostCommandWorker } = require('./hostCommandWorker');
const { createAuthorityRuntimeHostEpochService } = require('./authorityRuntimeHostEpochService');

function projectionWorkerError(code, details) {
  return Object.assign(new Error(code), { code, details });
}

function createAuthorityProjectionWorker({
  db,
  publisher,
  targetHostId = '',
  ...workerOptions
} = {}) {
  if (!db || typeof db.prepare !== 'function') {
    throw projectionWorkerError('AUTHORITY_PROJECTION_WORKER_DATABASE_REQUIRED');
  }
  if (!publisher || typeof publisher.publishAll !== 'function') {
    throw projectionWorkerError('AUTHORITY_PROJECTION_PUBLISHER_REQUIRED');
  }
  const normalizedTargetHostId = String(targetHostId || '').trim();
  const runtimeEpochs = createAuthorityRuntimeHostEpochService({ db });

  const worker = createHostCommandWorker({
    ...workerOptions,
    processOnce: async () => {
      const epoch = normalizedTargetHostId ? runtimeEpochs.findForDevice(normalizedTargetHostId) : runtimeEpochs.findLatest();
      if (!epoch) {
        return Object.freeze({
          processed: 0,
          skipped: 'AUTHORITY_HOST_EPOCH_INACTIVE',
        });
      }
      const result = await publisher.publishAll({
        authorityId: epoch.authority_id,
        hostEpochId: epoch.id,
      });
      if (Number(result?.failed || 0) > 0) {
        throw projectionWorkerError('AUTHORITY_PROJECTION_PUBLISH_PARTIAL_FAILURE', result);
      }
      return Object.freeze({
        ...result,
        processed: Number(result?.published || 0),
      });
    },
  });

  return worker;
}

module.exports = {
  createAuthorityProjectionWorker,
  projectionWorkerError,
};
