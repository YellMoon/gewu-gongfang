'use strict';

// Maintenance primitive, not an application endpoint or a production CLI.
// Caller must verify the source plan + backup, own a SERIALIZABLE transaction,
// persist the returned before/after receipt durably, then COMMIT (or ROLLBACK).
// This module neither opens connections nor begins/commits transactions.
const FIELDS = Object.freeze(['billing_unit', 'teacher_fee_mode', 'teacher_id', 'teacher_name']);
const fail = code => { throw new Error(code); };
const text = (value, max = 256) => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= max;
const version = value => text(value, 64) && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::\d{2})?)$/.test(value);
async function requireOwnerTransaction(db) {
  const guard = (await db.query("SELECT current_user AS role,current_setting('transaction_isolation') AS isolation,pg_current_xact_id()::text AS transaction_id")).rows[0];
  if (guard?.role !== 'vnext_pg17_business_owner' || guard.isolation !== 'serializable') fail('SNAPSHOT_RECOVERY_OWNER_TRANSACTION_REQUIRED');
  const current = (await db.query('SELECT pg_current_xact_id_if_assigned()::text AS transaction_id')).rows[0];
  if (!guard.transaction_id || current?.transaction_id !== guard.transaction_id) fail('SNAPSHOT_RECOVERY_OWNER_TRANSACTION_REQUIRED');
  return guard.transaction_id;
}

async function restoreScheduleSnapshotsInTransaction(db, { tenantId, candidates }) {
  if (!db || typeof db.query !== 'function' || !text(tenantId) || !Array.isArray(candidates) || !candidates.length || candidates.length > 10000) fail('SNAPSHOT_RECOVERY_INPUT_INVALID');
  const ids = new Set();
  // Capture inputs before awaiting, so a caller cannot change a validated patch mid-transaction.
  const input = candidates.map(candidate => {
    const patch = candidate?.patch;
    if (!text(candidate?.id) || candidate.tenantId !== tenantId || ids.has(candidate.id) || !version(candidate.expectedUpdatedAt)
      || !patch || Object.keys(patch).length !== 4 || !FIELDS.every(key => Object.hasOwn(patch, key))
      || ![1, 2].includes(patch.billing_unit) || ![1, 2].includes(patch.teacher_fee_mode)
      || !text(patch.teacher_id) || !text(patch.teacher_name, 4096)) fail('SNAPSHOT_RECOVERY_INPUT_INVALID');
    ids.add(candidate.id);
    return { id: candidate.id, expectedUpdatedAt: candidate.expectedUpdatedAt, patch: { ...patch } };
  });
  const transactionId = await requireOwnerTransaction(db);
  const locked = (await db.query(`SELECT s.id,s.updated_at::text AS updated_at,s.legacy_deleted,
      s.billing_unit,s.teacher_fee_mode,s.teacher_id,s.teacher_name,
      s.updated_at=x."expectedUpdatedAt"::timestamptz AS version_matches
    FROM business.schedules s JOIN jsonb_to_recordset($2::jsonb) AS x(id text,"expectedUpdatedAt" text) ON x.id=s.id
    WHERE s.tenant_id=$1 ORDER BY s.id COLLATE "C" FOR UPDATE OF s`, [tenantId, JSON.stringify(input)])).rows;
  if (locked.length !== input.length) fail('SNAPSHOT_RECOVERY_RECORD_MISSING');
  const byId = new Map(input.map(row => [row.id, row]));
  const toApply = [], alreadyRestored = [];
  for (const row of locked) {
    if (row.legacy_deleted !== false) fail('SNAPSHOT_RECOVERY_RECORD_DELETED');
    const candidate = byId.get(row.id);
    if (FIELDS.some(key => row[key] !== null)) {
      if (!FIELDS.every(key => row[key] === candidate.patch[key])) fail('SNAPSHOT_RECOVERY_EXISTING_CONFLICT');
      alreadyRestored.push(row.id);
      continue;
    }
    if (!row.version_matches) fail('SNAPSHOT_RECOVERY_VERSION_CONFLICT');
    toApply.push({ row, candidate });
  }
  const teacherIds = [...new Set(toApply.map(item => item.candidate.patch.teacher_id))].sort();
  if (teacherIds.length) {
    const teachers = await db.query('SELECT id FROM business.teachers WHERE tenant_id=$1 AND id=ANY($2::text[]) ORDER BY id COLLATE "C" FOR KEY SHARE', [tenantId, teacherIds]);
    if (teachers.rows.length !== teacherIds.length) fail('SNAPSHOT_RECOVERY_TEACHER_MISSING');
  }
  const applied = [];
  for (const { row, candidate } of toApply) {
    const patch = candidate.patch;
    const changed = await db.query(`UPDATE business.schedules SET billing_unit=$4,teacher_fee_mode=$5,teacher_id=$6,teacher_name=$7,
      updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 microsecond')
      WHERE tenant_id=$1 AND id=$2 AND updated_at=$3::timestamptz AND legacy_deleted=false
        AND billing_unit IS NULL AND teacher_fee_mode IS NULL AND teacher_id IS NULL AND teacher_name IS NULL
      RETURNING updated_at::text AS updated_at`, [tenantId, row.id, candidate.expectedUpdatedAt, patch.billing_unit, patch.teacher_fee_mode, patch.teacher_id, patch.teacher_name]);
    if (changed.rows.length !== 1) fail('SNAPSHOT_RECOVERY_VERSION_CONFLICT');
    applied.push({ id: row.id,
      before: { ...Object.fromEntries(FIELDS.map(key => [key, row[key]])), updated_at: row.updated_at },
      after: { ...patch, updated_at: changed.rows[0].updated_at } });
  }
  return { tenantId, transactionId, applied, alreadyRestored };
}

