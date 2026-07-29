export function authoritySyncSurfacePolicy(nodeRole) {
  if (nodeRole === 'primary-host') {
    return Object.freeze({
      surface: 'host-execution-monitor',
      allowsOutboundSubmission: false,
      showsHostExecutionMonitor: true,
    });
  }
  return Object.freeze({
    surface: 'client-outbox',
    allowsOutboundSubmission: true,
    showsHostExecutionMonitor: false,
  });
}
