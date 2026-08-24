'use strict';

const TABLES = Object.freeze([
  ['students', 'students'],
  ['studentContacts', 'studentContacts'],
  ['teachers', 'teachers'],
  ['courses', 'courses'],
  ['schedules', 'schedules'],
  ['institutions', 'institutions'],
  ['schools', 'schools'],
  ['rooms', 'rooms'],
  ['assetRecords', 'assetRecords'],
  ['assetCategories', 'assetCategories'],
]);

const SHANGHAI_DATE_TIME = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hourCycle: 'h23',
});

function cloudScheduleDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const parts = Object.fromEntries(SHANGHAI_DATE_TIME.formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

function shanghaiDateKey(value) {
  const normalized = cloudScheduleDateTime(value);
  return typeof normalized === 'string' && /^\d{4}-\d{2}-\d{2}T/u.test(normalized)
    ? normalized.slice(0, 10)
    : '';
}

function normalizeProjection(projection) {
  return {
    ...projection,
    schedules: projection.schedules.map(schedule => ({
      ...schedule,
      start_time: cloudScheduleDateTime(schedule.start_time),
      end_time: cloudScheduleDateTime(schedule.end_time),
    })),
  };
}

function validProjection(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && TABLES.every(([key]) => Array.isArray(value[key]));
}

function createCloudBusinessProjectionRuntime({ readProjection, writeCache }) {
  if (typeof readProjection !== 'function' || typeof writeCache !== 'function') throw new TypeError('cloud business projection dependencies are required');
  return Object.freeze({
    async refresh(token) {
      if (typeof token !== 'string' || !token.trim()) throw new TypeError('cloud business session is required');
      const response = await readProjection(token);
      const projection = response?.success === true && response?.data?.ok === true ? response.data.projection : null;
      if (!validProjection(projection)) throw new Error('CLOUD_BUSINESS_PROJECTION_UNAVAILABLE');
      const normalized = normalizeProjection(projection);
      TABLES.forEach(([projectionKey, cacheKey]) => writeCache(cacheKey, normalized[projectionKey]));
      writeCache('payments', []);
      writeCache('grades', []);
      return normalized;
    },
  });
}

module.exports = Object.freeze({ cloudScheduleDateTime, shanghaiDateKey, createCloudBusinessProjectionRuntime });
