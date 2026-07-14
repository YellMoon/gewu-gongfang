const assert = require('assert');

const {
  resolveExactQuestionSelection,
  resolveTaskQuestionSelection,
} = require('./paperExportSelectionService');

function questionBankFixture() {
  const rows = [
    { id: 'q1', tenant_id: 'tenant-a', status: 'published', stem: 'one' },
    { id: 'q2', tenant_id: 'tenant-a', status: 'published', stem: 'two' },
    { id: 'draft-a', tenant_id: 'tenant-a', status: 'draft', stem: 'draft' },
    { id: 'other-tenant', tenant_id: 'tenant-b', status: 'published', stem: 'private' },
  ];
  return {
    getQuestion(_db, id, tenantId) {
      return rows.find(row => row.id === id && row.tenant_id === tenantId) || null;
    },
    listQuestions(_db, filters, tenantId) {
      return rows.filter(row => row.tenant_id === tenantId && (!filters.status || row.status === filters.status));
    },
  };
}

const bank = questionBankFixture();
const context = { tenantId: 'tenant-a', allowDraft: false };

assert.deepStrictEqual(
  resolveExactQuestionSelection({}, { questionIds: ['q2', 'q1'] }, context, { questionBank: bank }).map(row => row.id),
  ['q2', 'q1'],
  'exact selection must preserve caller order'
);

assert.throws(
  () => resolveExactQuestionSelection({}, { questionIds: ['q1', 'q1'] }, context, { questionBank: bank }),
  error => error.code === 'QUESTION_IDS_DUPLICATE' && error.statusCode === 400
);
assert.throws(
  () => resolveExactQuestionSelection({}, { questionIds: ['q1', 'missing'] }, context, { questionBank: bank }),
  error => error.code === 'QUESTION_SELECTION_INCOMPLETE' && error.missingQuestionIds?.includes('missing')
);
assert.throws(
  () => resolveExactQuestionSelection({}, { questionIds: ['other-tenant'] }, context, { questionBank: bank }),
  error => error.code === 'QUESTION_SELECTION_INCOMPLETE',
  'cross-tenant IDs must fail closed without leaking whether the ID exists'
);
assert.throws(
  () => resolveExactQuestionSelection({}, { questionIds: ['draft-a'] }, context, { questionBank: bank }),
  error => error.code === 'QUESTION_DRAFT_FORBIDDEN' && error.statusCode === 403
);
assert.deepStrictEqual(
  resolveExactQuestionSelection({}, { questionIds: ['draft-a'] }, { ...context, allowDraft: true }, { questionBank: bank }).map(row => row.id),
  ['draft-a']
);

assert.throws(
  () => resolveTaskQuestionSelection({}, { protocolVersion: 2, payload: { questionCount: 1 } }, context, { questionBank: bank }),
  error => error.code === 'QUESTION_IDS_REQUIRED',
  'V2 must never fall back to count/filter selection'
);
assert.deepStrictEqual(
  resolveTaskQuestionSelection({}, { protocolVersion: 1, payload: { questionCount: 1 } }, context, { questionBank: bank }).map(row => row.id),
  ['q1'],
  'V1 tasks retain the legacy count/filter selection behavior'
);

console.log('paper export selection contract checks passed');
