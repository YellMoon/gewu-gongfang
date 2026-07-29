const assert = require('assert');

let cache = {};
try {
  cache = require('./authorityProjectionCache');
} catch (_error) {
  // The assertions below define the initial contract.
}

assert.strictEqual(typeof cache.projectionCacheEntries, 'function');

const entries = cache.projectionCacheEntries({
  students: [{ id: 'student-1' }],
  rooms: [{ id: 'room-1' }],
  assetRecords: [{ id: 'asset-record-1' }],
  questions: [{ id: 'question-1', stem: 'full' }],
  questionPreviews: [{ id: 'preview-ignored' }],
  unexpected: [{ id: 'must-not-cache' }],
});

assert.deepStrictEqual(entries, [
  ['students', [{ id: 'student-1' }]],
  ['rooms', [{ id: 'room-1' }]],
  ['assetRecords', [{ id: 'asset-record-1' }]],
  ['questions', [{ id: 'question-1', stem: 'full' }]],
]);

assert.deepStrictEqual(cache.projectionCacheEntries({ questionPreviews: [{ id: 'preview-1' }] }), [
  ['questions', [{ id: 'preview-1' }]],
]);
assert.deepStrictEqual(cache.projectionCacheEntries(null), []);

console.log('authorityProjectionCache tests passed');
