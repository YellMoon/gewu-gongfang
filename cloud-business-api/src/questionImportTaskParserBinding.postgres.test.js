'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createDisposablePg17Runtime, withVNextPg17SyntheticQuery } = require('../../shared/vnext-pg17/disposableRuntime');
const { createQuestionImportTaskRepository } = require('./questionImportTaskRepository');

const migration = fs.readFileSync(path.join(__dirname, '..', 'sql', '20260905-zz-question-import-parser-proof-binding.sql'), 'utf8');

function importRequest(suffix) {
  const ciphertext = Buffer.from(`encrypted-${suffix}`);
  return {
    sourceType: 'exam', sourceFileName: `${suffix}.docx`,
    sourceMimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    sourceSha256: crypto.createHash('sha256').update(`source-${suffix}`).digest('hex'), sourceBytes: 100,
    metadata: { parserSha256: 'client-forged-value', marker: suffix },
    storage: { taskId: `task_${suffix}12345678`, objectId: `obj_${suffix}`, objectVersion: 1 },
    relay: {
      agentKeyFingerprint: 'a'.repeat(64),
      envelope: {
        version: 'x25519-aes-256-gcm-v1', ephemeralPublicKey: Buffer.alloc(44, 1).toString('base64url'),
        keyDerivationSalt: Buffer.alloc(16, 2).toString('base64url'), wrappedKeyNonce: Buffer.alloc(12, 3).toString('base64url'),
        wrappedKeyCiphertext: Buffer.alloc(32, 4).toString('base64url'), wrappedKeyTag: Buffer.alloc(16, 5).toString('base64url'),
        contentNonce: Buffer.alloc(12, 6).toString('base64url'), contentTag: Buffer.alloc(16, 7).toString('base64url'),
        ciphertextSha256: crypto.createHash('sha256').update(ciphertext).digest('hex'), ciphertextBytes: ciphertext.length,
        plaintextSha256: crypto.createHash('sha256').update(`source-${suffix}`).digest('hex'), plaintextBytes: 100,
      },
      ciphertext, expiresAt: '2026-09-05T00:05:00.000Z',
    },
  };
}

async function importTableCounts(facade) {
  return (await facade.query(`SELECT
    (SELECT count(*)::integer FROM business.question_import_tasks) AS tasks,
    (SELECT count(*)::integer FROM business.storage_object_tasks) AS storage,
    (SELECT count(*)::integer FROM business.import_source_objects) AS sources,
    (SELECT count(*)::integer FROM business.encrypted_import_source_relays) AS relays,
    (SELECT count(*)::integer FROM business.storage_task_receipts) AS receipts,
    (SELECT count(*)::integer FROM business.question_import_items) AS items,
    (SELECT count(*)::integer FROM business.question_import_media_objects) AS media`)).rows[0];
}

