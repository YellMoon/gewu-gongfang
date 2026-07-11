const assert = require('assert');

(async () => {
  const { getSyncPresentation } = await import('./syncPresentation.mjs');
  const client = getSyncPresentation('desktop-client', {
    online: true,
    pendingCount: 12,
    lastSyncTime: Date.now(),
  });
  assert.strictEqual(client.isHost, false);
  assert.strictEqual(client.primaryLabel, '\u4e0e\u6570\u636e\u4e3b\u673a\u53cc\u5411\u540c\u6b65');
  assert(client.helperText.includes('\u4e0a\u4f20\u672c\u673a\u66f4\u6539'));
  assert(client.helperText.includes('\u83b7\u53d6\u5e76\u5408\u5e76\u4e3b\u673a\u6700\u65b0\u6570\u636e'));
  assert(client.statusText.includes('12'));

  const host = getSyncPresentation('primary-host', {
    online: true,
    pendingCount: 0,
    conflictCount: 3,
  });
  assert.strictEqual(host.isHost, true);
  assert.strictEqual(host.primaryLabel, '\u5904\u7406\u5f85\u540c\u6b65\u8bf7\u6c42');
  assert.strictEqual(host.secondaryLabel, '\u67e5\u770b\u51b2\u7a81\u5ba1\u6838');
  assert.strictEqual(host.showClientSync, false);

  const offline = getSyncPresentation('desktop-client', { online: false, pendingCount: 2 });
  assert.strictEqual(offline.tone, 'warning');
  assert(offline.statusText.includes('\u4e3b\u673a\u79bb\u7ebf'));

  const empty = getSyncPresentation('desktop-client', { online: true, pendingCount: 0 });
  assert(empty.statusText.includes('\u5df2\u662f\u6700\u65b0'));

  console.log('sync presentation checks passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
