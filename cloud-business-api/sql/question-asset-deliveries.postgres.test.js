'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createDisposablePg17Runtime, withVNextPg17SyntheticQuery } = require('../../shared/vnext-pg17/disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('../../shared/vnext-pg17/catalogAssertion');
const { createBusinessFoundationCatalogBoundary } = require('../../shared/vnext-pg17/businessFoundationCatalogAssertion');
const { createQuestionAssetDeliveryRepository } = require('../src/questionAssetDeliveryRepository');

function ownedSql(name) {
  return fs.readFileSync(path.join(__dirname, name), 'utf8').replace('BEGIN;', 'BEGIN; SET LOCAL ROLE vnext_pg17_business_owner;');
}

const HASH = crypto.createHash('sha256').update('image-bytes').digest('hex');
const APPLY = Object.freeze({ appliedAt: '2026-08-27T00:00:00.000Z', appliedBy: 'question-asset-delivery-test' });

(async () => {
  const runtime = createDisposablePg17Runtime();
  await runtime.start();
  const handle = await runtime.createIsolatedHandle();
  try {
    await createVNextPg17CatalogBoundary(runtime).apply(handle, APPLY);
    await createBusinessFoundationCatalogBoundary(runtime).apply(handle, APPLY);
    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
      await facade.query('CREATE ROLE gewu_cloud_schedule_reader');
      for (const name of ['20260823-cloud-question-authority.sql', '20260827-question-asset-deliveries.sql']) await facade.query(ownedSql(name));
      await facade.query("INSERT INTO business.tenants(id,name,legacy_deleted,created_at,updated_at) VALUES ('tenant-1','Tenant',false,transaction_timestamp(),transaction_timestamp())");
      await facade.query("INSERT INTO business.questions(id,tenant_id,subject,question_type,difficulty,status,taxonomy_json,has_formula) VALUES ('question-asset-demo','tenant-1','physics','single_choice',3,'published','{}',false)");
      await facade.query("INSERT INTO business.question_contents(question_id,tenant_id,stem,content_hash) VALUES ('question-asset-demo','tenant-1','Image question',$1)", [HASH]);
      await facade.query("INSERT INTO business.question_assets(id,tenant_id,question_id,asset_type,file_name,mime_type,size_bytes,storage_object_id,storage_object_version,content_hash,state) VALUES ('question_asset_import_question_asset_demo_0','tenant-1','question-asset-demo','image','diagram.png','image/png',11,'obj_import_media_demo_0',1,$1,'verified')", [HASH]);
      const repository = createQuestionAssetDeliveryRepository({
        query: (text, values) => facade.query(text, values), randomId: () => crypto.randomUUID(), randomToken: () => 'lease-token-with-sufficient-length',
        // PostgreSQL evaluates created_at with its actual transaction clock.  A fixed
        // historical test clock eventually makes the delivery expiration precede it.
        now: () => new Date(),
      });
      const requested = await repository.request({ tenantId: 'tenant-1', accountId: 'student-1', questionId: 'question-asset-demo', assetKey: HASH });
      assert.strictEqual(requested.status, 'queued');
      const leased = await repository.lease({ agentId: 'storage-agent-1' });
      assert.strictEqual(leased.objectId, 'obj_import_media_demo_0');
      const bytes = Buffer.from('image-bytes');
      const uploaded = await repository.upload({ agentId: 'storage-agent-1', deliveryId: leased.deliveryId, leaseToken: leased.leaseToken, bytes });
      assert.strictEqual(uploaded.status, 'ready');
      const downloaded = await repository.download({ tenantId: 'tenant-1', accountId: 'student-1', deliveryId: leased.deliveryId });
      assert.deepStrictEqual(downloaded.bytes, bytes);
      const own = { tenantId: 'tenant-1', accountId: 'student-1', deliveryId: leased.deliveryId };
      assert.strictEqual((await repository.status(own, { publishedLimit: null })).status, 'ready');
      await facade.query("UPDATE business.questions SET status='draft' WHERE id='question-asset-demo'");
      assert.strictEqual((await repository.request({ tenantId: 'tenant-1', accountId: 'teacher-2', assetKey: HASH }, { includeDrafts: true })).status, 'queued');
      const draft = await repository.request({ tenantId: 'tenant-1', accountId: 'student-1', assetKey: HASH }, { includeDrafts: true });
      assert.strictEqual(draft.deliveryId, leased.deliveryId, 'authorized desktop reuses its own ready draft delivery');
      await assert.rejects(repository.request({ tenantId: 'tenant-1', accountId: 'student-1', assetKey: HASH }), /NOT_FOUND/, 'public request cannot reuse an old draft delivery');
      await assert.rejects(repository.status(own, { publishedLimit: null }), /NOT_FOUND/);
      await assert.rejects(repository.download(own, { publishedLimit: null }), /NOT_READY/);
      await facade.query("UPDATE business.questions SET status='published' WHERE id='question-asset-demo'");
      await facade.query("UPDATE business.question_contents SET updated_at=transaction_timestamp()-interval '1 day' WHERE question_id='question-asset-demo'");
      await facade.query("INSERT INTO business.questions(id,tenant_id,subject,question_type,difficulty,status) SELECT 'new-question-'||n,'tenant-1','physics','single_choice',3,'published' FROM generate_series(1,20) n");
      await facade.query("INSERT INTO business.question_contents(question_id,tenant_id,stem,content_hash) SELECT 'new-question-'||n,'tenant-1','New question',$1 FROM generate_series(1,20) n", [HASH]);
      await assert.rejects(repository.status(own, { publishedLimit: 20 }), /NOT_FOUND/, 'visitor cannot reuse the twenty-first question delivery');
      await assert.rejects(repository.download(own, { publishedLimit: 20 }), /NOT_READY/);
      assert.strictEqual((await repository.status(own, { publishedLimit: null })).status, 'ready');
      await assert.rejects(() => repository.download({ tenantId: 'tenant-1', accountId: 'other-account', deliveryId: leased.deliveryId }), error => error?.code === 'QUESTION_ASSET_DELIVERY_NOT_READY');
      await facade.query("UPDATE business.questions SET status='archived' WHERE id='question-asset-demo'");
      await assert.rejects(() => repository.request({ tenantId: 'tenant-1', accountId: 'student-2', questionId: 'question-asset-demo', assetKey: HASH }), error => error?.code === 'QUESTION_ASSET_DELIVERY_NOT_FOUND');
    });
  } finally {
    await runtime.disposeHandle(handle).catch(() => {});
    await runtime.stop().catch(() => {});
  }
  console.log('question asset delivery PostgreSQL checks passed');
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