(async () => {
  const runtime = createDisposablePg17Runtime();
  await runtime.start();
  const handle = await runtime.createIsolatedHandle();
  try {
    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
      await facade.query(`
        CREATE SCHEMA business;
        CREATE ROLE gewu_cloud_schedule_reader;
        CREATE TABLE business.storage_agent_runtime_receipts (
          receipt_id text COLLATE "C" PRIMARY KEY, agent_id text COLLATE "C" NOT NULL,
          agent_version text NOT NULL, contracts jsonb NOT NULL, parser_sha256 text COLLATE "C", observed_at timestamptz NOT NULL DEFAULT transaction_timestamp()
        );
        CREATE TABLE business.question_import_tasks (
          task_id text COLLATE "C" PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, idempotency_key text NOT NULL,
          source_type text NOT NULL, source_file_name text NOT NULL, source_mime_type text NOT NULL, source_sha256 text NOT NULL,
          source_size_bytes bigint NOT NULL, metadata_json jsonb NOT NULL, request_hash text NOT NULL, status text NOT NULL, phase text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT transaction_timestamp(), updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
          UNIQUE(tenant_id,account_id,idempotency_key)
        );
        CREATE TABLE business.storage_object_tasks (
          task_id text PRIMARY KEY, object_id text NOT NULL, object_version integer NOT NULL, expected_sha256 text NOT NULL,
          expected_bytes bigint NOT NULL, media_type text NOT NULL, state text NOT NULL,
          lease_agent_id text, lease_token_sha256 text, lease_expires_at timestamptz,
          updated_at timestamptz NOT NULL DEFAULT transaction_timestamp()
        );
        CREATE TABLE business.import_source_objects (
          import_task_id text PRIMARY KEY, tenant_id text NOT NULL, object_id text NOT NULL, object_version integer NOT NULL,
          storage_task_id text NOT NULL, expected_sha256 text NOT NULL, expected_bytes bigint NOT NULL, mime_type text NOT NULL,
          storage_state text NOT NULL, verified_at timestamptz,
          updated_at timestamptz NOT NULL DEFAULT transaction_timestamp()
        );
        CREATE TABLE business.encrypted_import_source_relays (
          storage_task_id text PRIMARY KEY, import_task_id text NOT NULL, tenant_id text NOT NULL, actor_account_id text NOT NULL,
          agent_key_fingerprint text NOT NULL, envelope_json jsonb NOT NULL, ciphertext bytea NOT NULL, ciphertext_sha256 text NOT NULL,
          expires_at timestamptz NOT NULL
        );
        CREATE TABLE business.storage_task_receipts (
          receipt_id text PRIMARY KEY, task_id text NOT NULL, agent_id text NOT NULL,
          observed_sha256 text NOT NULL, observed_bytes bigint NOT NULL
        );
        CREATE TABLE business.question_import_items (
          item_id text PRIMARY KEY, import_task_id text NOT NULL, item_index integer NOT NULL, content_hash text NOT NULL,
          candidate_json jsonb NOT NULL, validation_json jsonb NOT NULL, media_manifest_json jsonb NOT NULL, status text NOT NULL
        );
        CREATE TABLE business.question_import_media_objects (
          media_id text PRIMARY KEY, import_task_id text NOT NULL, item_index integer NOT NULL, asset_index integer NOT NULL,
          object_id text NOT NULL, object_version integer NOT NULL, storage_task_id text NOT NULL,
          expected_sha256 text NOT NULL, expected_bytes bigint NOT NULL, mime_type text NOT NULL, storage_state text NOT NULL
        );
      `);
      await facade.query(migration);
      const parserSha256 = '9'.repeat(64);
      await facade.query(`INSERT INTO business.storage_agent_runtime_receipts(receipt_id,agent_id,agent_version,contracts,parser_sha256)
        VALUES ('storage_runtime_receipt_fresh001','storage-agent-1','8.8.2',
          '{"questionPaperExport":3,"storageAgentTransport":3,"questionImportParserProof":1}'::jsonb,$1)`, [parserSha256]);
      let randomSequence = 0;
      const repository = createQuestionImportTaskRepository({
        query: (text, values) => facade.query(text, values), storageAgentId: 'storage-agent-1', runtimeReceiptMaxAgeSeconds: 900,
        randomId: () => `postgres-binding-${++randomSequence}`, now: () => new Date('2026-09-05T00:00:00.000Z'),
      });
      const freshRequest = importRequest('fresh');
      const created = await repository.create({
        tenantId: 'default', actor: { accountId: 'teacher-1', roles: ['teacher'] }, idempotencyKey: 'binding-1', request: freshRequest,
      });
      assert.strictEqual(created.status, 'awaiting_source_storage');
      assert.deepStrictEqual((await facade.query(`SELECT parser_contract_version AS "version",parser_sha256 AS "parserSha256",
        parser_runtime_receipt_id AS "receiptId",metadata_json->>'parserSha256' AS "untrustedMetadata"
        FROM business.question_import_tasks WHERE task_id=$1`, [created.taskId])).rows, [{
          version: 1, parserSha256, receiptId: 'storage_runtime_receipt_fresh001', untrustedMetadata: 'client-forged-value',
        }], 'the trusted proof must come from the fresh runtime receipt, never similarly named client metadata');

      const validLeaseToken = 'valid-source-lease-token-1234';
      const validLeaseHash = crypto.createHash('sha256').update(validLeaseToken, 'utf8').digest('hex');
      await facade.query(`UPDATE business.storage_object_tasks SET state='leased',lease_agent_id='storage-agent-1',
        lease_token_sha256=$2,lease_expires_at=transaction_timestamp()+interval '10 minutes' WHERE task_id=$1`,
      [freshRequest.storage.taskId, validLeaseHash]);
      const mediaCandidate = [{
        contentHash: '7'.repeat(64), candidate: { stem: 'proof-gated media' }, validation: { status: 'accepted' },
        mediaManifest: [{ sha256: '6'.repeat(64), bytes: 3, mimeType: 'image/png' }],
      }];
      const parserMismatchBefore = await importTableCounts(facade);
      await assert.rejects(() => repository.completeSourceAndStoreCandidates({
        taskId: created.taskId, agentId: 'storage-agent-1', leaseToken: validLeaseToken,
        observedSha256: freshRequest.sourceSha256, observedBytes: freshRequest.sourceBytes,
        parserSha256: '8'.repeat(64), candidates: mediaCandidate,
      }), error => error?.code === 'CLOUD_QUESTION_IMPORT_SOURCE_UNVERIFIED');
      assert.deepStrictEqual(await importTableCounts(facade), parserMismatchBefore,
        'a parser-proof mismatch must leave task/storage/source/relay/receipt/item/media row counts strictly unchanged');

      const invalidLeaseBefore = await importTableCounts(facade);
      await assert.rejects(() => repository.completeSourceAndStoreCandidates({
        taskId: created.taskId, agentId: 'storage-agent-1', leaseToken: 'invalid-source-lease-token-1234',
        observedSha256: freshRequest.sourceSha256, observedBytes: freshRequest.sourceBytes,
        parserSha256, candidates: mediaCandidate,
      }), error => error?.code === 'CLOUD_QUESTION_IMPORT_SOURCE_UNVERIFIED');
      assert.deepStrictEqual(await importTableCounts(facade), invalidLeaseBefore,
        'an invalid source lease must leave task/storage/source/relay/receipt/item/media row counts strictly unchanged');

      await facade.query(`INSERT INTO business.storage_agent_runtime_receipts(receipt_id,agent_id,agent_version,contracts,parser_sha256,observed_at)
        VALUES ('storage_runtime_receipt_newerv2','storage-agent-1','8.8.1',
          '{"questionPaperExport":3,"storageAgentTransport":2}'::jsonb,NULL,transaction_timestamp()+interval '1 second')`);
      const countsBefore = (await facade.query(`SELECT
        (SELECT count(*)::integer FROM business.question_import_tasks) AS tasks,
        (SELECT count(*)::integer FROM business.storage_object_tasks) AS storage,
        (SELECT count(*)::integer FROM business.import_source_objects) AS sources,
        (SELECT count(*)::integer FROM business.encrypted_import_source_relays) AS relays`)).rows[0];
      await assert.rejects(() => repository.create({
        tenantId: 'default', actor: { accountId: 'teacher-1', roles: ['teacher'] }, idempotencyKey: 'binding-2', request: importRequest('rollback'),
      }), error => error?.code === 'CLOUD_QUESTION_IMPORT_PARSER_UNAVAILABLE');
      const countsAfter = (await facade.query(`SELECT
        (SELECT count(*)::integer FROM business.question_import_tasks) AS tasks,
        (SELECT count(*)::integer FROM business.storage_object_tasks) AS storage,
        (SELECT count(*)::integer FROM business.import_source_objects) AS sources,
        (SELECT count(*)::integer FROM business.encrypted_import_source_relays) AS relays`)).rows[0];
      assert.deepStrictEqual(countsAfter, countsBefore, 'a newer v2 rollback receipt must fail the whole creation CTE without orphan rows');

      await facade.query(`INSERT INTO business.storage_agent_runtime_receipts(receipt_id,agent_id,agent_version,contracts,parser_sha256,observed_at)
        VALUES ('storage_runtime_receipt_stale001','storage-agent-stale','8.8.2',
          '{"questionPaperExport":3,"storageAgentTransport":3,"questionImportParserProof":1}'::jsonb,$1,transaction_timestamp()-interval '1 hour')`, [parserSha256]);
      const staleRepository = createQuestionImportTaskRepository({
        query: (text, values) => facade.query(text, values), storageAgentId: 'storage-agent-stale', runtimeReceiptMaxAgeSeconds: 900,
        randomId: () => 'postgres-stale-id', now: () => new Date('2026-09-05T00:00:00.000Z'),
      });
      await assert.rejects(() => staleRepository.create({
        tenantId: 'default', actor: { accountId: 'teacher-1', roles: ['teacher'] }, idempotencyKey: 'binding-3', request: importRequest('stale'),
      }), error => error?.code === 'CLOUD_QUESTION_IMPORT_PARSER_UNAVAILABLE');
    });
  } finally {
    await runtime.disposeHandle(handle).catch(() => {});
    await runtime.stop().catch(() => {});
  }
  console.log('question import task parser binding PostgreSQL checks passed');
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
