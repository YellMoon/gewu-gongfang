'use strict';

const assert = require('assert');
const { createCloudBusinessApp } = require('./app');

async function request(app, path, method, body) {
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { authorization: 'Bearer desktop.ticket', 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  } finally { await new Promise(resolve => server.close(resolve)); }
}

(async () => {
  const calls = [];
  const resource = (name, idKey) => ({
    create: async input => { calls.push([`${name}.create`, input]); return { id: input[idKey], updatedAt: '2026-08-24T07:00:00.000Z' }; },
    update: async input => { calls.push([`${name}.update`, input]); return { id: input[idKey], updatedAt: '2026-08-24T07:01:00.000Z' }; },
    remove: async input => { calls.push([`${name}.remove`, input]); return { id: input[idKey], updatedAt: '2026-08-24T07:02:00.000Z' }; },
  });
  const mutations = {
    payments: resource('payment', 'paymentId'),
    consumptions: resource('consumption', 'consumptionId'),
    grades: resource('grade', 'gradeId'),
    assetCategories: resource('assetCategory', 'categoryId'),
    assetRecords: resource('assetRecord', 'recordId'),
  };
  const app = createCloudBusinessApp({
    query: async () => ({ rows: [] }), businessTenantId: 'default', businessSupplementalLifecycleMutations: mutations,
    desktopRegistration: { begin: async () => null, register: async () => null, sessionContext: async () => ({ accountId: 'account-1', roles: ['super_admin'] }) },
  });
  const at = '2026-08-24T07:00:00.000Z';
  const payment = { studentId: 'student-1', amount: 800, paymentType: 1, paymentDate: '2026-08-24', paymentMethod: 'wechat', notes: null };
  assert.strictEqual((await request(app, '/api/business/payments', 'POST', { paymentId: 'payment-1', data: payment })).status, 201);
  assert.strictEqual((await request(app, '/api/business/payments/payment-1', 'PUT', { expectedUpdatedAt: at, ...payment })).status, 200);
  assert.strictEqual((await request(app, '/api/business/payments/payment-1', 'DELETE', { expectedUpdatedAt: at })).status, 200);
  const consumption = { scheduleId: 'schedule-1', studentId: 'student-1', hours: 1.5, amount: 150, consumptionDate: '2026-08-24', notes: null };
  assert.strictEqual((await request(app, '/api/business/consumptions', 'POST', { consumptionId: 'consumption-1', data: consumption })).status, 201);
  assert.strictEqual((await request(app, '/api/business/consumptions/consumption-1', 'PUT', { expectedUpdatedAt: at, ...consumption })).status, 200);
  assert.strictEqual((await request(app, '/api/business/consumptions/consumption-1', 'DELETE', { expectedUpdatedAt: at })).status, 200);
  const grade = { studentId: 'student-1', subject: 'physics', score: 92, examDate: null, notes: null };
  assert.strictEqual((await request(app, '/api/business/grades', 'POST', { gradeId: 'grade-1', data: grade })).status, 201);
  assert.strictEqual((await request(app, '/api/business/grades/grade-1', 'DELETE', { expectedUpdatedAt: at })).status, 200);
  const category = { name: 'books', type: 'expense', color: '#123456' };
  assert.strictEqual((await request(app, '/api/business/personal-asset-categories', 'POST', { categoryId: 'cat-1', data: category })).status, 201);
  assert.strictEqual(calls.at(-1)[1].accountId, 'account-1');
  const asset = { date: '2026-08-24', type: 'expense', categoryId: 'cat-1', categoryName: 'books', amount: 60, studentId: null, studentName: null, note: '' };
  assert.strictEqual((await request(app, '/api/business/personal-asset-records', 'POST', { recordId: 'asset-1', data: asset })).status, 201);
  assert.strictEqual((await request(app, '/api/business/personal-asset-records/asset-1', 'PUT', { expectedUpdatedAt: at, ...asset })).status, 200);
  assert.strictEqual((await request(app, '/api/business/personal-asset-records/asset-1', 'DELETE', { expectedUpdatedAt: at })).status, 200);
  assert.strictEqual((await request(app, '/api/business/personal-asset-categories/cat-1', 'DELETE', { expectedUpdatedAt: at })).status, 200);
  assert.strictEqual(calls.length, 13);
  const deniedApp = createCloudBusinessApp({
    query: async () => ({ rows: [] }), businessTenantId: 'default', businessSupplementalLifecycleMutations: mutations,
    desktopRegistration: { begin: async () => null, register: async () => null, sessionContext: async () => ({ accountId: 'account-student', roles: ['student'] }) },
  });
  assert.strictEqual((await request(deniedApp, '/api/business/payments', 'POST', { paymentId: 'denied', data: payment })).status, 403);
  assert.strictEqual(calls.length, 13, 'non-super-admin desktop sessions must never reach supplemental mutations');
  console.log('supplemental lifecycle route checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
