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
      TABLES.forEach(([projectionKey, cacheKey]) => writeCache(cacheKey, projection[projectionKey]));
      writeCache('payments', []);
      writeCache('grades', []);
      return projection;
    },
  });
}

module.exports = Object.freeze({ createCloudBusinessProjectionRuntime });
