export async function resumeOfflineAfterNetworkFailure({ client, baseUrl }) {
  return client.resume({ baseUrl, online: false });
}

export async function commitRoleSwitchRuntime({
  switched,
  onlineSessionRef,
  resolveNext,
  setOnlineSession,
  installIdentityContext,
  setGateState,
  setRuntimeSuspended,
}) {
  onlineSessionRef.current = switched;
  const next = await resolveNext();
  setOnlineSession(switched);
  installIdentityContext(next);
  setGateState(next);
  setRuntimeSuspended(false);
}
