const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync(require.resolve('./QuestionBankPaper.tsx'), 'utf8');

assert.ok(source.includes('await db?.refreshAuthorityProjection?.()'),
  'paper composition must refresh the authenticated cloud projection before looking up basket questions');
assert.ok(!source.includes('fetch(`${API_BASE}/questions?limit=1000`)'),
  'paper composition must not read questions from the retired embedded backend');

console.log('question bank paper cloud read checks passed');
