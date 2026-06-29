const LEGACY_SCHEDULE_STORAGE_KEYS = ['schedules', 'scheduleCalendar'];
const MIGRATION_FLAG_KEY = 'schedules_migrated_to_db_v1';

function safeParseScheduleList(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function getStorage(storage) {
  if (storage) return storage;
  if (typeof window !== 'undefined') return window.localStorage;
  return null;
}

function getLegacySchedules(storage) {
  const store = getStorage(storage);
  if (!store) return [];
  const merged = [];
  const seen = new Set();
  LEGACY_SCHEDULE_STORAGE_KEYS.forEach((key) => {
    safeParseScheduleList(store.getItem(key)).forEach((schedule) => {
      if (!schedule?.id || seen.has(schedule.id)) return;
      seen.add(schedule.id);
      merged.push(schedule);
    });
  });
  return merged;
}

function mirrorSchedulesToLegacyCache(schedules, storage) {
  const store = getStorage(storage);
  if (!store) return;
  store.setItem('schedules', JSON.stringify(schedules || []));
  store.removeItem('scheduleCalendar');
}

function upsertSchedule(db, schedule) {
  if (!db || !schedule?.id) return;
  if (db.upsertSchedule) {
    db.upsertSchedule(schedule);
    return;
  }
  const existing = db.getScheduleById?.(schedule.id);
  if (existing && db.updateSchedule) {
    db.updateSchedule(schedule.id, schedule);
  }
}

function migrateLegacySchedulesToDatabase(db, storage) {
  const store = getStorage(storage);
  if (!db?.getAllSchedules || !store) return db?.getAllSchedules?.() || [];
  const legacySchedules = getLegacySchedules(store);
  if (store.getItem(MIGRATION_FLAG_KEY) === 'true') {
    const schedules = db.getAllSchedules() || [];
    if (schedules.length === 0 && legacySchedules.length > 0) {
      legacySchedules.forEach((schedule) => upsertSchedule(db, schedule));
      const recovered = db.getAllSchedules() || legacySchedules;
      mirrorSchedulesToLegacyCache(recovered, store);
      return recovered;
    }
    mirrorSchedulesToLegacyCache(schedules, store);
    return schedules;
  }

  const existingIds = new Set((db.getAllSchedules() || []).map((schedule) => schedule.id));
  legacySchedules.forEach((schedule) => {
    if (!schedule?.id || existingIds.has(schedule.id)) return;
    upsertSchedule(db, schedule);
    existingIds.add(schedule.id);
  });

  store.setItem(MIGRATION_FLAG_KEY, 'true');
  const schedules = db.getAllSchedules() || [];
  mirrorSchedulesToLegacyCache(schedules, store);
  return schedules;
}

function readSchedulesFromPrimaryStore(db, storage) {
  if (!db?.getAllSchedules) return [];
  return migrateLegacySchedulesToDatabase(db, storage);
}

function replaceSchedulesInPrimaryStore(db, schedules, storage, options = {}) {
  const current = db?.getAllSchedules?.() || [];
  const next = schedules || [];
  if (!options.allowEmptyReplace && next.length === 0 && current.length > 0) {
    mirrorSchedulesToLegacyCache(current, storage);
    return current;
  }

  if (db?.replaceSchedules) {
    const saved = db.replaceSchedules(next);
    mirrorSchedulesToLegacyCache(saved, storage);
    return saved;
  }

  const nextIds = new Set(next.map((schedule) => schedule.id).filter(Boolean));
  current.forEach((schedule) => {
    if (schedule?.id && !nextIds.has(schedule.id)) {
      db.deleteSchedule?.(schedule.id);
    }
  });
  next.forEach((schedule) => upsertSchedule(db, schedule));
  const saved = db?.getAllSchedules?.() || next;
  mirrorSchedulesToLegacyCache(saved, storage);
  return saved;
}

export {
  LEGACY_SCHEDULE_STORAGE_KEYS,
  MIGRATION_FLAG_KEY,
  readSchedulesFromPrimaryStore,
  replaceSchedulesInPrimaryStore,
  mirrorSchedulesToLegacyCache,
};
