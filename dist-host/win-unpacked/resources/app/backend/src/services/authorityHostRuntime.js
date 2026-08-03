const { createAuthorityCommandAuthorizationService } = require('./authorityCommandAuthorizationService');
const { createAuthorityCommandService } = require('./authorityCommandService');
const {
  createAuthorityCommandHandlers,
  createAuthorityCommandPolicy,
} = require('./authorityCommandRegistry');
const { createAuthorityHostCommandProcessor } = require('./authorityHostCommandProcessor');
const { createAuthorityProjectionVersionService } = require('./authorityProjectionVersionService');
const { createRoleApplicationService } = require('./roleApplicationService');
const { createPersonalAssetAccountService } = require('./personalAssetAccountService');
const { createPersonalAssetRecordService } = require('./personalAssetRecordService');
const questionBank = require('./questionBankService');
const questionStorageService = require('./questionBankStorageService');

function runtimeError(code) {
  return Object.assign(new Error(code), { code });
}

function createAuthorityHostRuntime({
  database,
  targetHostId,
  commandSource,
  now = () => new Date().toISOString(),
  createClaimToken,
} = {}) {
  const sqlite = database?.db || database;
  if (!database || !sqlite || typeof sqlite.prepare !== 'function') {
    throw runtimeError('AUTHORITY_HOST_DATABASE_REQUIRED');
  }
  const policy = createAuthorityCommandPolicy();
  const authorization = createAuthorityCommandAuthorizationService({
    db: sqlite,
    now,
    commandPolicy: policy,
  });
  const projectionVersions = createAuthorityProjectionVersionService({ db: sqlite, now });
  const roleApplications = createRoleApplicationService({ db: sqlite, now });
  const personalAssets = createPersonalAssetAccountService({ db: sqlite, now });
  const personalAssetRecords = createPersonalAssetRecordService({ db: sqlite, now });
  questionStorageService.recoverAuthorityQuestionStorageOperations({ db: sqlite });
  const executor = createAuthorityCommandService({
    db: sqlite,
    handlers: createAuthorityCommandHandlers({
      database,
      questionBank,
      questionStorageService,
      roleApplicationService: roleApplications,
      personalAssetAccountService: personalAssets,
      personalAssetRecordService: personalAssetRecords,
    }),
    now,
    authorizeEnvelope: envelope => authorization.authorize(envelope),
    nextProjectionVersion: envelope => projectionVersions.next(envelope),
    currentProjectionVersion: envelope => projectionVersions.current(envelope),
    afterCommit: () => questionStorageService.recoverAuthorityQuestionStorageOperations({ db: sqlite }),
    afterRollback: () => questionStorageService.recoverAuthorityQuestionStorageOperations({ db: sqlite }),
  });
  const processor = createAuthorityHostCommandProcessor({
    targetHostId,
    commandSource,
    executor,
    ...(createClaimToken ? { createClaimToken } : {}),
  });
  return Object.freeze({
    authorization,
    executor,
    policy,
    personalAssets,
    personalAssetRecords,
    processor,
    projectionVersions,
    roleApplications,
  });
}

module.exports = { createAuthorityHostRuntime, runtimeError };
