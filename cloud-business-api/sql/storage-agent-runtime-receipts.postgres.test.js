'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createDisposablePg17Runtime, withVNextPg17SyntheticQuery } = require('../../shared/vnext-pg17/disposableRuntime');

const originalSql = fs.readFileSync(path.join(__dirname, '20260830-storage-agent-runtime-receipts.sql'), 'utf8');
const parserProofSql = fs.readFileSync(path.join(__dirname, '20260905-storage-agent-runtime-parser-proof.sql'), 'utf8');

(async () => {
  const runtime = createDisposablePg17Runtime();
  await runtime.start();
  const handle = await runtime.createIsolatedHandle();
  try {
    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
      await facade.query('CREATE SCHEMA business; CREATE ROLE gewu_cloud_schedule_reader');
      await facade.query(originalSql);
      await facade.query(`INSERT INTO business.storage_agent_runtime_receipts
        (receipt_id,agent_id,agent_version,contracts)
        VALUES ('storage_runtime_receipt_legacy01','storage-agent-1','8.8.0',
          '{"questionPaperExport":3,"storageAgentTransport":2}'::jsonb)`);

      await facade.query(parserProofSql);
      assert.deepStrictEqual(
        (await facade.query("SELECT contracts,parser_sha256 AS \"parserSha256\" FROM business.storage_agent_runtime_receipts WHERE receipt_id='storage_runtime_receipt_legacy01'")).rows,
        [{ contracts: { questionPaperExport: 3, storageAgentTransport: 2 }, parserSha256: null }],
        'the parser-proof migration must preserve append-only v2 history',
      );

      const parserSha256 = '9'.repeat(64);
      await facade.query(`INSERT INTO business.storage_agent_runtime_receipts
        (receipt_id,agent_id,agent_version,contracts,parser_sha256)
        VALUES ('storage_runtime_receipt_current1','storage-agent-1','8.8.1',
          '{"questionPaperExport":3,"storageAgentTransport":3,"questionImportParserProof":1}'::jsonb,$1)`, [parserSha256]);
      assert.deepStrictEqual(
        (await facade.query("SELECT parser_sha256 AS \"parserSha256\" FROM business.storage_agent_runtime_receipts WHERE receipt_id='storage_runtime_receipt_current1'")).rows,
        [{ parserSha256 }],
      );

      await assert.rejects(() => facade.query(`INSERT INTO business.storage_agent_runtime_receipts
        (receipt_id,agent_id,agent_version,contracts)
        VALUES ('storage_runtime_receipt_no_proof','storage-agent-1','8.8.1',
          '{"questionPaperExport":3,"storageAgentTransport":3,"questionImportParserProof":1}'::jsonb)`), error => error?.code === '23514');
      await assert.rejects(() => facade.query(`INSERT INTO business.storage_agent_runtime_receipts
        (receipt_id,agent_id,agent_version,contracts,parser_sha256)
        VALUES ('storage_runtime_receipt_forged01','storage-agent-1','8.8.1',
          '{"questionPaperExport":3,"storageAgentTransport":2}'::jsonb,$1)`, [parserSha256]), error => error?.code === '23514');
    });
  } finally {
    await runtime.disposeHandle(handle).catch(() => {});
    await runtime.stop().catch(() => {});
  }
  console.log('storage agent runtime receipt PostgreSQL checks passed');
})().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
