const { normalizeDesktopAuthorizationSession, issueNativeQuestionDraft } = require('./desktopQuestionDeleteContext');
async function createNativeQuestionDraft(db, data, storage = globalThis.sessionStorage) {
  let issuedId = null;
  try { const session = normalizeDesktopAuthorizationSession(JSON.parse(storage?.getItem?.('gewu_desktop_authorization_session') || 'null')); issuedId = await issueNativeQuestionDraft(session); } catch (_error) {}
  return db.createQuestion(data, issuedId || undefined);
}
module.exports = { createNativeQuestionDraft };
