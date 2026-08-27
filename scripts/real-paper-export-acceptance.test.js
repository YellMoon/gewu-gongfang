'use strict';

const assert = require('assert');
const { artifactEvidence, waitForCompletedTask, waitForReadyDelivery } = require('./real-paper-export-acceptance');

assert.deepStrictEqual(artifactEvidence('pdf', Buffer.from('%PDF-1.7\nfixture\n%%EOF\n')), {
  format: 'pdf', extension: 'pdf', mimeType: 'application/pdf', bytes: 23,
});
assert.deepStrictEqual(artifactEvidence('word', Buffer.from('PK\x03\x04fixture')), {
  format: 'word', extension: 'docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: 11,
});
assert.throws(() => artifactEvidence('pdf', Buffer.from('not-a-pdf')), /REAL_PAPER_EXPORT_ARTIFACT_INVALID/);
assert.throws(() => artifactEvidence('word', Buffer.from('%PDF-1.7')), /REAL_PAPER_EXPORT_ARTIFACT_INVALID/);

(async () => {
  const completed = await waitForCompletedTask({
    read: async () => ({ status: 'completed', phase: 'completed', progress: 100 }), sleep: async () => {}, attempts: 1,
  });
  assert.strictEqual(completed.status, 'completed');
  await assert.rejects(
    () => waitForCompletedTask({ read: async () => ({ status: 'failed', phase: 'failed', progress: 0 }), sleep: async () => {}, attempts: 1 }),
    /REAL_PAPER_EXPORT_TASK_FAILED/,
  );
  const ready = await waitForReadyDelivery({
    read: async () => ({ status: 'ready' }), sleep: async () => {}, attempts: 1,
  });
  assert.strictEqual(ready.status, 'ready');
  console.log('real paper export acceptance checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
