'use strict';
// Runs in a disposable operator container against a newly restored shadow DB.
// Credentials arrive only on stdin, never through environment/files/logs.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { applyRecoveryWithReceipt, rollbackRecoveryWithReceipt } = require('./scheduleSnapshotRecoveryReceipts');
const FIELDS = ['billing_unit', 'teacher_fee_mode', 'teacher_id', 'teacher_name'];
let stage = 'input';
async function probe(config) {
  if (!/^gewu_snapshot_shadow_[a-f0-9]{16}$/.test(config?.connection?.database || '') || !/^[a-f0-9]{64}$/.test(config.backupSha256 || '')) throw new Error('SHADOW_DATABASE_REQUIRED');
  const { Client } = require('/app/node_modules/pg');
  const plan = JSON.parse(fs.readFileSync(path.join(__dirname, 'plan.json'), 'utf8'));
  const planSha256 = createHash('sha256').update(JSON.stringify(plan, null, 2), 'utf8').digest('hex');
  if (planSha256 !== config.planSha256) throw new Error('PLAN_HASH_MISMATCH');
  const connection = { ...config.connection, connectionTimeoutMillis: 15000, application_name: 'gewu-isolated-snapshot-probe' };
  const read = new Client(connection); await read.connect();
  try {
    assert.equal((await read.query('SELECT current_database() AS name')).rows[0].name, config.connection.database);
    async function transaction(work) {
      // Each operation has a fresh connection: receipts cannot come from process cache.
      const client = new Client(connection); await client.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        await client.query('SET LOCAL ROLE vnext_pg17_business_owner');
        const result = await work(client);
        await client.query('COMMIT');
        return result;
      } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
      finally { await client.end(); }
    }
    async function fingerprints(mode) {
      await read.query(`CREATE OR REPLACE FUNCTION pg_temp.probe_fingerprints(p_mode text) RETURNS jsonb LANGUAGE plpgsql AS $$
      DECLARE r record; amount bigint; fingerprint text; output jsonb='{}'; expression text;
      BEGIN
       FOR r IN SELECT schemaname,tablename FROM pg_tables WHERE schemaname IN ('business','vnext_control_plane') AND tablename NOT IN ('cloud_schema_migrations','schedule_snapshot_recovery_receipts') ORDER BY schemaname,tablename LOOP
        expression='to_jsonb(t)';
        IF r.schemaname='business' AND r.tablename='schedules' THEN
         IF p_mode='ignore-recovery' THEN expression=expression||'-ARRAY[''billing_unit'',''teacher_fee_mode'',''teacher_id'',''teacher_name'',''updated_at'']';
         ELSIF p_mode='ignore-version' THEN expression=expression||'-''updated_at'''; END IF;
        END IF;
        EXECUTE format('SELECT count(*),md5(COALESCE(string_agg(j::text,E''\\n'' ORDER BY j::text),'''')) FROM (SELECT %s AS j FROM %I.%I t) rows',expression,r.schemaname,r.tablename) INTO amount,fingerprint;
        output=output||jsonb_build_object(r.schemaname||'.'||r.tablename,jsonb_build_object('count',amount,'fingerprint',fingerprint));
       END LOOP; RETURN output;
      END $$;`);
      return (await read.query('SELECT pg_temp.probe_fingerprints($1) AS value', [mode])).rows[0].value;
    }
    const countReceipts = async () => Number((await read.query('SELECT count(*) AS count FROM business.schedule_snapshot_recovery_receipts')).rows[0].count);
    const original = await fingerprints('exact'), originalBusiness = await fingerprints('ignore-recovery'), originalWithoutVersion = await fingerprints('ignore-version');
    assert.equal(await countReceipts(), 0);
    const request = { plan, planSha256, backupSha256: config.backupSha256 };
    stage = 'receipt-write-failure';
    await assert.rejects(() => transaction(db => applyRecoveryWithReceipt({ query: (sql, args) => {
      if (sql.startsWith('INSERT INTO business.schedule_snapshot_recovery_receipts')) throw new Error('INJECTED_RECEIPT_FAILURE');
      return db.query(sql, args);
    } }, request)), /INJECTED_RECEIPT_FAILURE/);
    assert.deepEqual(await fingerprints('exact'), original); assert.equal(await countReceipts(), 0);
    stage = 'apply';
    const applied = await transaction(db => applyRecoveryWithReceipt(db, request));
    assert.equal(applied.status, 'applied'); assert.equal(applied.receipt.applied.length, plan.candidates.length);
    assert.equal(await countReceipts(), 1);
    assert.deepEqual(await fingerprints('ignore-recovery'), originalBusiness);
    const rows = (await read.query('SELECT id,billing_unit,teacher_fee_mode,teacher_id,teacher_name FROM business.schedules WHERE billing_unit IS NOT NULL OR teacher_fee_mode IS NOT NULL OR teacher_id IS NOT NULL OR teacher_name IS NOT NULL')).rows;
    assert.equal(rows.length, plan.candidates.length);
    const expected = new Map(plan.candidates.map(item => [item.id, item.patch]));
    for (const row of rows) for (const key of FIELDS) assert.equal(row[key], expected.get(row.id)?.[key]);
    const afterApply = await fingerprints('exact');
    stage = 'retry-after-commit-new-connection';
    const retried = await transaction(db => applyRecoveryWithReceipt(db, request));
    assert.equal(retried.status, 'already_applied'); assert.deepEqual(retried.receipt, applied.receipt);
    assert.deepEqual(await fingerprints('exact'), afterApply);
    stage = 'rollback-receipt-failure';
    await assert.rejects(() => transaction(db => rollbackRecoveryWithReceipt({ query: (sql, args) => {
      if (sql.startsWith('UPDATE business.schedule_snapshot_recovery_receipts')) throw new Error('INJECTED_UNDO_RECEIPT_FAILURE');
      return db.query(sql, args);
    } }, { tenantId: plan.tenantId, planSha256 })), /INJECTED_UNDO_RECEIPT_FAILURE/);
    assert.deepEqual(await fingerprints('exact'), afterApply);
    stage = 'rollback';
    const undone = await transaction(db => rollbackRecoveryWithReceipt(db, { tenantId: plan.tenantId, planSha256 }));
    assert.equal(undone.receipt.rolledBack.length, plan.candidates.length);
    assert.deepEqual(await fingerprints('ignore-version'), originalWithoutVersion);
    const afterUndo = await fingerprints('exact');
    const again = await transaction(db => rollbackRecoveryWithReceipt(db, { tenantId: plan.tenantId, planSha256 }));
    assert.equal(again.status, 'already_rolled_back'); assert.deepEqual(again.receipt, undone.receipt);
    assert.deepEqual(await fingerprints('exact'), afterUndo);
    await assert.rejects(() => transaction(db => applyRecoveryWithReceipt(db, request)), /RECOVERY_PLAN_ALREADY_ROLLED_BACK/);
    const stored = (await read.query('SELECT state,plan_sha256,backup_sha256 FROM business.schedule_snapshot_recovery_receipts')).rows;
    assert.deepEqual(stored, [{ state: 'rolled_back', plan_sha256: planSha256, backup_sha256: config.backupSha256 }]);
    stage = 'complete';
    return { ok: true, productionWrite: false, fullBackupRestored: true, database: connection.database, planSha256, backupSha256: config.backupSha256,
      candidateCount: plan.candidates.length, tableCount: Object.keys(original).length, scheduleCount: original['business.schedules'].count,
      applied: applied.receipt.applied.length, rolledBack: undone.receipt.rolledBack.length, persistentReceiptCount: stored.length,
      freshConnectionRetryVerified: true, failedReceiptWriteRolledBack: true, failedRollbackReceiptRolledBack: true,
      nonRecoveryDataUnchanged: true, rollbackChangedVersionsOnly: true };
  } finally { await read.end(); }
}
if (require.main === module) {
  let input = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', value => { input += value; });
  process.stdin.on('end', async () => {
    try { const config = JSON.parse(input); input = ''; console.log(JSON.stringify(await probe(config))); }
    catch (error) { console.error(JSON.stringify({ ok: false, stage, code: error.code || (/^[A-Z0-9_]+$/.test(error.message || '') ? error.message : 'SHADOW_PROBE_FAILED') })); process.exitCode = 1; }
  });
}
module.exports = { probe };
