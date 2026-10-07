const { issueNativeQuestionDraft } = require('./desktopQuestionDeleteContext');
const { importQuestionMetadata } = require('../../shared/questionImportMetadata.js');
async function createNativeQuestionDraft(db, data, _storage = globalThis.sessionStorage) {
  let issuedId = null;
  let session;
  const { readDesktopAuthorizationSession } = await import('./desktopAuthorizationSession.mjs');
  try {
    session = readDesktopAuthorizationSession();
    issuedId = await issueNativeQuestionDraft(session);
    const current = readDesktopAuthorizationSession();
    if (current.authorization !== session.authorization
      || current.authContext.userId !== session.authContext.userId
      || current.authContext.deviceId !== session.authContext.deviceId) issuedId = null;
  } catch (_error) { issuedId = null; }
  if (!issuedId) throw Object.assign(new Error('DRAFT_PROVENANCE_UNAVAILABLE'), { code: 'DRAFT_PROVENANCE_UNAVAILABLE' });
  return db.createQuestion({ ...data, ...importQuestionMetadata(data) }, issuedId);
}
module.exports = { createNativeQuestionDraft };
