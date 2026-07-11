function normalizeDesktopQuestionDeleteContext(session = {}, capabilities = []) {
  const auth = session.authContext || {};
  return { capabilities: Array.isArray(capabilities) ? capabilities : [], deviceId: auth.deviceId || session.deviceId || '', userId: auth.userId || session.user?.id || session.userId || '' };
}
function normalizeDesktopAuthorizationSession(session = {}) {
  const token = session.authorization || (session.token || session.accessToken ? `Bearer ${session.token || session.accessToken}` : '');
  const authContext = session.authContext || { userId: session.user?.id || session.userId || '', deviceId: session.deviceId || '' };
  return { authorization: token, authContext: { userId: authContext.userId || '', deviceId: authContext.deviceId || '' } };
}
async function verifyNativeQuestionDraft(questionId, session, bridge = globalThis.questionDraftProvenance) {
  if (!bridge?.verify || !session?.authorization) return false;
  try { return (await bridge.verify(questionId, session.authorization)) === true; } catch (_error) { return false; }
}
module.exports = { normalizeDesktopQuestionDeleteContext, normalizeDesktopAuthorizationSession, verifyNativeQuestionDraft };
