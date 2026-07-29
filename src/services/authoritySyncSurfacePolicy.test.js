const assert = require('assert');

async function main() {
  const { authoritySyncSurfacePolicy } = await import('./authoritySyncSurfacePolicy.mjs');
  assert.deepStrictEqual(authoritySyncSurfacePolicy('desktop-client'), {
    surface: 'client-outbox', allowsOutboundSubmission: true, showsHostExecutionMonitor: false,
  });
  assert.deepStrictEqual(authoritySyncSurfacePolicy('primary-host'), {
    surface: 'host-execution-monitor', allowsOutboundSubmission: false, showsHostExecutionMonitor: true,
  });
  console.log('authority sync surface policy tests passed');
}

main().catch(error => { console.error(error); process.exit(1); });
