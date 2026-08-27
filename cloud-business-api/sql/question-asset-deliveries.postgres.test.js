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
      await facade.query("INSERT INTO business.question_assets(id,tenant_id,question_id,asset_type,file_name,mime_type,size_bytes,storage_object_id,storage_object_version,content_hash,state) VALUES ('question_asset_import_question_asset_demo_0','tenant-1','question-asset-demo','image','diagram.png','image/png',11,'obj_import_media_demo_0',1,$1,'verified')", [HASH]);
      const repository = createQuestionAssetDeliveryRepository({
        query: (text, values) => facade.query(text, values), randomId: () => '12345678', randomToken: () => 'lease-token-with-sufficient-length',
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
