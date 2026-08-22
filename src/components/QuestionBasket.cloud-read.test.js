const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync(require.resolve('./QuestionBasket.tsx'), 'utf8');

assert.ok(source.includes('await db?.refreshAuthorityProjection?.()'),
  'the question basket must refresh the authenticated cloud projection before resolving selected questions');
assert.ok(!source.includes('fetch(`${API_BASE}/questions?limit=1000`)'),
  'the question basket must not read questions from the retired embedded backend');

console.log('question basket cloud read checks passed');
