'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createDisposablePg17Runtime, withVNextPg17SyntheticQuery } = require('../../shared/vnext-pg17/disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('../../shared/vnext-pg17/catalogAssertion');
const { createBusinessFoundationCatalogBoundary } = require('../../shared/vnext-pg17/businessFoundationCatalogAssertion');
const { createQuestionAuthorityService } = require('../src/questionAuthorityService');
const { stableJson } = require('../../shared/authorityProtocol');

function ownedSql(name) {
  return fs.readFileSync(path.join(__dirname, name), 'utf8')
    .replace('BEGIN;', 'BEGIN; SET LOCAL ROLE vnext_pg17_business_owner;');
}

const APPLY = Object.freeze({ appliedAt: '2026-08-27T00:00:00.000Z', appliedBy: 'question-import-media-binding-test' });
const HASH = 'a'.repeat(64);

function commandFor({ id, taskId, itemId, itemIndex, contentHash }) {
  const payload = {
    record: {
      id, subject: 'physics', type: 'single_choice', difficulty: 3,
      content: 'A question with a NAS image', options: [], answer: 'A', analysis: '',
      knowledge_point_ids: [], model_point_ids: [], taxonomy_ids: [], has_formula: false,
      import_task_id: taskId, import_item_id: itemId, import_item_index: itemIndex, import_content_hash: contentHash,
    },
  };
  return {
    commandId: `question-import-command-${id}`,
    type: 'question.create.v1', payload,
    payloadHash: crypto.createHash('sha256').update(stableJson({ type: 'question.create.v1', payload }), 'utf8').digest('hex'),
  };
}

