const { normalizeDesktopAuthorizationSession, issueNativeQuestionDraft } = require('./desktopQuestionDeleteContext');
async function createNativeQuestionDraft(db, data, storage = globalThis.sessionStorage) {
  let issuedId = null;
  try { const session = normalizeDesktopAuthorizationSession(JSON.parse(storage?.getItem?.('gewu_desktop_authorization_session') || 'null')); issuedId = await issueNativeQuestionDraft(session); } catch (_error) {}
  if (!issuedId) throw Object.assign(new Error('DRAFT_PROVENANCE_UNAVAILABLE'), { code: 'DRAFT_PROVENANCE_UNAVAILABLE' });
  return db.createQuestion(data, issuedId);
}
module.exports = { createNativeQuestionDraft };
