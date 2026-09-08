'use strict';
// UTF-8: preserve the original StudentList calculation through the real HTTP/client/cache chain.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const ts = require('typescript');
const { createCloudBusinessApp } = require('./app');
const root = path.resolve(__dirname, '../..');
function balanceSource(text) {
  const ast = ts.createSourceFile('StudentList.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'getStudentBalance') found = node;
    ts.forEachChild(node, visit);
  }
  visit(ast); assert(found);
  return ts.createPrinter({ removeComments: true }).printNode(ts.EmitHint.Unspecified, found, ast);
}
(async () => {
  const compatibility = require('../../config/release-compatibility.json');
  const ledgerContract = compatibility.contracts.desktopStudentLedger;
  assert.deepEqual(ledgerContract.participants, ['desktop', 'cloud_business']);
  const original = balanceSource(cp.execFileSync('git', ['show', '8118419f:src/pages/StudentList.tsx'], { cwd: root, encoding: 'utf8' }));
  assert.equal(balanceSource(fs.readFileSync(path.join(root, 'src/pages/StudentList.tsx'), 'utf8')), original,
    'do not change the original balance formula to accommodate incomplete cloud data');
  const evaluate = new Function('payments', 'consumptions', 'PaymentType', ts.transpileModule(
    `const ${original}; return getStudentBalance('student-1');`, {}).outputText);
  const projection = {
    students: [{ id: 'student-1', name: '余额测试学生' }], studentContacts: [], teachers: [],
    courses: [], schedules: [], institutions: [], schools: [], rooms: [], assetRecords: [], assetCategories: [],
    payments: [{ id: 'hours', student_id: 'student-1', payment_type: 2, amount: 12 },
      { id: 'tuition', student_id: 'student-1', payment_type: 1, amount: 1200 }],
    consumptions: [{ id: 'lesson', student_id: 'student-1', schedule_id: 'schedule-1', hours: 1.5, amount: 180 }],
  };
  let context = { roles: ['teacher'], profile: { type: 'teacher', id: 'teacher-1' }, accountId: 'account-1' };
  let returned = projection;
  const queries = [];
  const app = createCloudBusinessApp({ businessTenantId: 'tenant-1',
    query: async (sql, values) => { queries.push({ sql, values }); return { rows: [{ projection: returned }] }; },
    desktopRegistration: { begin: async () => {}, register: async () => {}, sessionContext: async () => context },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const { createDesktopIdentityClient } = await import('../../src/services/desktopIdentityClient.mjs');
    const { buildAuthorityBackedBrowserCache } = await import('../../src/services/authorityProjectionCacheAdapter.mjs');
    const client = createDesktopIdentityClient({ desktopIdentity: { status: async () => ({}) } });
    const result = await client.listCloudBusinessProjection({ baseUrl: base, currentSession: { token: 'desktop.ticket' } });
    const cache = buildAuthorityBackedBrowserCache({ projection: { protocol: 'gewu.authority-projection.v1', sourceVersion: 1, payload: result } });
    assert.deepEqual(evaluate(cache.payments, cache.consumptions, { HOURS: 2, TUITION: 1 }),
      { balanceHours: 10.5, balanceMoney: 1020 }, 'teacher desktop must not display zero for a funded student');
    assert.equal(queries.length, 1, 'scope and ledger must be read in one database statement');
    assert.deepEqual(queries[0].values, ['tenant-1', 'teacher', 'teacher-1', 'account-1']);
    assert.match(queries[0].sql, /business\.payments/);
    assert.match(queries[0].sql, /business\.consumptions/);
    const get = () => fetch(base + '/api/business/desktop-projection', { headers: { authorization: 'Bearer desktop.ticket' } });
    for (const missing of ['payments', 'consumptions']) {
      returned = { ...projection }; delete returned[missing];
      assert.equal((await get()).status, 503, 'incomplete ledger must fail, not silently become a zero balance');
    }
    returned = projection;
    for (const role of ['student', 'family_member', 'visitor']) {
      context = { roles: [role], profile: { type: 'student', id: 'student-1' }, accountId: 'account-1' };
      const before = queries.length;
      assert.equal((await get()).status, 403); assert.equal(queries.length, before);
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
  console.log('original student balance HTTP/client/cache calculation and access checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