async function rollbackScheduleSnapshotsInTransaction(db, { tenantId, applied }) {
  if (!db || typeof db.query !== 'function' || !text(tenantId) || !Array.isArray(applied) || !applied.length || applied.length > 10000) fail('SNAPSHOT_ROLLBACK_INPUT_INVALID');
  const ids = new Set();
  const input = applied.map(item => {
    if (!text(item?.id) || ids.has(item.id) || !item.before || !item.after
      || !FIELDS.every(key => item.before[key] === null) || !version(item.before.updated_at) || !version(item.after.updated_at)
      || ![1, 2].includes(item.after.billing_unit) || ![1, 2].includes(item.after.teacher_fee_mode)
      || !text(item.after.teacher_id) || !text(item.after.teacher_name, 4096)) fail('SNAPSHOT_ROLLBACK_INPUT_INVALID');
    ids.add(item.id);
    return { id: item.id, expectedUpdatedAt: item.after.updated_at, patch: Object.fromEntries(FIELDS.map(key => [key, item.after[key]])) };
  });
  const transactionId = await requireOwnerTransaction(db);
  const locked = (await db.query(`SELECT s.id,s.updated_at::text AS updated_at,s.legacy_deleted,
      s.billing_unit,s.teacher_fee_mode,s.teacher_id,s.teacher_name,
      s.updated_at=x."expectedUpdatedAt"::timestamptz AS version_matches
    FROM business.schedules s JOIN jsonb_to_recordset($2::jsonb) AS x(id text,"expectedUpdatedAt" text) ON x.id=s.id
    WHERE s.tenant_id=$1 ORDER BY s.id COLLATE "C" FOR UPDATE OF s`, [tenantId, JSON.stringify(input)])).rows;
  if (locked.length !== input.length) fail('SNAPSHOT_ROLLBACK_RECORD_MISSING');
  const byId = new Map(input.map(item => [item.id, item])), pending = [], alreadyRolledBack = [];
  for (const row of locked) {
    if (row.legacy_deleted !== false) fail('SNAPSHOT_ROLLBACK_RECORD_DELETED');
    if (FIELDS.every(key => row[key] === null)) { alreadyRolledBack.push(row.id); continue; }
    const candidate = byId.get(row.id);
    if (!row.version_matches) fail('SNAPSHOT_ROLLBACK_VERSION_CONFLICT');
    if (!FIELDS.every(key => row[key] === candidate.patch[key])) fail('SNAPSHOT_ROLLBACK_EXISTING_CONFLICT');
    pending.push({ row, candidate });
  }
  const rolledBack = [];
  for (const { row, candidate } of pending) {
    const result = await db.query(`UPDATE business.schedules SET billing_unit=NULL,teacher_fee_mode=NULL,teacher_id=NULL,teacher_name=NULL,
      updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 microsecond')
      WHERE tenant_id=$1 AND id=$2 AND updated_at=$3::timestamptz AND legacy_deleted=false
        AND jsonb_build_object('billing_unit',billing_unit,'teacher_fee_mode',teacher_fee_mode,'teacher_id',teacher_id,'teacher_name',teacher_name)=$4::jsonb
      RETURNING updated_at::text AS updated_at`, [tenantId, row.id, candidate.expectedUpdatedAt, JSON.stringify(candidate.patch)]);
    if (result.rows.length !== 1) fail('SNAPSHOT_ROLLBACK_VERSION_CONFLICT');
    rolledBack.push({ id: row.id, before: { ...candidate.patch, updated_at: row.updated_at },
      after: { ...Object.fromEntries(FIELDS.map(key => [key, null])), updated_at: result.rows[0].updated_at } });
  }
  return { tenantId, transactionId, rolledBack, alreadyRolledBack };
}

module.exports = { restoreScheduleSnapshotsInTransaction, rollbackScheduleSnapshotsInTransaction };
