function capabilitiesFromDesktopCloudSession(session = {}) {
  const role = session.authContext?.activeRole || session.profile?.activeRole || session.activeRole || '';
  if (role === 'super_admin' || role === 'teacher') {
    return ['question-bank:view', 'question-bank:edit', 'question-bank:delete-committed'];
  }
  return [];
}
function normalizeDesktopQuestionDeleteContext(session = {}, capabilities) {
  const auth = session.authContext || {};
  return {
    capabilities: Array.isArray(capabilities) ? capabilities : capabilitiesFromDesktopCloudSession(session),
    deviceId: auth.deviceId || session.deviceId || '',
    userId: auth.userId || session.user?.id || session.userId || '',
  };
}
function normalizeDesktopAuthorizationSession(session = {}) {
  const token = session.authorization || (session.token || session.accessToken ? `Bearer ${session.token || session.accessToken}` : '');
  const authContext = session.authContext || { userId: session.user?.id || session.userId || '', deviceId: session.deviceId || '' };
  return { authorization: token, authContext: { userId: authContext.userId || '', deviceId: authContext.deviceId || '' } };
}
async function verifyNativeQuestionDraft(questionId, session, bridge = globalThis.questionDraftProvenance) {
  if (!bridge?.verifyDraft || !session?.authorization) return false;
  try { return (await bridge.verifyDraft(questionId, session.authorization)) === true; } catch (_error) { return false; }
}
async function issueNativeQuestionDraft(session, bridge = globalThis.questionDraftProvenance) {
  if (!bridge?.issueDraft || !session?.authorization) return null;
  try { const result = await bridge.issueDraft(session.authorization); return result?.questionId || null; } catch (_error) { return null; }
}
module.exports = { capabilitiesFromDesktopCloudSession, normalizeDesktopQuestionDeleteContext, normalizeDesktopAuthorizationSession, verifyNativeQuestionDraft, issueNativeQuestionDraft };