(async () => {
  const runtime = createDisposablePg17Runtime();
  await runtime.start();
  const handle = await runtime.createIsolatedHandle();
  try {
    await createVNextPg17CatalogBoundary(runtime).apply(handle, APPLY);
    await createBusinessFoundationCatalogBoundary(runtime).apply(handle, APPLY);
    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
      await facade.query('CREATE ROLE gewu_cloud_schedule_reader');
      for (const name of [
        '20260822-storage-agent-tasks.sql',
        '20260823-cloud-question-import-tasks.sql',
        '20260823-cloud-question-authority.sql',
        '20260823-question-import-media-objects.sql',
        '20260823-cloud-question-command-receipts.sql',
      ]) await facade.query(ownedSql(name));
      await facade.query("INSERT INTO business.tenants(id,name,legacy_deleted,created_at,updated_at) VALUES ('tenant-1','Tenant one',false,transaction_timestamp(),transaction_timestamp()),('tenant-2','Tenant two',false,transaction_timestamp(),transaction_timestamp())");
      await facade.query(
        `INSERT INTO business.question_import_tasks
          (task_id,tenant_id,account_id,idempotency_key,source_type,source_file_name,source_mime_type,source_sha256,source_size_bytes,metadata_json,request_hash,status,phase)
         VALUES ($1,'tenant-1','teacher-1','import-key-1','exam','source.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document',$2,10,'{}',$2,'drafts_prepared','drafts_prepared')`,
        ['question_import_task_demo', HASH],
      );
      await facade.query(
        `INSERT INTO business.question_import_items
          (item_id,import_task_id,item_index,content_hash,candidate_json,validation_json,media_manifest_json,status)
         VALUES ($1,$2,0,$3,$4::jsonb,'{}','[]','draft_prepared')`,
        ['question_import_item_demo_0', 'question_import_task_demo', HASH, JSON.stringify({
          assets: [{ assetIndex: 0, assetType: 'image', fileName: 'diagram.png', mimeType: 'image/png', sizeBytes: 3, contentHash: HASH }],
        })],
      );
      await facade.query(
        "INSERT INTO business.storage_object_tasks(task_id,object_id,object_version,expected_sha256,expected_bytes,media_type,state) VALUES ('task_import_media_demo_0','obj_import_media_demo_0',1,$1,3,'image/png','verified')",
        [HASH],
      );
      await facade.query(
        "INSERT INTO business.question_import_media_objects(media_id,import_task_id,item_index,asset_index,object_id,object_version,storage_task_id,expected_sha256,expected_bytes,mime_type,storage_state,verified_at) VALUES ('question_import_media_demo_0','question_import_task_demo',0,0,'obj_import_media_demo_0',1,'task_import_media_demo_0',$1,3,'image/png','verified',transaction_timestamp())",
        [HASH],
      );
      await facade.query(
        "INSERT INTO business.storage_task_receipts(receipt_id,task_id,agent_id,observed_sha256,observed_bytes) VALUES ('storage_receipt_demo_media_1','task_import_media_demo_0','agent-1',$1,3)",
        [HASH],
      );
    });

    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
      const query = (text, values) => facade.query(text, values);
      const service = createQuestionAuthorityService({
        query,
        transaction: async work => {
          await facade.query('BEGIN');
          try { const value = await work(query); await facade.query('COMMIT'); return value; }
          catch (error) { await facade.query('ROLLBACK'); throw error; }
        },
      });
      const accepted = await service.submitDesktopDraft({
        tenantId: 'tenant-1', actor: { accountId: 'teacher-1', roles: ['teacher'] },
        command: commandFor({ id: 'question-bound-1', taskId: 'question_import_task_demo', itemId: 'question_import_item_demo_0', itemIndex: 0, contentHash: HASH }),
      });
      assert.strictEqual(accepted.status, 'committed');
      const asset = await facade.query('SELECT question_id,storage_object_id,storage_object_version,content_hash,state FROM business.question_assets WHERE question_id=$1', ['question-bound-1']);
      assert.deepStrictEqual(asset.rows.map(row => ({
        questionId: row.question_id, objectId: row.storage_object_id, objectVersion: row.storage_object_version, contentHash: row.content_hash, state: row.state,
      })), [{ questionId: 'question-bound-1', objectId: 'obj_import_media_demo_0', objectVersion: 1, contentHash: HASH, state: 'verified' }]);
      assert.deepStrictEqual((await facade.query("SELECT status FROM business.question_import_items WHERE item_id='question_import_item_demo_0'")).rows.map(row => row.status), ['submitted']);
      assert.deepStrictEqual((await facade.query("SELECT status,phase FROM business.question_import_tasks WHERE task_id='question_import_task_demo'")).rows.map(row => ({ status: row.status, phase: row.phase })), [{ status: 'submitted', phase: 'submitted' }]);

      await assert.rejects(
        () => service.submitDesktopDraft({
          tenantId: 'tenant-2', actor: { accountId: 'teacher-1', roles: ['teacher'] },
          command: commandFor({ id: 'question-cross-tenant', taskId: 'question_import_task_demo', itemId: 'question_import_item_demo_0', itemIndex: 0, contentHash: HASH }),
        }),
        error => error?.code === 'CLOUD_QUESTION_UNAVAILABLE',
      );
      assert.deepStrictEqual((await facade.query("SELECT id FROM business.questions WHERE id='question-cross-tenant'")).rows, []);
      await assert.rejects(
        () => service.submitDesktopDraft({
          tenantId: 'tenant-1', actor: { accountId: 'teacher-1', roles: ['teacher'] },
          command: commandFor({ id: 'question-hash-mismatch', taskId: 'question_import_task_demo', itemId: 'question_import_item_demo_0', itemIndex: 0, contentHash: 'b'.repeat(64) }),
        }),
        error => error?.code === 'CLOUD_QUESTION_UNAVAILABLE',
      );
      assert.deepStrictEqual((await facade.query("SELECT id FROM business.questions WHERE id='question-hash-mismatch'")).rows, []);
    });
  } finally {
    await runtime.disposeHandle(handle).catch(() => {});
    await runtime.stop().catch(() => {});
  }
  console.log('question import media binding PostgreSQL checks passed');
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
