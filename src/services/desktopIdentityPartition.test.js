const assert = require('assert');
const fs = require('fs');

(async function () {
  const {
    partitionedStorageKey,
    migrateLegacyStorageValue,
    readCurrentDesktopIdentityContext,
    readCurrentDesktopIdentityPartition,
    setCurrentDesktopIdentityContext,
    setCurrentDesktopIdentityPartition,
  } = await import('./desktopIdentityPartition.mjs');

  const target = {};
  assert.throws(
    () => readCurrentDesktopIdentityPartition(target),
    error => error.code === 'DESKTOP_IDENTITY_PARTITION_REQUIRED'
  );
  setCurrentDesktopIdentityContext({
    userId: 'canonical-human',
    activeRole: 'teacher',
    teacherId: 'teacher-self',
    partitionKey: 'canonical-human:teacher:teacher-self',
    offline: true,
  }, target);
  const values = new Map([
    ['sync_engine_sync_device_id', JSON.stringify('legacy-device')],
    ['sync_engine_sync_pending_changes', JSON.stringify([{ id: 'legacy-change' }])],
  ]);
  const storage = {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  };
  assert.strictEqual(
    migrateLegacyStorageValue(storage, 'sync_engine_sync_device_id', { target, allowRoles: 'all' }),
    JSON.stringify('legacy-device')
  );
  assert.strictEqual(
    migrateLegacyStorageValue(storage, 'sync_engine_sync_pending_changes', {
      target,
      allowRoles: ['super_admin', 'admin'],
    }),
    null,
    'teacher partition must not inherit an unscoped legacy mutation queue'
  );
  setCurrentDesktopIdentityContext({
    userId: 'canonical-human',
    activeRole: 'super_admin',
    partitionKey: 'canonical-human:super_admin:all',
  }, target);
  assert.strictEqual(
    migrateLegacyStorageValue(storage, 'sync_engine_sync_pending_changes', {
      target,
      allowRoles: ['super_admin', 'admin'],
    }),
    JSON.stringify([{ id: 'legacy-change' }])
  );
  setCurrentDesktopIdentityPartition('canonical-human:teacher:teacher-self', target);
  assert.strictEqual(
    readCurrentDesktopIdentityPartition(target),
    'canonical-human:teacher:teacher-self'
  );
  assert.strictEqual(
    partitionedStorageKey('scheduling_system_db_v3', target),
    'scheduling_system_db_v3::canonical-human%3Ateacher%3Ateacher-self'
  );
  setCurrentDesktopIdentityContext({
    userId: 'canonical-human',
    activeRole: 'teacher',
    teacherId: 'teacher-self',
    partitionKey: 'canonical-human:teacher:teacher-self',
    offline: true,
  }, target);
  assert.deepStrictEqual(
    { ...readCurrentDesktopIdentityContext(target) },
    {
      userId: 'canonical-human',
      activeRole: 'teacher',
      teacherId: 'teacher-self',
      studentId: null,
      partitionKey: 'canonical-human:teacher:teacher-self',
      offline: true,
    }
  );
  setCurrentDesktopIdentityPartition('canonical-human:super_admin:all', target);
  assert.strictEqual(
    partitionedStorageKey('scheduling_system_db_v3', target),
    'scheduling_system_db_v3::canonical-human%3Asuper_admin%3Aall'
  );
  assert.throws(
    () => setCurrentDesktopIdentityPartition('../unsafe', target),
    error => error.code === 'DESKTOP_IDENTITY_PARTITION_INVALID'
  );

  const browserDatabase = fs.readFileSync('src/services/browserDatabase.ts', 'utf8');
  const questionStore = fs.readFileSync('src/services/questionLocalStore.ts', 'utf8');
  const syncEngine = fs.readFileSync('src/services/syncEngine.ts', 'utf8');
  assert.ok(browserDatabase.includes('partitionedStorageKey'));
  assert.ok(browserDatabase.includes('switchIdentityPartition'));
  assert.ok(browserDatabase.includes('prepareIdentityPartitionChange'));
  assert.ok(!browserDatabase.includes("private storageKey = 'scheduling_system_db_v3'"));
  assert.ok(questionStore.includes("partitionedStorageKey('question_local_store_v1'"));
  assert.ok(syncEngine.includes("partitionedStorageKey('sync_engine_' + key)"));
  console.log('desktop identity partition checks passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
