'use strict';

const assert = require('assert');
const { artifactEvidence, waitForCompletedTask, waitForReadyDelivery, loadExplicitQuestionIds, exportMarker, verifyRendererRevision } = require('./real-paper-export-acceptance');

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
  const queries = [];
  const selected = await loadExplicitQuestionIds({
    query: async (sql, values) => {
      queries.push({ sql, values });
      return { rows: [
        { sourceType: 'exam', questionId: 'question-import-exam', contentHash: 'c'.repeat(64) },
        { sourceType: 'lecture', questionId: 'question-import-lecture', contentHash: 'd'.repeat(64) },
      ] };
    },
    tenantId: 'default', examSha256: 'a'.repeat(64), lectureSha256: 'b'.repeat(64),
  });
  assert.deepStrictEqual(selected, [
    { sourceType: 'exam', questionId: 'question-import-exam', contentHash: 'c'.repeat(64) },
    { sourceType: 'lecture', questionId: 'question-import-lecture', contentHash: 'd'.repeat(64) },
  ]);
  assert.deepStrictEqual(queries[0].values, ['default', 'a'.repeat(64), 'b'.repeat(64)]);
  assert.match(queries[0].sql, /source_sha256/u);
  assert.match(queries[0].sql, /item_index=0/u);
  assert.match(queries[0].sql, /question\.status='published'/u);
  assert.match(queries[0].sql, /content\.content_hash=item\.content_hash/u);
  assert.ok(queries[0].sql.indexOf('WHERE rank=1') < queries[0].sql.indexOf('JOIN business.questions'),
    'the latest matching submitted task must be fixed before publication/content checks so the acceptance cannot fall back to an older import');
  await assert.rejects(
    () => loadExplicitQuestionIds({ query: async () => ({ rows: [] }), tenantId: 'default', examSha256: 'a'.repeat(64), lectureSha256: 'b'.repeat(64) }),
    /REAL_PAPER_EXPORT_QUESTIONS_UNAVAILABLE/,
  );
  const selection = [
    { questionId: 'question-import-exam', contentHash: 'd'.repeat(64) },
    { questionId: 'question-import-lecture', contentHash: 'e'.repeat(64) },
  ];
  assert.strictEqual(exportMarker('a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64), selection), exportMarker('a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64), selection));
  assert.notStrictEqual(exportMarker('a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64), selection), exportMarker('a'.repeat(64), 'c'.repeat(64), 'c'.repeat(64), selection));
  assert.notStrictEqual(exportMarker('a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64), selection), exportMarker('a'.repeat(64), 'b'.repeat(64), 'd'.repeat(64), selection),
    'a renderer revision must receive a fresh deterministic export task instead of replaying an old artifact');
  assert.notStrictEqual(exportMarker('a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64), selection), exportMarker('a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64), [
    { questionId: 'question-import-new-exam', contentHash: 'f'.repeat(64) }, selection[1],
  ]), 'a changed parsed question selection must receive a fresh deterministic export task');
  assert.strictEqual(verifyRendererRevision(__filename, require('crypto').createHash('sha256').update(require('fs').readFileSync(__filename)).digest('hex')).length, 64);
  assert.throws(() => verifyRendererRevision(__filename, '0'.repeat(64)), /REAL_PAPER_EXPORT_RENDERER_MISMATCH/);
  console.log('real paper export acceptance checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
