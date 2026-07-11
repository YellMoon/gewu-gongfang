function normalizeDesktopQuestionDeleteContext(session = {}, capabilities = []) {
  const auth = session.authContext || {};
  return { capabilities: Array.isArray(capabilities) ? capabilities : [], deviceId: auth.deviceId || session.deviceId || '', userId: auth.userId || session.user?.id || session.userId || '' };
}
module.exports = { normalizeDesktopQuestionDeleteContext };
