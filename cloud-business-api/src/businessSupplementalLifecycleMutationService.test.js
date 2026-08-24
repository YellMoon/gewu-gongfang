'use strict';

const assert = require('assert');
const { createBusinessSupplementalLifecycleMutations } = require('./businessSupplementalLifecycleMutationService');

(async () => {
  const calls = [];
  const mutations = createBusinessSupplementalLifecycleMutations({ query: async (sql, values) => {
    calls.push([sql, values]);
    return { rows: [{ id: values[1], updatedAt: '2026-08-24T07:00:00.000Z' }] };
  } });
  await mutations.payments.create({ tenantId: 'default', paymentId: 'payment-1', studentId: 'student-1', amount: 800, paymentType: 1, paymentDate: '2026-08-24', paymentMethod: 'wechat', notes: null });
  await mutations.payments.update({ tenantId: 'default', paymentId: 'payment-1', expectedUpdatedAt: '2026-08-24T06:00:00.000Z', studentId: 'student-1', amount: 900, paymentType: 1, paymentDate: '2026-08-24', paymentMethod: 'wechat', notes: null });
  await mutations.payments.remove({ tenantId: 'default', paymentId: 'payment-1', expectedUpdatedAt: '2026-08-24T07:00:00.000Z' });
  await mutations.consumptions.create({ tenantId: 'default', consumptionId: 'consumption-1', scheduleId: 'schedule-1', studentId: 'student-1', hours: 1.5, amount: 150, consumptionDate: '2026-08-24', notes: null });
  await mutations.grades.create({ tenantId: 'default', gradeId: 'grade-1', studentId: 'student-1', subject: 'physics', score: 92, examDate: '2026-08-24', notes: null });
  await mutations.assetCategories.create({ tenantId: 'default', accountId: 'account-1', categoryId: 'cat-1', name: 'books', type: 'expense', color: '#123456' });
  await mutations.assetRecords.create({ tenantId: 'default', accountId: 'account-1', recordId: 'asset-1', date: '2026-08-24', type: 'expense', categoryId: 'cat-1', categoryName: 'books', amount: 60, studentId: null, studentName: null, note: '' });
  assert.match(calls[0][0], /INSERT INTO business\.payments/);
  assert.match(calls[1][0], /updated_at=transaction_timestamp\(\)/);
  assert.match(calls[1][0], /updated_at=\$3::timestamptz/);
  assert.match(calls[2][0], /deleted=true/);
  assert.match(calls[3][0], /INSERT INTO business\.consumptions/);
  assert.match(calls[4][0], /INSERT INTO business\.grades/);
  assert.match(calls[5][0], /personal_asset_manual_categories/);
  assert.match(calls[6][0], /personal_asset_manual_records/);
  console.log('business supplemental lifecycle mutation service checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
