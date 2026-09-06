export function claimAutomaticDesktopRegistration({ pending, attemptRef }) {
  if (pending?.status !== 'verified' || pending?.desktopAccess?.access !== 'allowed'
    || typeof pending?.verificationToken !== 'string' || !pending.verificationToken
    || attemptRef.current === pending.verificationToken) return false;
  attemptRef.current = pending.verificationToken;
  return true;
}

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
