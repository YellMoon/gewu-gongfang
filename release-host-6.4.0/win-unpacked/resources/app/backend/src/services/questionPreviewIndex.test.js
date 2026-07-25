const assert = require('assert');
const backend = require('./questionPreviewIndex');
const gateway = require('../../../gateway/src/services/questionPreviewIndex');

const snapshot = {
  id: 'snap-1', version: 'v1', created_at: '2026-07-14T00:00:00.000Z',
  payload: {
    questions: [
      { id: 'q-admin-draft', tenant_id: 'tenant-a', type: 'fill', stem: 'draft stem', storage_state: 'local_draft' },
      { id: 'q-a', tenant_id: 'tenant-a', type: 'choice', stem: '<p>student visible</p>', answer: 'A', analysis: 'secret', storage_state: 'host_committed' },
      { id: 'q-b', tenant_id: 'tenant-b', type: 'fill', stem: 'other tenant', storage_state: 'host_committed' },
    ],
    question_contents: [
      { question_id: 'q-a', tenant_id: 'tenant-a', stem: '<p>joined stem</p>', answer: 'A', explanation: 'secret explanation' },
    ],
  },
};

for (const [name, service] of [['backend', backend], ['gateway', gateway]]) {
  assert.strictEqual(service.safeHostBaseUrl('https://host.example:8443/base/'), 'https://host.example:8443/base');
  assert.strictEqual(service.safeHostBaseUrl('https://user:pass@host.example/base'), null, `${name}: credentials are forbidden`);
  assert.strictEqual(service.safeHostBaseUrl('https://host.example/base?token=secret'), null, `${name}: query credentials are forbidden`);
  assert.strictEqual(service.safeHostBaseUrl('file:///tmp/artifact'), null, `${name}: only HTTP(S) hosts are allowed`);
  const student = service.buildQuestionPreviewIndex(snapshot, { id: 'student-a', role: 'student', tenantId: 'tenant-a' });
  assert.deepStrictEqual(student.questions.map(item => item.id), ['q-a'], `${name}: student sees only committed same-tenant questions`);
  assert.deepStrictEqual(Object.keys(student.questions[0]).sort(), ['id', 'status', 'stemPreview', 'type'], `${name}: preview must not expose answer or analysis`);
  assert.ok(!JSON.stringify(student).includes('secret'), `${name}: student preview must not leak secret content`);
  const teacher = service.buildQuestionPreviewIndex(snapshot, { id: 'teacher-a', role: 'teacher', tenantId: 'tenant-a' });
  assert.deepStrictEqual(teacher.questions.map(item => item.id), ['q-a'], `${name}: non-admin teachers also see only committed questions`);
  const admin = service.buildQuestionPreviewIndex(snapshot, { id: 'admin-a', role: 'admin', tenantId: 'tenant-a' });
  assert.deepStrictEqual(admin.questions.map(item => item.id), ['q-admin-draft', 'q-a'], `${name}: admin sees same-tenant draft and committed questions`);
  assert.deepStrictEqual([admin.snapshotId, admin.version], ['snap-1', 'v1']);
}

assert.strictEqual(
  require('crypto').createHash('sha256').update(require('fs').readFileSync(require.resolve('./questionPreviewIndex'))).digest('hex'),
  require('crypto').createHash('sha256').update(require('fs').readFileSync(require.resolve('../../../gateway/src/services/questionPreviewIndex'))).digest('hex'),
  'backend and gateway question preview policy must stay byte-identical',
);

console.log('question preview index checks passed');
