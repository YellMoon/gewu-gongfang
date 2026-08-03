const assert = require('assert');
const { processHostTaskCycle } = require('./cloudRelayHost');

async function main() {
  const result = await processHostTaskCycle({ fake: true }, {
    hostCredential: 'managed-host-credential', hostDeviceId: 'host-1', hostGeneration: 1,
  }, {
    processClaimedV2Tasks: async () => [{ id: 'v2-1', success: true }],
  });
  assert.equal(result.processed, 1);
  assert.deepStrictEqual(result.results, [{ id: 'v2-1', success: true }]);
  console.log('cloudRelayHost cycle tests passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
