const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync(require.resolve('./QuestionBankPaper.tsx'), 'utf8');

assert.ok(source.includes('await db?.refreshAuthorityProjection?.()'),
  'paper composition must refresh the authenticated cloud projection before looking up basket questions');
assert.ok(!source.includes('fetch(`${API_BASE}/questions?limit=1000`)'),
  'paper composition must not read questions from the retired embedded backend');
assert.ok(source.includes('layout: { items: items.map(item => ({ id: item.question.id, sectionTitle: item.sectionTitle, score: item.score })) }'),
  'paper composition must submit the edited ordering, grouping, and scores to the cloud export contract');

console.log('question bank paper cloud read checks passed');
