'use strict';
const assert = require('node:assert/strict');
const { createCloudBusinessApp } = require('./app');
const { MODULE_COLLECTIONS, scopeProjectionSql } = require('./desktopProjectionScope');
const keys = ['students','student_contacts','studentContacts','teachers','courses','schedules','institutions','schools','rooms','grades','payments','consumptions','assetRecords','assetCategories','taxonomy_systems','taxonomy_nodes'];
(async () => {
  for (const role of ['super_admin', 'teacher', 'student']) {
    const queries = [];
    const app = createCloudBusinessApp({ businessTenantId: 'tenant', query: async (sql, params) => {
      queries.push({ sql, params });
      assert.equal(Math.max(...[...sql.matchAll(/\$(\d+)/g)].map(match => Number(match[1]))), params.length, 'scoped query has the exact bind count');
      return { rows: [{ projection: Object.fromEntries(keys.map(key => [key, []])) }] };
    }, desktopRegistration: { begin: async () => ({}), register: async () => ({}), sessionContext: async () => ({ accountId: 'actor', roles: [role], teacherId: 'teacher', studentId: 'student' }) } });
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    try {
      for (const module of ['courses', 'schedules', 'invalid']) {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/api/business/desktop-projection?module=${module}`, { headers: { authorization: 'Bearer eyJ2IjoxfQ.signature' } });
        assert.equal(response.status, module === 'invalid' ? 400 : role === 'student' ? 403 : 200, role + '/' + module);
        const body = await response.json();
        if (response.status !== 200) continue;
        assert.equal(body.module, module);
        assert.deepEqual(body.collections, MODULE_COLLECTIONS[module]);
        const { sql } = queries.at(-1);
        for (const unwanted of ['business.payments','business.consumptions','business.question_taxonomy_nodes','business.personal_asset_records','business.student_contact_directory']) assert(!sql.includes(unwanted), 'unrelated aggregate skipped: ' + unwanted);
        assert(sql.includes('legacy_deleted=false'), 'tombstone boundary retained');
        if (role === 'teacher') assert(sql.includes('managed_teachers') && sql.includes('scoped_courses'), 'teacher authorization CTEs retained');
      }
    } finally { await new Promise(resolve => server.close(resolve)); }
  }
  const sql = "SELECT jsonb_build_object('courses',COALESCE((SELECT jsonb_agg(jsonb_build_object('name','a,b)''c')) FROM courses),'[]'::jsonb),'rooms','[]'::jsonb,'students',(SELECT broken() FROM unrelated)) AS projection";
  const scoped = scopeProjectionSql(sql, 'courses');
  assert(scoped.includes("'name','a,b)''c'"));
  assert(!scoped.includes('broken()'));
  assert.throws(() => scopeProjectionSql(sql, '__proto__'));
  console.log('module projection real REST: admin/teacher scopes, student denial, exact SQL binds and skipped unrelated aggregates passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
