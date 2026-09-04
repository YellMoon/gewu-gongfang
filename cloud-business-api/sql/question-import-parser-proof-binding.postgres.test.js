'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createDisposablePg17Runtime, withVNextPg17SyntheticQuery } = require('../../shared/vnext-pg17/disposableRuntime');

const migration = fs.readFileSync(path.join(__dirname, '20260905-zz-question-import-parser-proof-binding.sql'), 'utf8');

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
          receipt_id text COLLATE "C" PRIMARY KEY,
          parser_sha256 text COLLATE "C"
        );
        CREATE TABLE business.question_import_tasks (
          task_id text COLLATE "C" PRIMARY KEY,
          metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb
        );
        INSERT INTO business.question_import_tasks(task_id,metadata_json)
        VALUES ('question_import_task_legacy01','{"parserSha256":"forged-client-value"}'::jsonb);
      `);
      await facade.query(migration);
      assert.deepStrictEqual((await facade.query(`SELECT parser_contract_version AS "version",parser_sha256 AS "parserSha256",
        parser_runtime_receipt_id AS "receiptId" FROM business.question_import_tasks WHERE task_id='question_import_task_legacy01'`)).rows,
      [{ version: 0, parserSha256: null, receiptId: null }],
      'existing imports must be explicitly marked legacy without trusting metadata');

      const parserSha256 = '9'.repeat(64);
      await facade.query(`INSERT INTO business.storage_agent_runtime_receipts(receipt_id,parser_sha256)
        VALUES ('storage_runtime_receipt_current1',$1)`, [parserSha256]);
      await facade.query(`INSERT INTO business.question_import_tasks
        (task_id,metadata_json,parser_contract_version,parser_sha256,parser_runtime_receipt_id)
        VALUES ('question_import_task_current1','{}',1,$1,'storage_runtime_receipt_current1')`, [parserSha256]);
      await assert.rejects(() => facade.query(`INSERT INTO business.question_import_tasks
        (task_id,metadata_json,parser_contract_version,parser_sha256,parser_runtime_receipt_id)
        VALUES ('question_import_task_forged01','{}',1,$1,'storage_runtime_receipt_current1')`, ['8'.repeat(64)]), error => error?.code === '23503');
      await facade.query(`INSERT INTO business.question_import_tasks(task_id,metadata_json)
        VALUES ('question_import_task_implicit_legacy','{}')`);
      assert.deepStrictEqual((await facade.query(`SELECT parser_contract_version AS "version",parser_sha256 AS "parserSha256",
        parser_runtime_receipt_id AS "receiptId" FROM business.question_import_tasks
        WHERE task_id='question_import_task_implicit_legacy'`)).rows,
      [{ version: 0, parserSha256: null, receiptId: null }],
      'an old cloud INSERT that omits parser-proof columns must remain a valid explicit legacy-version-0 task');
      await assert.rejects(() => facade.query(`UPDATE business.question_import_tasks SET parser_sha256=$1
        WHERE task_id='question_import_task_current1'`, ['8'.repeat(64)]), error => error?.code === 'P0001');
      await facade.query(`UPDATE business.question_import_tasks SET metadata_json='{"reviewed":true}'::jsonb
        WHERE task_id='question_import_task_current1'`);
      assert.deepStrictEqual((await facade.query(`SELECT metadata_json AS metadata FROM business.question_import_tasks
        WHERE task_id='question_import_task_current1'`)).rows, [{ metadata: { reviewed: true } }]);
    });
  } finally {
    await runtime.disposeHandle(handle).catch(() => {});
    await runtime.stop().catch(() => {});
  }
  console.log('question import parser-proof binding PostgreSQL checks passed');
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
