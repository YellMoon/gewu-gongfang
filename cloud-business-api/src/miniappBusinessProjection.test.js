'use strict';

const assert = require('assert');
const { createCloudBusinessApp } = require('./app');
const { STUDENT_SCHEDULE_TUITION_SQL } = require('./studentScheduleTuitionSql');

async function request(app, path, { headers = {} } = {}) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { headers });
    const text = await response.text();
    let body = null;
    try { body = JSON.parse(text); } catch (_) { /* a missing route is intentionally asserted below */ }
    return { status: response.status, body };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

(async () => {
  const queries = [];
  const miniappCloudAccount = {
    login: async () => { throw new Error('not used'); },
    context: async ({ token }) => {
      if (token === 'miniapp-ticket.signature') {
        return { accountId: 'miniapp-account-1', status: 'active', roles: ['super_admin'], profile: null };
      }
      if (token === 'teacher-ticket.signature') {
        return { accountId: 'miniapp-account-2', status: 'active', roles: ['teacher'], profile: { type: 'teacher', id: 'teacher-1' } };
      }
      if (token === 'student-ticket.signature') {
        return { accountId: 'miniapp-account-3', status: 'active', roles: ['student'], profile: { type: 'student', id: 'student-1' } };
      }
      if (token === 'family-ticket.signature') {
        return { accountId: 'miniapp-account-4', status: 'active', roles: ['family_member'], profile: { type: 'student', id: 'student-1', relationship: 'guardian' } };
      }
      if (token === 'visitor-ticket.signature') return { accountId: 'visitor', status: 'visitor', roles: [], profile: null };
      if (token === 'unbound-ticket.signature') return { accountId: 'unbound', status: 'active', roles: ['student'], profile: null };
      throw new Error('rejected');
    },
    pendingAccounts: async () => [],
    assignRole: async () => { throw new Error('not used'); },
  };
  const projection = {
    students: [{ id: 'student-1', balance_hours: 10.5, balance_money: 1020 }], studentContacts: [], teachers: [], courses: [], schedules: [], institutions: [], schools: [], rooms: [], assetRecords: [], assetCategories: [],
    payments: [{ id: 'payment-1', student_id: 'student-1', payment_type: 1, amount: 1200 }],
    grades: [{ id: 'grade-1', student_id: 'student-1', subject: 'Physics', score: 86 }],
  };
  let returned = projection;
  const app = createCloudBusinessApp({
    query: async (text, values) => {
      queries.push([text, values]);
      return { rows: [{ projection: returned }] };
    },
    miniappCloudAccount,
    businessTenantId: 'default',
  });

  const response = await request(app, '/api/business/miniapp-projection', {
    headers: { authorization: 'Bearer miniapp-ticket.signature' },
  });

  assert.strictEqual(response.status, 200);
  assert.deepStrictEqual(response.body, { ok: true, projection });
  assert.strictEqual(queries.length, 1, 'the cloud must assemble the miniapp read model in one scoped query');
  assert.deepStrictEqual(queries[0][1], ['default', 'manager', null, 'miniapp-account-1']);
  assert.ok(queries[0][0].includes('business.students'));
  assert.ok(queries[0][0].includes('business.courses'));
  assert.ok(queries[0][0].includes('business.schedules'));
  assert.ok(queries[0][0].includes('business.schedule_student_overrides'));
  assert.ok(queries[0][0].includes('business.personal_asset_records'), 'personal assets must be read from the cloud authority');
  assert.ok(queries[0][0].includes('account_id=$4'), 'personal assets must be scoped to the active account');
  assert.ok(queries[0][0].includes('business.personal_asset_manual_records'), 'manual desktop asset records must join the same cloud projection');
  assert.ok(queries[0][0].includes('JOIN scoped_students s ON s.id=d.student_id'), 'contacts inherit tenant scope from the selected student');
  assert.ok(!queries[0][0].includes('d.tenant_id'), 'the contact directory has no tenant_id column');
  assert.ok(queries[0][0].includes('business.payments') && queries[0][0].includes('business.consumptions')
    && queries[0][0].includes('business.grades'), 'student balances and visible record tabs must read the cloud ledger');
  assert.ok(!Object.hasOwn(response.body.projection, 'consumptions'), 'raw consumption records are not part of the miniapp response');

  const teacherResponse = await request(app, '/api/business/miniapp-projection', {
    headers: { authorization: 'Bearer teacher-ticket.signature' },
  });
  assert.strictEqual(teacherResponse.status, 200);
  assert.deepStrictEqual(queries[1][1], ['default', 'teacher', 'teacher-1', 'miniapp-account-2']);

  const studentResponse = await request(app, '/api/business/miniapp-projection', {
    headers: { authorization: 'Bearer student-ticket.signature' },
  });
  assert.strictEqual(studentResponse.status, 200);
  assert.deepStrictEqual(queries[2][1], ['default', 'student', 'student-1', 'miniapp-account-3']);
  assert.ok(queries[2][0].includes('NOT EXISTS (SELECT 1 FROM business.schedule_student_overrides'));
  assert.ok(queries[2][0].includes("CASE WHEN $2 IN ('manager','teacher') THEN t.hourly_rate ELSE NULL END"), 'student projections must not receive teacher hourly rates');
  assert.ok(queries[2][0].includes("'price_teacher',CASE WHEN $2 IN ('manager','teacher') THEN c.price_teacher ELSE NULL END"), 'student projections must not receive course teacher fees');
  assert.ok(queries[2][0].includes("'teacher_fee',CASE WHEN $2 IN ('manager','teacher') THEN p.teacher_fee ELSE NULL END"), 'student projections must not receive per-student teacher fees');
  assert.ok(queries[2][0].includes("'teacher_fee',CASE WHEN $2 IN ('manager','teacher') THEN o.teacher_fee ELSE NULL END"), 'student projections must not receive override teacher fees');
  const familyResponse = await request(app, '/api/business/miniapp-projection', {
    headers: { authorization: 'Bearer family-ticket.signature' },
  });
  assert.strictEqual(familyResponse.status, 200);
  assert.deepStrictEqual(queries[3][1], ['default', 'student', 'student-1', 'miniapp-account-4']);
  assert.ok(queries[2][0].includes(STUDENT_SCHEDULE_TUITION_SQL), 'student projection must calculate scoped session totals, not expose hourly rates as totals');
  const scheduleResponse = await request(app, '/api/business/schedules', { headers: { authorization: 'Bearer student-ticket.signature' } });
  assert.strictEqual(scheduleResponse.status, 200);
  assert.ok(queries.at(-1)[0].includes(STUDENT_SCHEDULE_TUITION_SQL), 'schedule list and projection must use the same scoped tuition calculation');
  for (const missing of ['payments', 'grades', 'balance_hours', 'balance_money']) {
    returned = structuredClone(projection);
    if (missing.startsWith('balance_')) delete returned.students[0][missing];
    else delete returned[missing];
    const incomplete = await request(app, '/api/business/miniapp-projection', { headers: { authorization: 'Bearer student-ticket.signature' } });
    assert.equal(incomplete.status, 503, 'incomplete student records must fail closed, not look like no payments or no balance');
  }
  for (const token of ['visitor-ticket.signature', 'unbound-ticket.signature']) {
    const before = queries.length;
    const denied = await request(app, '/api/business/miniapp-projection', { headers: { authorization: `Bearer ${token}` } });
    assert.equal(denied.status, 403);
    assert.equal(queries.length, before, 'unauthorized accounts must not query the student ledger');
  }
  const contract = require('../../config/release-compatibility.json').contracts.miniappStudentLedger;
  assert.deepStrictEqual(contract.participants, ['cloud_business', 'miniapp']);
  console.log('cloud miniapp business projection checks passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
