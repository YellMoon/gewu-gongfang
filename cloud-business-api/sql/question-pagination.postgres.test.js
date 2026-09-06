'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createQuestionAuthorityService } = require('../src/questionAuthorityService');
const { createDisposablePg17Runtime, withVNextPg17SyntheticQuery } = require('../../shared/vnext-pg17/disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('../../shared/vnext-pg17/catalogAssertion');
const { createBusinessFoundationCatalogBoundary } = require('../../shared/vnext-pg17/businessFoundationCatalogAssertion');

const APPLY = { appliedAt: '2026-09-06T00:00:00.000Z', appliedBy: 'question-pagination-test' };

(async () => {
  const runtime = createDisposablePg17Runtime();
  await runtime.start();
  const handle = await runtime.createIsolatedHandle();
  try {
    await createVNextPg17CatalogBoundary(runtime).apply(handle, APPLY);
    await createBusinessFoundationCatalogBoundary(runtime).apply(handle, APPLY);
    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
      await facade.query('CREATE ROLE gewu_cloud_schedule_reader');
      for (const file of ['20260823-cloud-question-authority.sql', '20260823-cloud-question-command-receipts.sql', '20260824-question-taxonomy-authority.sql']) {
        let sql = fs.readFileSync(path.join(__dirname, file), 'utf8');
        if (file.startsWith('20260823-')) sql = sql.replace('BEGIN;', 'BEGIN; SET LOCAL ROLE vnext_pg17_business_owner;');
        await facade.query(sql);
      }
      await facade.query(`INSERT INTO business.tenants(id,name,legacy_deleted,created_at,updated_at)
        SELECT id,id,false,now(),now() FROM unnest(ARRAY['tenant-1','tenant-2']) AS id`);
      await facade.query(`INSERT INTO business.questions(id,tenant_id,subject,question_type,difficulty)
        SELECT 'question-' || lpad(i::text,4,'0'),'tenant-1','physics','single_choice',3 FROM generate_series(0,425) AS i`);
      await facade.query(`INSERT INTO business.questions(id,tenant_id,subject,question_type,difficulty,deleted,deleted_at) VALUES
        ('question-0200-deleted','tenant-1','physics','single_choice',3,true,now()),
        ('question-0200-content-deleted','tenant-1','physics','single_choice',3,false,NULL),
        ('question-0200-other-tenant','tenant-2','physics','single_choice',3,false,NULL)`);
      await facade.query(`INSERT INTO business.question_contents(question_id,tenant_id,stem,options_json,content_hash,deleted)
        SELECT id,tenant_id,'Question ' || id,'[]',repeat('a',64),id='question-0200-content-deleted' FROM business.questions`);

      const captured = [];
      const service = createQuestionAuthorityService({
        query: async (sql, params) => { captured.push({ sql, params }); return facade.query(sql, params); },
        transaction: async fn => fn(facade.query),
      });
      const input = { tenantId: 'tenant-1', actor: { accountId: 'test-teacher', roles: ['teacher'] }, limit: 200 };
      const first = await service.list(input);
      assert.equal(first.questions.length, 200);
      assert.equal(first.nextCursor, 'question-0199');
      // An unread edit must not move behind an updated_at cursor between requests.
      await facade.query("UPDATE business.questions SET updated_at='2020-01-01T00:00:00Z' WHERE id='question-0400'");
      const second = await service.list({ ...input, afterId: first.nextCursor });
      const third = await service.list({ ...input, afterId: second.nextCursor });
      assert.equal(second.questions.length, 200);
      assert.equal(third.questions.length, 26);
      assert.equal(third.nextCursor, null);
      const ids = [...first.questions, ...second.questions, ...third.questions].map(row => row.id);
      assert.deepEqual(ids, Array.from({ length: 426 }, (_, i) => `question-${String(i).padStart(4, '0')}`));
      assert.deepEqual(await service.list({ ...input, afterId: ids.at(-1) }), { questions: [], nextCursor: null });
      assert.equal((await service.list({ ...input, afterId: "x' OR true --" })).questions.length, 0, 'cursor must remain a bound parameter');
      await assert.rejects(service.list({ ...input, actor: { accountId: 'visitor', roles: [] } }), error => error.code === 'CLOUD_QUESTION_ACCESS_DENIED');

      // Existing tenant/id unique index uses C collation; no redundant new index is needed.
      const indexes = await facade.query("SELECT indexdef FROM pg_indexes WHERE schemaname='business' AND indexname='questions_tenant_id_id_unique'");
      assert.match(indexes.rows[0].indexdef, /\(tenant_id, id\)/u);
      await facade.query('SET enable_seqscan=off');
      const plan = await facade.query('EXPLAIN (FORMAT JSON) ' + captured[1].sql, captured[1].params);
      assert.match(JSON.stringify(plan.rows), /questions_tenant_id_id_unique/u);
      await facade.query('RESET enable_seqscan');
    });
    console.log('question pagination PostgreSQL checks passed: 426 rows, tenant/deletion scope, stable cursor, existing index');
  } finally {
    await runtime.disposeHandle(handle).catch(() => {});
    await runtime.stop().catch(() => {});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
