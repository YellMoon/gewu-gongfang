'use strict';

const assert = require('assert');
const crypto = require('crypto');

const { createStorageTaskRepository } = require('./storageTaskRepository');

const HASH = 'a'.repeat(64);
const LEASE_TOKEN = 'lease-token-test-value';
const leaseHash = crypto.createHash('sha256').update(LEASE_TOKEN, 'utf8').digest('hex');
const RELAY_BYTES = Buffer.from('relay');
const RELAY_ENVELOPE = {
  version: 'x25519-aes-256-gcm-v1', ephemeralPublicKey: Buffer.alloc(44, 1).toString('base64url'),
  keyDerivationSalt: Buffer.alloc(16, 2).toString('base64url'), wrappedKeyNonce: Buffer.alloc(12, 3).toString('base64url'),
  wrappedKeyCiphertext: Buffer.alloc(32, 4).toString('base64url'), wrappedKeyTag: Buffer.alloc(16, 5).toString('base64url'),
  contentNonce: Buffer.alloc(12, 6).toString('base64url'), contentTag: Buffer.alloc(16, 7).toString('base64url'),
  ciphertextSha256: crypto.createHash('sha256').update(RELAY_BYTES).digest('hex'), ciphertextBytes: RELAY_BYTES.length,
  plaintextSha256: 'b'.repeat(64), plaintextBytes: 3,
};

