'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createDisposablePg17Runtime, withVNextPg17SyntheticQuery } = require('../shared/vnext-pg17/disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('../shared/vnext-pg17/catalogAssertion');
const { createBusinessFoundationCatalogBoundary } = require('../shared/vnext-pg17/businessFoundationCatalogAssertion');
const { createQuestionAuthorityService } = require('../cloud-business-api/src/questionAuthorityService');
const { BAD_QUESTION_IDS, buildDeleteCommand, withRepairTransaction } = require('./repair-production-question-duplicates');

(async () => {
  const runtime = createDisposablePg17Runtime();
  await runtime.start();
  const handle = await runtime.createIsolatedHandle();
  const apply = { appliedAt: '2026-09-06T00:00:00.000Z', appliedBy: 'repair-atomicity-test' };
  try {
    await createVNextPg17CatalogBoundary(runtime).apply(handle, apply);
    await createBusinessFoundationCatalogBoundary(runtime).apply(handle, apply);
    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
      await facade.query('CREATE ROLE gewu_cloud_schedule_reader');
      for (const name of ['20260823-cloud-question-authority.sql', '20260823-cloud-question-command-receipts.sql', '20260824-question-taxonomy-authority.sql']) {
        const sql = fs.readFileSync(path.join(__dirname, '../cloud-business-api/sql', name), 'utf8');
        await facade.query(sql.replace('BEGIN;', 'BEGIN; SET LOCAL ROLE vnext_pg17_business_owner;'));
      }
      await facade.query("INSERT INTO business.tenants(id,name,legacy_deleted,created_at,updated_at) VALUES ('tenant-1','Test',false,transaction_timestamp(),transaction_timestamp())");
      for (const id of BAD_QUESTION_IDS.slice(0, 2)) {
        await facade.query("INSERT INTO business.questions(id,tenant_id,subject,question_type,difficulty) VALUES ($1,'tenant-1','physics','single',3)", [id]);
        await facade.query("INSERT INTO business.question_contents(question_id,tenant_id,stem,options_json,content_hash,version) VALUES ($1,'tenant-1','Question','[]',$2,2)", [id, 'a'.repeat(64)]);
      }
      let released = 0;
      const pool = { connect: async () => ({ query: (...args) => facade.query(...args), release: () => { released += 1; } }) };
      const submitBatch = versions => withRepairTransaction(pool, async query => {
        const service = createQuestionAuthorityService({ query, transaction: work => work(query) });
        for (let index = 0; index < versions.length; index += 1) {
          const receipt = await service.submitDesktopDraft({
            tenantId: 'tenant-1', actor: { accountId: 'admin-test', roles: ['super_admin'] },
            command: buildDeleteCommand(BAD_QUESTION_IDS[index], versions[index]),
          });
          if (receipt.status !== 'committed') throw new Error('BATCH_CONFLICT');
        }
      });
      await assert.rejects(submitBatch([2, 1]), /BATCH_CONFLICT/);
      assert.strictEqual(released, 1);
      const failed = (await facade.query('SELECT count(*)::int AS count FROM business.desktop_question_command_receipts')).rows[0];
      assert.strictEqual(failed.count, 0, 'a rejected second command must roll back the first receipt and rejection receipt');
      const unchanged = await facade.query('SELECT version,deleted FROM business.question_contents ORDER BY question_id');
      assert.deepStrictEqual(unchanged.rows, [{ version: 2, deleted: false }, { version: 2, deleted: false }]);
      await submitBatch([2, 2]);
      assert.strictEqual(released, 2);
      const committed = (await facade.query('SELECT count(*)::int AS count FROM business.desktop_question_command_receipts')).rows[0];
      assert.strictEqual(committed.count, 2, 'the same command IDs remain retryable after rollback');
      const deleted = await facade.query('SELECT version,deleted FROM business.question_contents ORDER BY question_id');
      assert.deepStrictEqual(deleted.rows, [{ version: 3, deleted: true }, { version: 3, deleted: true }]);
    });
  } finally {
    await runtime.disposeHandle(handle).catch(() => {});
    await runtime.stop().catch(() => {});
  }
  console.log('production question repair PostgreSQL rollback and retry checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
