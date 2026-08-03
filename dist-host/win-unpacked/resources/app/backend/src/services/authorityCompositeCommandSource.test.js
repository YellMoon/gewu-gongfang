const assert = require('assert');
const {
  createAuthorityCompositeCommandSource,
} = require('./authorityCompositeCommandSource');

(async function main() {
  const events = [];
  function source(id, commands) {
    return {
      claim: async input => {
        events.push(`${id}:claim:${input.limit}`);
        return commands.map(command => ({ ...command }));
      },
      renew: async input => {
        events.push(`${id}:renew:${input.commandId}`);
        return { commandId: input.commandId, source: id };
      },
      publishReceipt: async receipt => {
        events.push(`${id}:publish:${receipt.commandId}`);
        return receipt;
      },
    };
  }
  const composite = createAuthorityCompositeCommandSource({
    sources: [
      { id: 'local', source: source('local', [{ commandId: 'command-local', envelope: {} }]) },
      { id: 'cloud', source: source('cloud', [{ commandId: 'command-cloud', envelope: {} }]) },
    ],
  });
  const claimed = await composite.claim({
    targetHostId: 'host-1',
    claimToken: 'claim-1',
    leaseMs: 30000,
    limit: 10,
  });
  assert.deepStrictEqual(claimed.map(item => [item.commandId, item.sourceId]), [
    ['command-local', 'local'],
    ['command-cloud', 'cloud'],
  ]);
  await composite.renew({
    commandId: 'command-local',
    claimToken: 'claim-1',
    leaseMs: 30000,
    sourceId: 'local',
  });
  await composite.publishReceipt({ commandId: 'command-cloud' }, {
    claimToken: 'claim-1',
    sourceId: 'cloud',
  });
  assert.ok(events.includes('local:renew:command-local'));
  assert.ok(events.includes('cloud:publish:command-cloud'));
  assert.ok(!events.includes('cloud:renew:command-local'));

  console.log('authority composite command source tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
