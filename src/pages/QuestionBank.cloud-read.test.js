const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync(require.resolve('./QuestionBank.tsx'), 'utf8');

assert.ok(source.includes('db.refreshAuthorityProjection?.()'),
  'the question list must refresh the cloud authority projection before reading its local encrypted cache');
assert.ok(!source.includes('fetch(`${API_BASE}/questions?limit=200`)'),
  'the question list must not fall back to the retired embedded-backend question endpoint');

console.log('question bank cloud read checks passed');
