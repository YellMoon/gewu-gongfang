const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync(require.resolve('./QuestionBankPaper.tsx'), 'utf8');

assert.ok(source.includes('await db?.refreshAuthorityProjection?.()'),
  'paper composition must refresh the authenticated cloud projection before looking up basket questions');
assert.ok(!source.includes('fetch(`${API_BASE}/questions?limit=1000`)'),
  'paper composition must not read questions from the retired embedded backend');
assert.ok(source.includes('layout: { items: items.map(item => ({ id: item.question.id, sectionTitle: item.sectionTitle, score: item.score })) }'),
  'paper composition must submit the edited ordering, grouping, and scores to the cloud export contract');
assert.ok(source.includes('const removeItem = (uid: string) =>'),
  'paper composition must let an editor remove an item without leaving the shared basket stale');
assert.ok(source.includes('setQuestionBasket(currentBasketIds.filter(id => id !== target.question.id))'),
  'removing an item must synchronise the shared basket used by the question bank');
assert.ok(source.includes('String.fromCharCode(31227, 38500)'),
  'paper composition must expose a visible remove action next to the editing controls');

console.log('question bank paper cloud read checks passed');
