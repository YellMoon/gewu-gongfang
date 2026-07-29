const TABLE_KEYS = Object.freeze([
  'students',
  'courses',
  'schedules',
  'payments',
  'consumptions',
  'teachers',
  'grades',
  'rooms',
  'institutions',
  'assetRecords',
  'assetCategories',
]);

function rows(value) {
  return Array.isArray(value) ? value : [];
}

function projectionCacheEntries(payload) {
  if (!payload || typeof payload !== 'object') return [];
  const entries = TABLE_KEYS
    .filter(table => Array.isArray(payload[table]))
    .map(table => [table, rows(payload[table])]);
  if (Array.isArray(payload.questions)) {
    entries.push(['questions', rows(payload.questions)]);
  } else if (Array.isArray(payload.questionPreviews)) {
    entries.push(['questions', rows(payload.questionPreviews)]);
  }
  return entries;
}

module.exports = {
  projectionCacheEntries,
  projectionCacheTables: Object.freeze([...TABLE_KEYS, 'questions']),
};