async function main() {
  const calls = [];
  const repository = createStorageTaskRepository({
    query: async (text, values) => {
      calls.push({ text, values });
      if (text.includes('deleted_expired')) return { rows: [{ count: 1 }] };
      if (text.includes('relay.envelope_json')) return { rows: [{ envelope: RELAY_ENVELOPE, ciphertext: RELAY_BYTES }] };
      if (text.includes('storage_task_receipts')) {
        if (values.includes('b'.repeat(64))) return { rows: [] };
        return { rows: [{ taskId: 'task_12345678', state: 'verified', verifiedAt: new Date('2026-08-22T00:00:00.000Z') }] };
      }
      return {
        rows: [{
          taskId: 'task_12345678', objectId: 'obj_1', objectVersion: 1, expectedSha256: HASH,
          expectedBytes: 3, mediaType: 'image/png', kind: 'relay', leaseExpiresAt: new Date('2026-08-22T00:05:00.000Z'),
        }],
      };
    },
    randomToken: () => LEASE_TOKEN,
    now: () => new Date('2026-08-22T00:00:00.000Z'),
  });

  const leased = await repository.leaseNext({ agentId: 'storage-agent-1' });
  assert.deepStrictEqual(leased, {
    taskId: 'task_12345678', objectId: 'obj_1', objectVersion: 1, expectedSha256: HASH,
    expectedBytes: 3, mediaType: 'image/png', kind: 'relay', leaseToken: LEASE_TOKEN,
    leaseExpiresAt: '2026-08-22T00:05:00.000Z',
  });
  assert.ok(calls[0].text.includes('deleted_expired') && calls[0].text.includes("state='quarantined'"), 'each lease clears expired relay bytes first');
  assert.ok(calls[0].text.includes('encrypted_import_source_relays'), 'expired import source relay bytes must also be deleted and quarantined');
  assert.ok(calls[1].text.includes('FOR UPDATE OF task SKIP LOCKED'), 'leasing must be concurrency-safe while locking only task rows');
  assert.ok(calls[1].text.includes('encrypted_storage_relays question_relay') && calls[1].text.includes('encrypted_paper_export_artifact_relays artifact_relay'), 'only tasks with an active encrypted relay may be leased');
  assert.ok(calls[1].text.includes('encrypted_import_source_relays import_relay'), 'import source tasks require a live encrypted relay before leasing');
  assert.ok(calls[1].text.includes('question_import_media_objects import_media') && calls[1].text.includes("'question_import_media'"),
    'a derived media task must lease only after the source object is verified and must identify itself to the agent');
  assert.match(calls[1].text, /ORDER BY CASE WHEN import_source\.import_task_id IS NOT NULL THEN 0 WHEN import_media\.media_id IS NOT NULL THEN 1 ELSE 2 END,\s*CASE WHEN import_media\.media_id IS NOT NULL THEN media_import_task\.updated_at ELSE NULL END DESC NULLS LAST,\s*task\.created_at ASC,task\.task_id ASC/,
    'new encrypted import sources and their newest derived media must not be starved by a large older import');
  assert.ok(calls[1].text.includes('media_source.storage_state=\'verified\''),
    'derived media must be reconstructed only from an immutable, verified NAS source object');
  assert.ok(calls[1].text.includes('question_relay.expires_at > transaction_timestamp()') && calls[1].text.includes('artifact_relay.expires_at > transaction_timestamp()'), 'leasing must exclude expired relay ciphertext');
  assert.ok(calls[1].values.includes(leaseHash), 'only a SHA-256 lease hash may be stored');
  assert.ok(!calls[1].values.includes(LEASE_TOKEN), 'the raw lease token must never be sent to PostgreSQL');

  const expired = await repository.cleanupExpired();
  assert.strictEqual(expired, 1);
  assert.ok(calls[2].text.includes('deleted_expired') && calls[2].text.includes("state='quarantined'"));

  const downloaded = await repository.downloadRelay({ agentId: 'storage-agent-1', taskId: 'task_12345678', leaseToken: LEASE_TOKEN });
  assert.deepStrictEqual(downloaded, { envelope: RELAY_ENVELOPE, ciphertext: RELAY_BYTES });
  assert.ok(calls[3].text.includes('business.encrypted_storage_relays'));
  assert.ok(calls[3].text.includes('business.encrypted_paper_export_artifact_relays'));
  assert.ok(calls[3].text.includes('business.encrypted_import_source_relays'));
  assert.ok(calls[3].values.includes(leaseHash));
  assert.ok(!calls[3].values.includes(LEASE_TOKEN));

  const completed = await repository.complete({
    agentId: 'storage-agent-1', taskId: 'task_12345678', leaseToken: LEASE_TOKEN,
    observedSha256: HASH, observedBytes: 3,
  });
  assert.deepStrictEqual(completed, { taskId: 'task_12345678', state: 'verified', verifiedAt: '2026-08-22T00:00:00.000Z' });
  assert.ok(calls[4].text.includes('storage_task_receipts'), 'completion must create an immutable cloud receipt');
  assert.ok(calls[4].text.includes('DELETE FROM business.encrypted_storage_relays'), 'completion must erase relay bytes before returning a verified receipt');
  assert.ok(calls[4].text.includes('DELETE FROM business.encrypted_import_source_relays'), 'completion must erase import source ciphertext after its NAS receipt');
  assert.ok(calls[4].text.includes('paper_export_artifacts') && calls[4].text.includes('encrypted_paper_export_artifact_relays'), 'completion must verify the artifact record and erase its relay bytes');
  assert.ok(calls[4].text.includes('business.import_source_objects') && calls[4].text.includes('question_import_tasks'),
    'a verified source receipt must advance only its cloud-owned import task to parsing readiness');
  assert.ok(calls[4].text.includes('business.question_import_media_objects'),
    'a verified media receipt must mark only its corresponding import media object as NAS-verified');
  assert.ok(calls[4].text.includes('UPDATE business.question_assets') && calls[4].text.includes("SET state='verified'"),
    'a verified NAS receipt must advance the matching question asset from queued to verified');
  assert.ok(calls[4].values.includes(leaseHash), 'completion must compare only the lease hash');
  assert.ok(!calls[4].values.includes(LEASE_TOKEN), 'completion must not persist the raw lease token');

  await assert.rejects(
    () => repository.complete({ agentId: 'storage-agent-1', taskId: 'task_12345678', leaseToken: LEASE_TOKEN, observedSha256: 'b'.repeat(64), observedBytes: 3 }),
    /STORAGE_TASK_RECEIPT_MISMATCH/,
    'the repository must reject an agent receipt that disagrees with the immutable object hash'
  );
}

main().then(() => console.log('storage task repository checks passed')).catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
