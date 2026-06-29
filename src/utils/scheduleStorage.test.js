const assert = require('assert');

async function main() {
  const {
    MIGRATION_FLAG_KEY,
    readSchedulesFromPrimaryStore,
    replaceSchedulesInPrimaryStore,
  } = await import('./scheduleStorage.mjs');

  function createStorage(initial = {}) {
    const data = new Map(Object.entries(initial));
    return {
      getItem: key => data.has(key) ? data.get(key) : null,
      setItem: (key, value) => data.set(key, String(value)),
      removeItem: key => data.delete(key),
      dump: () => Object.fromEntries(data.entries()),
    };
  }

  function createDb(initialSchedules = []) {
    let schedules = [...initialSchedules];
    return {
      getAllSchedules: () => schedules,
      upsertSchedule: schedule => {
        const index = schedules.findIndex(item => item.id === schedule.id);
        if (index >= 0) schedules[index] = { ...schedules[index], ...schedule };
        else schedules.push(schedule);
        return schedule;
      },
      replaceSchedules: next => {
        schedules = [...next];
        return schedules;
      },
    };
  }

  const legacySchedule = { id: 'schedule_legacy_1', course_id: 'course_1', start_time: '2026-06-29 10:00', end_time: '2026-06-29 12:00' };
  const storage = createStorage({
    [MIGRATION_FLAG_KEY]: 'true',
    schedules: JSON.stringify([legacySchedule]),
  });
  const emptyDb = createDb([]);

  const recovered = readSchedulesFromPrimaryStore(emptyDb, storage);
  assert.strictEqual(recovered.length, 1, 'empty primary store should recover non-empty legacy schedule cache');
  assert.strictEqual(recovered[0].id, legacySchedule.id, 'recovered schedule id should match legacy cache');
  assert.strictEqual(emptyDb.getAllSchedules().length, 1, 'recovered legacy schedules should be upserted into primary db');

  const protectedStorage = createStorage({
    schedules: JSON.stringify([legacySchedule]),
  });
  const protectedDb = createDb([legacySchedule]);
  const protectedResult = replaceSchedulesInPrimaryStore(protectedDb, [], protectedStorage);
  assert.strictEqual(protectedResult.length, 1, 'default replace should not allow an empty snapshot to wipe non-empty schedules');
  assert.strictEqual(JSON.parse(protectedStorage.dump().schedules).length, 1, 'legacy cache should not be overwritten by a protected empty snapshot');

  const explicitResult = replaceSchedulesInPrimaryStore(protectedDb, [], protectedStorage, { allowEmptyReplace: true });
  assert.strictEqual(explicitResult.length, 0, 'explicit empty replace should still support intentional delete-all operations');

  console.log('scheduleStorage checks passed');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
