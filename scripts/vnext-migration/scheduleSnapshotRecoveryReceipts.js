'use strict';
const { createHash } = require('node:crypto');
const { restoreScheduleSnapshotsInTransaction, rollbackScheduleSnapshotsInTransaction, assertOwnerRecoveryTransaction } = require('./scheduleSnapshotRecoveryTransaction');
const SHA = /^[a-f0-9]{64}$/;
const fields = ['billing_unit', 'teacher_fee_mode', 'teacher_id', 'teacher_name'];
const fail = code => { throw new Error(code); };
function scope(tenantId, planSha256) {
  if (typeof tenantId !== 'string' || !tenantId.length || tenantId.trim() !== tenantId || !SHA.test(planSha256)) fail('RECOVERY_RECEIPT_INPUT_INVALID');
}
async function loadLocked(db, tenantId, planSha256) {
  await assertOwnerRecoveryTransaction(db);
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`schedule-snapshot-recovery:${tenantId}:${planSha256}`]);
  return (await db.query('SELECT * FROM business.schedule_snapshot_recovery_receipts WHERE tenant_id=$1 AND plan_sha256=$2 FOR UPDATE', [tenantId, planSha256])).rows[0];
}
async function verifyRecordedState(db, tenantId, rows) {
  const expected = rows.map(row => ({ id: row.id, version: row.after.updated_at, patch: Object.fromEntries(fields.map(key => [key, row.after[key]])) }));
  const result = await db.query(`SELECT s.id,s.legacy_deleted=false AND s.updated_at=x.version::timestamptz AND
    jsonb_build_object('billing_unit',s.billing_unit,'teacher_fee_mode',s.teacher_fee_mode,'teacher_id',s.teacher_id,'teacher_name',s.teacher_name)=x.patch AS matches
    FROM business.schedules s JOIN jsonb_to_recordset($2::jsonb) x(id text,version text,patch jsonb) ON x.id=s.id
    WHERE s.tenant_id=$1 ORDER BY s.id COLLATE "C" FOR UPDATE OF s`, [tenantId, JSON.stringify(expected)]);
  if (result.rows.length !== expected.length || result.rows.some(row => row.matches !== true)) fail('RECOVERY_RECEIPT_STATE_CHANGED');
}

// The outer operator owns transaction/backup/source verification. A receipt write
// failure must abort that transaction; no process memory or sidecar is authoritative.
async function applyRecoveryWithReceipt(db, { plan, planSha256, backupSha256 }) {
  scope(plan?.tenantId, planSha256);
  if (!SHA.test(backupSha256) || plan.version !== 1 || plan.mode !== 'read_only_proposal' || !Array.isArray(plan.candidates) || !plan.candidates.length) fail('RECOVERY_RECEIPT_INPUT_INVALID');
  const serialized = JSON.stringify(plan, null, 2);
  if (createHash('sha256').update(serialized, 'utf8').digest('hex') !== planSha256) fail('RECOVERY_PLAN_HASH_MISMATCH');
  const captured = JSON.parse(serialized), tenantId = captured.tenantId;
  const existing = await loadLocked(db, tenantId, planSha256);
  if (existing) {
    if (existing.backup_sha256 !== backupSha256) fail('RECOVERY_BACKUP_MISMATCH');
    if (existing.state !== 'applied') fail('RECOVERY_PLAN_ALREADY_ROLLED_BACK');
    await verifyRecordedState(db, tenantId, existing.applied_receipt.applied);
    return { status: 'already_applied', receipt: existing.applied_receipt };
  }
  const receipt = await restoreScheduleSnapshotsInTransaction(db, { tenantId, candidates: captured.candidates });
  if (receipt.alreadyRestored.length || receipt.applied.length !== captured.candidates.length) fail('RECOVERY_UNTRACKED_PRIOR_RESTORE');
  await db.query(`INSERT INTO business.schedule_snapshot_recovery_receipts(tenant_id,plan_sha256,backup_sha256,state,source_plan,applied_receipt)
    VALUES($1,$2,$3,'applied',$4::jsonb,$5::jsonb)`, [tenantId, planSha256, backupSha256, serialized, JSON.stringify(receipt)]);
  return { status: 'applied', receipt };
}
async function rollbackRecoveryWithReceipt(db, { tenantId, planSha256 }) {
  scope(tenantId, planSha256);
  const existing = await loadLocked(db, tenantId, planSha256);
  if (!existing) fail('RECOVERY_RECEIPT_MISSING');
  if (existing.state === 'rolled_back') {
    await verifyRecordedState(db, tenantId, existing.rollback_receipt.rolledBack);
    return { status: 'already_rolled_back', receipt: existing.rollback_receipt };
  }
  const receipt = await rollbackScheduleSnapshotsInTransaction(db, existing.applied_receipt);
  if (receipt.alreadyRolledBack.length || receipt.rolledBack.length !== existing.applied_receipt.applied.length) fail('RECOVERY_UNTRACKED_PRIOR_ROLLBACK');
  await db.query(`UPDATE business.schedule_snapshot_recovery_receipts SET state='rolled_back',rollback_receipt=$3::jsonb,rolled_back_at=clock_timestamp()
    WHERE tenant_id=$1 AND plan_sha256=$2 AND state='applied'`, [tenantId, planSha256, JSON.stringify(receipt)]);
  return { status: 'rolled_back', receipt };
}
module.exports = { applyRecoveryWithReceipt, rollbackRecoveryWithReceipt };
