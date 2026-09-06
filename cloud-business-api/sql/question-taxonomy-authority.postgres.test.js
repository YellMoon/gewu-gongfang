'use strict';
require('./question-pagination.postgres.test');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createDisposablePg17Runtime, withVNextPg17SyntheticQuery } = require('../../shared/vnext-pg17/disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('../../shared/vnext-pg17/catalogAssertion');
const { createBusinessFoundationCatalogBoundary } = require('../../shared/vnext-pg17/businessFoundationCatalogAssertion');

const questionSql = fs.readFileSync(path.join(__dirname, '20260823-cloud-question-authority.sql'), 'utf8').replace('BEGIN;', 'BEGIN; SET LOCAL ROLE vnext_pg17_business_owner;');
const receiptSql = fs.readFileSync(path.join(__dirname, '20260823-cloud-question-command-receipts.sql'), 'utf8').replace('BEGIN;', 'BEGIN; SET LOCAL ROLE vnext_pg17_business_owner;');
const taxonomySql = fs.readFileSync(path.join(__dirname, '20260824-question-taxonomy-authority.sql'), 'utf8');
const versionFenceSql = fs.readFileSync(path.join(__dirname, '20260906-question-taxonomy-version-fence.sql'), 'utf8');
const APPLY = { appliedAt: '2026-08-24T00:00:00.000Z', appliedBy: 'question-taxonomy-test' };

(async () => {
  const runtime = createDisposablePg17Runtime(); await runtime.start(); const handle = await runtime.createIsolatedHandle();
  try {
    await createVNextPg17CatalogBoundary(runtime).apply(handle, APPLY);
    await createBusinessFoundationCatalogBoundary(runtime).apply(handle, APPLY);
    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
      await facade.query('CREATE ROLE gewu_cloud_schedule_reader');
      await facade.query(questionSql); await facade.query(receiptSql); await facade.query(taxonomySql);
      await facade.query(versionFenceSql);
      await facade.query("INSERT INTO business.tenants(id,name,legacy_deleted,created_at,updated_at) VALUES ('tenant-1','Tenant',false,transaction_timestamp(),transaction_timestamp())");
    });
    let systemVersion; let nodeVersion;
    await withVNextPg17SyntheticQuery(handle, 'writer', async facade => {
      const system = await facade.query("SELECT * FROM business.vnext_create_question_taxonomy_system_v1('tenant-1','system-1','physics','Knowledge',1)");
      assert.strictEqual(system.rows[0].outcome, 'committed'); systemVersion = system.rows[0].updated_at.toISOString();
      const stale = await facade.query("SELECT * FROM business.vnext_update_question_taxonomy_system_v1('tenant-1','system-1','2026-08-23T00:00:00Z','physics','Other',2)");
      assert.strictEqual(stale.rows[0].outcome, 'conflict');
      const node = await facade.query("SELECT * FROM business.vnext_create_question_taxonomy_node_v1('tenant-1','node-1','system-1',NULL,'Mechanics',1)");
      assert.strictEqual(node.rows[0].outcome, 'committed'); nodeVersion = node.rows[0].updated_at.toISOString();
    });
    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
      await facade.query("INSERT INTO business.questions(id,tenant_id,subject,question_type,difficulty,taxonomy_json) VALUES ('q-1','tenant-1','physics','single',3,'{\"knowledgePointIds\":[],\"modelPointIds\":[],\"taxonomyIds\":{\"system-1\":[\"node-1\"]}}')");
      await facade.query("INSERT INTO business.question_contents(question_id,tenant_id,stem,options_json,content_hash) VALUES ('q-1','tenant-1','Question','[]','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')");
    });
    await withVNextPg17SyntheticQuery(handle, 'writer', async facade => {
      const changed = await facade.query('SELECT * FROM business.vnext_delete_question_taxonomy_node_v1($1,$2,$3::timestamptz,$4,$5)', ['tenant-1','node-1',nodeVersion,'system-1',0]);
      assert.strictEqual(changed.rows[0].outcome, 'impact_changed'); assert.strictEqual(changed.rows[0].affected_question_count, 1);
      const removed = await facade.query('SELECT * FROM business.vnext_delete_question_taxonomy_node_v1($1,$2,$3::timestamptz,$4,$5)', ['tenant-1','node-1',nodeVersion,'system-1',1]);
      assert.strictEqual(removed.rows[0].outcome, 'committed');
    });
    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
      const afterNodeDelete = await facade.query("SELECT version FROM business.question_contents WHERE tenant_id='tenant-1' AND question_id='q-1'");
      assert.strictEqual(afterNodeDelete.rows[0].version, 2, 'taxonomy node deletion must advance the question CAS version');
    });
    await withVNextPg17SyntheticQuery(handle, 'writer', async facade => {
      const removedSystem = await facade.query('SELECT * FROM business.vnext_delete_question_taxonomy_system_v1($1,$2,$3::timestamptz,$4)', ['tenant-1','system-1',systemVersion,0]);
      assert.strictEqual(removedSystem.rows[0].outcome, 'committed');
    });
    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
      const row = (await facade.query("SELECT q.taxonomy_json,c.version,n.deleted AS node_deleted FROM business.questions q JOIN business.question_contents c ON c.tenant_id=q.tenant_id AND c.question_id=q.id CROSS JOIN business.question_taxonomy_nodes n WHERE q.id='q-1' AND n.id='node-1'")).rows[0];
      assert.strictEqual(row.taxonomy_json.taxonomyIds['system-1'], undefined); assert.strictEqual(row.version, 3, 'removing an empty taxonomy system key must also advance the question CAS version'); assert.strictEqual(row.node_deleted, true);
    });
    await withVNextPg17SyntheticQuery(handle, 'verifier', async facade => {
      await assert.rejects(() => facade.query("SELECT * FROM business.vnext_create_question_taxonomy_system_v1('tenant-1','system-2','physics','Other',1)"), error => error?.code === '42501');
    });
  } finally { await runtime.disposeHandle(handle).catch(() => {}); await runtime.stop().catch(() => {}); }
  console.log('question taxonomy authority PostgreSQL checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
