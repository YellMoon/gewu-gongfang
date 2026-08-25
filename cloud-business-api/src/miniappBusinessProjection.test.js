'use strict';

const assert = require('assert');
const { createCloudBusinessApp } = require('./app');

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
      throw new Error('rejected');
    },
    pendingAccounts: async () => [],
    assignRole: async () => { throw new Error('not used'); },
  };
  const projection = {
    students: [], studentContacts: [], teachers: [], courses: [], schedules: [], institutions: [], schools: [], rooms: [], assetRecords: [], assetCategories: [],
  };
  const app = createCloudBusinessApp({
    query: async (text, values) => {
      queries.push([text, values]);
      return { rows: [{ projection }] };
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
  console.log('cloud miniapp business projection checks passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
