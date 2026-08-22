const assert = require('assert');

(async () => {
  const { getSyncPresentation } = await import('./syncPresentation.mjs');
  const pending = getSyncPresentation({ online: true, pendingCount: 12 });
  assert.strictEqual(pending.showDraftSubmission, true);
  assert.strictEqual(pending.primaryLabel, '\u4e0e\u4e91\u7aef\u540c\u6b65');
  assert(pending.helperText.includes('\u63d0\u4ea4\u672c\u673a\u8349\u7a3f'));
  assert(pending.helperText.includes('\u4e91\u7aef\u6700\u65b0\u6570\u636e'));
  assert(pending.statusText.includes('12'));

  const offline = getSyncPresentation({ online: false, pendingCount: 2 });
  assert.strictEqual(offline.tone, 'warning');
  assert(offline.statusText.includes('\u4e91\u7aef\u79bb\u7ebf'));

  const empty = getSyncPresentation({ online: true, pendingCount: 0 });
  assert(empty.statusText.includes('\u5df2\u662f\u6700\u65b0'));

  console.log('sync presentation checks passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
