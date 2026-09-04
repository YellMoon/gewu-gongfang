'use strict';

const assert = require('assert');
const { parseArguments, repairFixedSuperAdminBusiness } = require('./repairFixedSuperAdminBusiness');

const identity = Object.freeze({ authorityId: 'authority-fixed', accountId: 'account-fixed', phoneHmac: 'a'.repeat(64) });

function fakeClient(initial) {
  const current = { ...initial };
  const calls = [];
  let snapshot = null;
  return {
    calls,
    current,
    async query(sql, values) {
      calls.push([sql, values]);
      if (/^BEGIN/u.test(sql)) snapshot = { ...current };
      if (sql === 'ROLLBACK' && snapshot) Object.assign(current, snapshot);
      if (/^UPDATE business\.miniapp_cloud_role_grants/u.test(sql)) {
        const changed = current.extraActiveSuperAdminCount;
        current.activeSuperAdminCount -= changed;
        current.extraActiveSuperAdminCount = 0;
        return { rows: [], rowCount: changed };
      }
      if (/^SELECT/u.test(sql)) return { rows: [{ ...current }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
  };
}

assert.deepStrictEqual(parseArguments([]), { repair: false, rollback: false, backupEvidenceProvided: false });
assert.deepStrictEqual(parseArguments(['--repair', '--backup-sha256', 'b'.repeat(64)]), {
  repair: true, rollback: false, backupEvidenceProvided: true,
});
assert.deepStrictEqual(parseArguments(['--repair', '--rollback', '--backup-sha256', 'b'.repeat(64)]), {
  repair: true, rollback: true, backupEvidenceProvided: true,
});
assert.throws(() => parseArguments(['--repair']), error => error?.code === 'CLOUD_FIXED_SUPER_ADMIN_REPAIR_BACKUP_REQUIRED');
assert.throws(() => parseArguments(['--rollback']), error => error?.code === 'CLOUD_FIXED_SUPER_ADMIN_REPAIR_CONFIG_INVALID');

(async () => {
  const initial = {
    activeSuperAdminCount: 2,
    fixedActiveSuperAdminCount: 1,
    extraActiveSuperAdminCount: 1,
    fixedActiveAccountCount: 1,
  };
  const reporter = fakeClient(initial);
  const report = await repairFixedSuperAdminBusiness({ client: reporter, identity });
  assert.strictEqual(report.mode, 'report');
  assert.strictEqual(report.committed, false);
  assert.strictEqual(report.extraActiveSuperAdminCountBefore, 1);
  assert.deepStrictEqual(reporter.current, initial, 'the default report must not mutate role grants');

  const rehearsal = fakeClient(initial);
  const rolledBack = await repairFixedSuperAdminBusiness({
    client: rehearsal, identity, repair: true, rollback: true, backupEvidenceProvided: true,
  });
  assert.strictEqual(rolledBack.mode, 'repair_rollback');
  assert.strictEqual(rolledBack.revokedGrantCount, 1);
  assert.strictEqual(rolledBack.committed, false);
  assert.deepStrictEqual(rehearsal.current, initial, 'the rollback rehearsal must leave production state unchanged');

  const writer = fakeClient(initial);
  const repaired = await repairFixedSuperAdminBusiness({
    client: writer, identity, repair: true, backupEvidenceProvided: true,
  });
  assert.strictEqual(repaired.mode, 'repair');
  assert.strictEqual(repaired.committed, true);
  assert.strictEqual(repaired.activeSuperAdminCountAfter, 1);
  assert.strictEqual(repaired.extraActiveSuperAdminCountAfter, 0);
  assert.deepStrictEqual(writer.current, { ...initial, activeSuperAdminCount: 1, extraActiveSuperAdminCount: 0 });
  assert.doesNotMatch(JSON.stringify(repaired), /account-fixed|authority-fixed|a{64}/u, 'audit output must contain counts only');

  const idempotent = await repairFixedSuperAdminBusiness({
    client: writer, identity, repair: true, backupEvidenceProvided: true,
  });
  assert.strictEqual(idempotent.revokedGrantCount, 0);
  assert.strictEqual(idempotent.activeSuperAdminCountAfter, 1);

  const unsafe = fakeClient({ ...initial, fixedActiveAccountCount: 0 });
  await assert.rejects(
    () => repairFixedSuperAdminBusiness({ client: unsafe, identity, repair: true, backupEvidenceProvided: true }),
    error => error?.code === 'CLOUD_FIXED_SUPER_ADMIN_REPAIR_UNSAFE',
  );
  assert.deepStrictEqual(unsafe.current, { ...initial, fixedActiveAccountCount: 0 });
  console.log('fixed super administrator business repair checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
