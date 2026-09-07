// UTF-8: isolated PostgreSQL only; never reads production connection settings.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const os = require('node:os'), crypto = require('node:crypto');
const { createDisposablePg17Runtime, withVNextPg17SyntheticQuery: withQuery } = require('../../shared/vnext-pg17/disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('../../shared/vnext-pg17/catalogAssertion');
const { createBusinessFoundationCatalogBoundary } = require('../../shared/vnext-pg17/businessFoundationCatalogAssertion');
const { restoreScheduleSnapshotsInTransaction, rollbackScheduleSnapshotsInTransaction } = require('./scheduleSnapshotRecoveryTransaction');
const { planCapturedScheduleSnapshotRecovery } = require('./planCapturedScheduleSnapshotRecovery');

const patch = { billing_unit: 2, teacher_fee_mode: 1, teacher_id: 'teacher-1', teacher_name: 'Historical teacher' };
const version = '2026-08-23T05:01:02.123456Z';
const synthetic = ['lesson-1', 'lesson-2'].map(id => ({ id, tenantId: 'tenant-1', expectedUpdatedAt: version, patch: { ...patch } }));
const runtime = createDisposablePg17Runtime();
async function test() {
  await runtime.start(); const handle = await runtime.createIsolatedHandle();
  try {
    const receipt = { appliedAt: '2026-09-07T00:00:00.000Z', appliedBy: 'schedule-snapshot-recovery-test' };
    await createVNextPg17CatalogBoundary(runtime).apply(handle, receipt);
    await createBusinessFoundationCatalogBoundary(runtime).apply(handle, receipt);
    await withQuery(handle, 'fixture-provisioner', async db => {
      // Foundation schema plus the actual additive snapshot migration and its dependencies.
      for (const file of ['20260824-schedule-lifecycle.sql', '20260822-business-schedule-student-override.sql', '20260901-business-schedule-update-lifecycle.sql', '20260907-teacher-schedule-write-scope.sql', '20260907-zz-schedule-financial-snapshot.sql']) {
        await db.query(fs.readFileSync(path.join(__dirname, '../../cloud-business-api/sql', file), 'utf8'));
      }
      await db.query("INSERT INTO business.tenants(id,name,legacy_deleted,created_at,updated_at) VALUES ('tenant-1','Recovery fixture',false,now(),now()),('tenant-2','Other tenant',false,now(),now())");
      await db.query("INSERT INTO business.teachers(id,tenant_id,name,legacy_deleted,created_at,updated_at) VALUES ('teacher-1','tenant-1','Teacher',true,now(),now()),('foreign','tenant-2','Foreign',false,now(),now())");
      await db.query("INSERT INTO business.courses(id,tenant_id,name,display_name,course_type,legacy_source_type,price_tuition,price_teacher,billing_unit,teacher_fee_mode,legacy_active,legacy_deleted,created_at,updated_at) VALUES ('course-1','tenant-1','Course','Course',1,1,180,120,1,1,true,false,now(),now())");
      for (const candidate of synthetic) await db.query("INSERT INTO business.schedules(id,tenant_id,course_id,start_at,end_at,status,room_display_snapshot,notes,calculated_tuition,calculated_teacher_fee,legacy_deleted,created_at,updated_at) VALUES ($1,'tenant-1','course-1','2026-06-01T02:00:00Z','2026-06-01T03:30:00Z',1,'Original room','Do not change',180,120,false,$2,$2)", [candidate.id, version]);
    });
    const allRows = () => withQuery(handle, 'fixture-provisioner', async db => (await db.query('SELECT to_jsonb(s) AS row FROM business.schedules s ORDER BY id')).rows.map(item => item.row));
    async function transaction(work, commit = true) {
      return withQuery(handle, 'fixture-provisioner', async db => {
        await db.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        try {
          await db.query('SET LOCAL ROLE vnext_pg17_business_owner');
          const value = await work(db);
          await db.query(commit ? 'COMMIT' : 'ROLLBACK');
          return value;
        } catch (error) { await db.query('ROLLBACK'); throw error; }
      });
    }
    const before = await allRows();
    await assert.rejects(() => transaction(async db => {
      let writes = 0;
      const fault = { query: async (sql, values) => {
        if (sql.startsWith('UPDATE business.schedules') && ++writes === 2) throw new Error('INJECTED_SECOND_WRITE_FAILURE');
        return db.query(sql, values);
      } };
      await restoreScheduleSnapshotsInTransaction(fault, { tenantId: 'tenant-1', candidates: synthetic });
    }), /INJECTED_SECOND_WRITE_FAILURE/);
    assert.deepEqual(await allRows(), before, 'failure after first UPDATE must roll it back too');
    // A stale second record must prevent the first from being committed.
    const stale = structuredClone(synthetic); stale[1].expectedUpdatedAt = '2026-08-23T05:01:02.123455Z';
    await assert.rejects(() => transaction(db => restoreScheduleSnapshotsInTransaction(db, { tenantId: 'tenant-1', candidates: stale })), /SNAPSHOT_RECOVERY_VERSION_CONFLICT/);
    assert.deepEqual(await allRows(), before);
    const crossTenant = structuredClone(synthetic); crossTenant[1].patch.teacher_id = 'foreign';
    await assert.rejects(() => transaction(db => restoreScheduleSnapshotsInTransaction(db, { tenantId: 'tenant-1', candidates: crossTenant })), /SNAPSHOT_RECOVERY_TEACHER_MISSING/);
    assert.deepEqual(await allRows(), before);
    await transaction(async db => {
      const result = await restoreScheduleSnapshotsInTransaction(db, { tenantId: 'tenant-1', candidates: synthetic });
      assert.equal(result.applied.length, 2);
      assert.equal(result.applied[0].before.updated_at.includes('123456'), true, 'keep full PostgreSQL timestamp precision');
    }, false);
    assert.deepEqual(await allRows(), before, 'an explicit rollback restores the original rows exactly');
    const applied = await transaction(db => restoreScheduleSnapshotsInTransaction(db, { tenantId: 'tenant-1', candidates: synthetic }));
    assert.equal(applied.applied.length, 2);
    const after = await allRows();
    for (let i = 0; i < after.length; i++) {
      for (const key of Object.keys(before[i])) if (![...Object.keys(patch), 'updated_at'].includes(key)) assert.deepEqual(after[i][key], before[i][key], key);
      for (const key of Object.keys(patch)) assert.equal(after[i][key], patch[key]);
      assert.notEqual(after[i].updated_at, before[i].updated_at);
    }
    const repeat = await transaction(db => restoreScheduleSnapshotsInTransaction(db, { tenantId: 'tenant-1', candidates: synthetic }));
    assert.deepEqual(repeat.applied, []); assert.equal(repeat.alreadyRestored.length, 2);
    assert.deepEqual(await allRows(), after, 'repeat must not even bump versions');
    const conflict = structuredClone(synthetic); conflict[0].patch.billing_unit = 1;
    await assert.rejects(() => transaction(db => restoreScheduleSnapshotsInTransaction(db, { tenantId: 'tenant-1', candidates: conflict })), /SNAPSHOT_RECOVERY_EXISTING_CONFLICT/);
    assert.deepEqual(await allRows(), after);
    await assert.rejects(() => transaction(async db => {
      let writes = 0;
      await rollbackScheduleSnapshotsInTransaction({ query: (sql, values) => {
        if (sql.startsWith('UPDATE business.schedules') && ++writes === 2) throw new Error('INJECTED_ROLLBACK_WRITE_FAILURE');
        return db.query(sql, values);
      } }, applied);
    }), /INJECTED_ROLLBACK_WRITE_FAILURE/);
    assert.deepEqual(await allRows(), after, 'a failed undo must not clear only part of the batch');
    await withQuery(handle, 'fixture-provisioner', db => db.query("UPDATE business.schedules SET notes='Later legitimate edit',updated_at=updated_at+interval '1 second' WHERE id='lesson-1'"));
    const later = await allRows();
    await assert.rejects(() => transaction(db => rollbackScheduleSnapshotsInTransaction(db, applied)), /SNAPSHOT_ROLLBACK_VERSION_CONFLICT/);
    assert.deepEqual(await allRows(), later, 'rollback must not erase later edits');
    // Restore only this synthetic fixture to the recorded post-apply state for the success case.
    await withQuery(handle, 'fixture-provisioner', db => db.query('UPDATE business.schedules SET notes=$1,updated_at=$2 WHERE id=$3', [after[0].notes, after[0].updated_at, after[0].id]));
    const reverted = await transaction(db => rollbackScheduleSnapshotsInTransaction(db, applied));
    assert.equal(reverted.rolledBack.length, 2);
    const undone = await allRows();
    for (let i = 0; i < undone.length; i++) {
      for (const key of Object.keys(before[i])) if (key !== 'updated_at') assert.deepEqual(undone[i][key], before[i][key]);
      assert.notEqual(undone[i].updated_at, before[i].updated_at, 'rollback must not resurrect an old concurrency version');
    }
    const repeatedUndo = await transaction(db => rollbackScheduleSnapshotsInTransaction(db, applied));
    assert.equal(repeatedUndo.rolledBack.length, 0); assert.equal(repeatedUndo.alreadyRolledBack.length, 2);
    assert.deepEqual(await allRows(), undone);
    await withQuery(handle, 'writer', async db => {
      await db.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      try {
        await assert.rejects(() => restoreScheduleSnapshotsInTransaction(db, { tenantId: 'tenant-1', candidates: synthetic }), /SNAPSHOT_RECOVERY_OWNER_TRANSACTION_REQUIRED/);
        await assert.rejects(() => rollbackScheduleSnapshotsInTransaction(db, applied), /SNAPSHOT_RECOVERY_OWNER_TRANSACTION_REQUIRED/);
      }
      finally { await db.query('ROLLBACK'); }
    });
    await withQuery(handle, 'fixture-provisioner', db => assert.rejects(() => restoreScheduleSnapshotsInTransaction(db, { tenantId: 'tenant-1', candidates: synthetic }), /SNAPSHOT_RECOVERY_OWNER_TRANSACTION_REQUIRED/));
    await withQuery(handle, 'fixture-provisioner', async db => {
      await db.query("SET default_transaction_isolation='serializable'");
      await db.query('SET ROLE vnext_pg17_business_owner');
      try {
        await assert.rejects(() => restoreScheduleSnapshotsInTransaction(db, { tenantId: 'tenant-1', candidates: synthetic }), /SNAPSHOT_RECOVERY_OWNER_TRANSACTION_REQUIRED/);
      } finally { await db.query('RESET ROLE'); await db.query('RESET default_transaction_isolation'); }
    });
    if (process.argv[2]) {
      // Replay only an explicitly supplied, hash-verified capture in THIS disposable DB.
      // Related names are placeholders: this is not a production full-database clone.
      const capture = fs.realpathSync(process.argv[2]);
      const suppliedPlan = fs.realpathSync(process.argv[3]);
      if (path.dirname(suppliedPlan) !== capture) throw new Error('PLAN_OUTSIDE_CAPTURE');
      const probe = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-replay-plan-'));
      let plan, sourcePlanSha256;
      try {
        const regenerated = path.join(probe, 'proposal.json');
        const result = planCapturedScheduleSnapshotRecovery({ captureDirectory: capture, outputPath: regenerated });
        sourcePlanSha256 = crypto.createHash('sha256').update(fs.readFileSync(suppliedPlan)).digest('hex');
        assert.equal(result.proposalSha256, sourcePlanSha256, 'do not replay a modified or stale proposal');
        plan = JSON.parse(fs.readFileSync(regenerated, 'utf8'));
      } finally { fs.rmSync(probe, { recursive: true, force: true }); }
      const cloud = JSON.parse(fs.readFileSync(path.join(capture, 'cloud-schedule-baseline.json'), 'utf8'));
      const baseline = new Map(cloud.schedules.map(row => [row.id, row]));
      assert(plan.candidates.length > 0);
      const tenantId = plan.tenantId;
      const courseIds = [...new Set(plan.candidates.map(item => baseline.get(item.id).course_id))];
      const teacherIds = [...new Set(plan.candidates.map(item => item.patch.teacher_id))];
      const studentIds = [...new Set(plan.candidates.flatMap(item => baseline.get(item.id).student_ids))];
      await withQuery(handle, 'fixture-provisioner', async db => {
        await db.query('INSERT INTO business.tenants(id,name,legacy_deleted,created_at,updated_at) VALUES ($1,$2,false,now(),now())', [tenantId, 'Captured baseline fixture']);
        for (const id of teacherIds) await db.query('INSERT INTO business.teachers(id,tenant_id,name,legacy_deleted,created_at,updated_at) VALUES ($1,$2,$3,false,now(),now())', [id, tenantId, 'Fixture teacher']);
        for (const id of studentIds) await db.query('INSERT INTO business.students(id,tenant_id,name,legacy_is_institution_student,legacy_deleted,created_at,updated_at) VALUES ($1,$2,$3,false,false,now(),now())', [id, tenantId, 'Fixture student']);
        for (const id of courseIds) await db.query('INSERT INTO business.courses(id,tenant_id,name,display_name,course_type,legacy_source_type,price_tuition,price_teacher,billing_unit,teacher_fee_mode,legacy_active,legacy_deleted,created_at,updated_at) VALUES ($1,$2,$3,$3,1,1,0,0,1,1,true,false,now(),now())', [id, tenantId, 'Fixture course']);
        for (const candidate of plan.candidates) {
          const row = baseline.get(candidate.id);
          await db.query(`INSERT INTO business.schedules(id,tenant_id,course_id,start_at,end_at,status,calculated_tuition,calculated_teacher_fee,room_display_snapshot,notes,legacy_deleted,created_at,updated_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Keep fixture room','Keep fixture notes',false,$9,$9)`, [row.id, tenantId, row.course_id, row.start_time, row.end_time, row.status, row.calculated_tuition, row.calculated_teacher_fee, row.updated_at]);
          for (const pricing of row.student_pricings) await db.query('INSERT INTO business.schedule_student_overrides(tenant_id,schedule_id,student_id,tuition,teacher_fee,attendance_status) VALUES($1,$2,$3,$4,$5,$6)', [tenantId, row.id, pricing.student_id, pricing.tuition, pricing.teacher_fee, pricing.attendance_status ?? pricing.status ?? 1]);
        }
      });
      const capturedBefore = await allRows();
      const roster = () => withQuery(handle, 'fixture-provisioner', async db => (await db.query('SELECT to_jsonb(o) AS row FROM business.schedule_student_overrides o ORDER BY tenant_id,schedule_id,student_id')).rows);
      const rosterBefore = await roster();
      const bad = structuredClone(plan.candidates); bad[bad.length - 1].expectedUpdatedAt = '2000-01-01T00:00:00Z';
      await assert.rejects(() => transaction(db => restoreScheduleSnapshotsInTransaction(db, { tenantId, candidates: bad })), /SNAPSHOT_RECOVERY_VERSION_CONFLICT/);
      assert.deepEqual(await allRows(), capturedBefore);
      await transaction(async db => {
        const result = await restoreScheduleSnapshotsInTransaction(db, { tenantId, candidates: plan.candidates });
        assert.equal(result.applied.length, plan.candidates.length);
      }, false);
      assert.deepEqual(await allRows(), capturedBefore);
      const result = await transaction(db => restoreScheduleSnapshotsInTransaction(db, { tenantId, candidates: plan.candidates }));
      assert.equal(result.applied.length, plan.candidates.length);
      const capturedAfter = await allRows(), expected = new Map(plan.candidates.map(item => [item.id, item.patch]));
      for (let i = 0; i < capturedAfter.length; i++) {
        const patch = expected.get(capturedAfter[i].id);
        if (!patch) { assert.deepEqual(capturedAfter[i], capturedBefore[i]); continue; }
        for (const key of Object.keys(capturedBefore[i])) if (![...Object.keys(patch), 'updated_at'].includes(key)) assert.deepEqual(capturedAfter[i][key], capturedBefore[i][key]);
        for (const key of Object.keys(patch)) assert.equal(capturedAfter[i][key], patch[key]);
      }
      assert.deepEqual(await roster(), rosterBefore);
      const again = await transaction(db => restoreScheduleSnapshotsInTransaction(db, { tenantId, candidates: plan.candidates }));
      assert.equal(again.applied.length, 0); assert.equal(again.alreadyRestored.length, plan.candidates.length);
      assert.deepEqual(await allRows(), capturedAfter);
      const undoneResult = await transaction(db => rollbackScheduleSnapshotsInTransaction(db, result));
      assert.equal(undoneResult.rolledBack.length, plan.candidates.length);
      const rollbackRows = await allRows();
      for (let i = 0; i < rollbackRows.length; i++) for (const key of Object.keys(capturedBefore[i])) if (key !== 'updated_at') assert.deepEqual(rollbackRows[i][key], capturedBefore[i][key]);
      assert.deepEqual(await roster(), rosterBefore);
      const evidence = { sourcePlanSha256, database: 'disposable-local-postgresql', productionWrite: false, fullDatabaseClone: false,
        candidateCount: plan.candidates.length, appliedInIsolatedDatabase: result.applied.length, repeatedWithoutWrites: again.alreadyRestored.length,
        preciseVersionConflictRejected: true, rollbackRestoredRows: true, committedRestoreRolledBack: undoneResult.rolledBack.length,
        laterEditProtectedDuringRollback: true, nonSnapshotFieldsUnchanged: true, rosterUnchanged: true };
      const evidencePath = path.join(capture, `snapshot-recovery-postgres-${Date.now()}.json`);
      fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), { encoding: 'utf8', flag: 'wx' });
      console.log(JSON.stringify({ ...evidence, evidencePath }));
    }
    console.log('schedule snapshot isolated PostgreSQL recovery, precise conflicts, retry and rollback checks passed');
  } finally { try { await runtime.disposeHandle(handle); } finally { await runtime.stop(); } }
}
test().catch(error => { console.error(process.argv[2] ? String(error.code || error.message) : error); process.exitCode = 1; });
