const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync(require.resolve('./QuestionBankEdit.tsx'), 'utf8');

assert.ok(source.includes('await db?.refreshAuthorityProjection?.()'),
  'question editing must refresh the authenticated cloud projection before indexing local records');
assert.ok(!source.includes('fetch(`${API_BASE}/questions?limit=500`)'),
  'question editing must not read questions from the retired embedded backend');
assert.ok(!source.includes('persistRemoteThenLocal('),
  'question edits must create encrypted drafts instead of directly writing to the retired embedded backend');

console.log('question bank edit cloud authority checks passed');
