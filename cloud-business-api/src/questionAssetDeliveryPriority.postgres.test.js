'use strict';
const assert = require('node:assert/strict');
const { createDisposablePg17Runtime, withVNextPg17SyntheticQuery } = require('../../shared/vnext-pg17/disposableRuntime');
const { createQuestionAssetDeliveryRepository } = require('./questionAssetDeliveryRepository');

module.exports = (async () => {
  const runtime = createDisposablePg17Runtime();
  await runtime.start();
  const handle = await runtime.createIsolatedHandle();
  try {
    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async db => {
      await db.query(`CREATE SCHEMA business;
        CREATE TABLE business.question_asset_deliveries (
          delivery_id text PRIMARY KEY, asset_id text, object_id text, object_version int,
          expected_sha256 text, expected_bytes bigint, file_name text, mime_type text,
          status text, lease_agent_id text, lease_token_sha256 text, lease_expires_at timestamptz,
          attempts int DEFAULT 0, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), expires_at timestamptz);
        INSERT INTO business.question_asset_deliveries(delivery_id,asset_id,object_id,object_version,expected_sha256,expected_bytes,file_name,mime_type,status,created_at,expires_at)
        SELECT 'question_asset_delivery_export_'||n,'question_asset_test1234','obj_media',1,repeat('a',64),4,'image.png','image/png','queued',now()-interval '5 minutes',now()+interval '15 minutes' FROM generate_series(1,80) n;
        INSERT INTO business.question_asset_deliveries(delivery_id,asset_id,object_id,object_version,expected_sha256,expected_bytes,file_name,mime_type,status,created_at,expires_at)
        SELECT 'question_asset_delivery_viewer_'||n,'question_asset_test1234','obj_media',1,repeat('a',64),4,'image.png','image/png','queued',now()-n*interval '1 second',now()+interval '14 minutes' FROM generate_series(1,2) n;
        INSERT INTO business.question_asset_deliveries(delivery_id,status,created_at,expires_at) VALUES('question_asset_delivery_expired_1','queued',now()-interval '20 minutes',now()-interval '1 minute');`);
      const repository = createQuestionAssetDeliveryRepository({ query: (sql, values) => db.query(sql, values) });
      const first = await repository.lease({ agentId: 'storage-agent-1' });
      assert.equal(first.deliveryId, 'question_asset_delivery_viewer_2', 'expiring interactive images must not wait behind 80 actively renewed export images');
      const second = await repository.lease({ agentId: 'storage-agent-2' });
      assert.equal(second.deliveryId, 'question_asset_delivery_viewer_1', 'equal deadlines retain creation ordering and never steal a live lease');
      const third = await repository.lease({ agentId: 'storage-agent-3' });
      assert.equal(third.deliveryId, 'question_asset_delivery_export_1', 'exports continue after the urgent images, with deterministic ties');
      assert.equal((await db.query("SELECT count(*)::int AS n FROM business.question_asset_deliveries WHERE status='leased'")).rows[0].n, 3);
      assert.equal((await db.query("SELECT count(*)::int AS n FROM business.question_asset_deliveries WHERE delivery_id='question_asset_delivery_expired_1'")).rows[0].n, 0);
      await db.query("UPDATE business.question_asset_deliveries SET lease_expires_at=now()-interval '1 second' WHERE delivery_id=$1", [first.deliveryId]);
      const reclaimed = await repository.lease({ agentId: 'storage-agent-4' });
      assert.equal(reclaimed.deliveryId, first.deliveryId, 'an expired urgent lease can be reclaimed, not duplicated');
      assert.notEqual(reclaimed.leaseToken, first.leaseToken);
      console.log('question image deadline priority, FIFO ties, lease safety and expiry PostgreSQL checks passed');
    });
  } finally {
    await runtime.disposeHandle(handle);
    await runtime.stop();
  }
})();
if (require.main === module) module.exports.catch(error => { console.error(error); process.exitCode = 1; });
