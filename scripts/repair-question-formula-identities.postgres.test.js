'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createDisposablePg17Runtime, withVNextPg17SyntheticQuery } = require('../shared/vnext-pg17/disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('../shared/vnext-pg17/catalogAssertion');
const { createBusinessFoundationCatalogBoundary } = require('../shared/vnext-pg17/businessFoundationCatalogAssertion');
const { buildRepairPlan, contentHash, applyRepairPlan, stableJson } = require('./repair-question-formula-identities');
const APPLY = { appliedAt: '2026-09-06T00:00:00.000Z', appliedBy: 'formula-identity-repair-test' };

(async () => {
  const runtime = createDisposablePg17Runtime();
  await runtime.start();
  const handle = await runtime.createIsolatedHandle();
  const originalId = 'formula-78ff6f73e7b3cdac5df039a9';
  const rich = { version: 1, type: 'question-document', sections: { stem: { type: 'doc', content: [{ type: 'formula', attrs: { id: 'formula-78ff6f73e7b3 cdac5df039a9', canonicalLatex: 'x', displayMode: 'inline' } }] } } };
  const rows = ['a', 'b'].map(letter => {
    const row = { id: 'question-import-' + letter.repeat(40), status: 'draft', version: 1, sourceHash: 'c'.repeat(64), itemHash: letter.repeat(64), taskId: 'question_import_task_test', itemId: 'question_import_item_' + letter,
      richContent: rich, originalRichContent: rich, stem: 'unaltered stem', options: [], answer: null, explanation: null };
    return { ...row, contentHash: contentHash(row, rich) };
  });
  const plan = buildRepairPlan(rows, [{ taskId: rows[0].taskId, formula: { id: originalId, canonical_latex: 'x' } }]);
  try {
    await createVNextPg17CatalogBoundary(runtime).apply(handle, APPLY);
    await createBusinessFoundationCatalogBoundary(runtime).apply(handle, APPLY);
    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
      await facade.query('CREATE ROLE gewu_cloud_schedule_reader');
      for (const file of ['20260823-cloud-question-authority.sql', '20260823-cloud-question-command-receipts.sql']) {
        const sql = fs.readFileSync(path.join(__dirname, '../cloud-business-api/sql', file), 'utf8').replace('BEGIN;', 'BEGIN; SET LOCAL ROLE vnext_pg17_business_owner;');
        await facade.query(sql);
      }
      // Disposable test only: mirror the existing limited runtime membership, never owner membership.
      await facade.query('GRANT gewu_cloud_schedule_reader TO vnext_pg17_writer');
      await facade.query('GRANT USAGE ON SCHEMA business TO gewu_cloud_schedule_reader');
      await facade.query("INSERT INTO business.tenants(id,name,legacy_deleted,created_at,updated_at) VALUES ('tenant-1','Fixture',false,now(),now())");
      for (const row of rows) {
        await facade.query("INSERT INTO business.questions(id,tenant_id,subject,question_type,difficulty) VALUES ($1,'tenant-1','physics','single_choice',3)", [row.id]);
        await facade.query("INSERT INTO business.question_contents(question_id,tenant_id,stem,options_json,rich_content_json,content_hash) VALUES ($1,'tenant-1',$2,'[]',$3::jsonb,$4)", [row.id, row.stem, stableJson(rich), row.contentHash]);
      }
    });
    await withVNextPg17SyntheticQuery(handle, 'writer', async facade => {
      await facade.query('SET ROLE gewu_cloud_schedule_reader');
      const actor = { tenantId: 'tenant-1', accountId: 'test-super-admin', roles: ['super_admin'] };
      const role = (await facade.query("SELECT pg_has_role(current_user,'vnext_pg17_business_owner','MEMBER') AS owns")).rows[0];
      assert.equal(role.owns, false);
      // Force failure on the second record; transaction rollback must undo the first update and its receipt.
      await facade.query('BEGIN');
      await facade.query('UPDATE business.question_contents SET version=2 WHERE question_id=$1', [rows[1].id]);
      await assert.rejects(applyRepairPlan((...args) => facade.query(...args), plan, actor), /STATE_CHANGED/);
      await facade.query('ROLLBACK');
      const before = await facade.query('SELECT version,rich_content_json AS rich FROM business.question_contents ORDER BY question_id');
      assert(before.rows.every(row => row.version === 1 && row.rich.sections.stem.content[0].attrs.id.includes(' ')));
      assert.equal((await facade.query('SELECT count(*)::integer AS count FROM business.desktop_question_command_receipts')).rows[0].count, 0);
      await facade.query('BEGIN');
      const receipts = await applyRepairPlan((...args) => facade.query(...args), plan, actor);
      await facade.query('COMMIT');
      assert.equal(receipts.length, 2);
      const after = await facade.query('SELECT version,stem,options_json AS options,rich_content_json AS rich FROM business.question_contents ORDER BY question_id');
      assert(after.rows.every(row => row.version === 2 && row.stem === 'unaltered stem' && row.options.length === 0 && row.rich.sections.stem.content[0].attrs.id === originalId));
      assert.equal((await facade.query('SELECT count(*)::integer AS count FROM business.desktop_question_command_receipts')).rows[0].count, 2);
    });
    console.log('formula identity repair PostgreSQL checks passed: limited role, CAS rollback, exact metadata-only changes and receipts');
  } finally {
    await runtime.disposeHandle(handle).catch(() => {});
    await runtime.stop().catch(() => {});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
