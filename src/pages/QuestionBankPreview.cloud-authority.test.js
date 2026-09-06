require('../services/questionLocalStore.subject.test');
const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync(require.resolve('./QuestionBankPreview.tsx'), 'utf8');

assert.strictEqual((source.match(/>试题库<\/h2>/gu) || []).length, 0,
  'the page header already names the question bank, so the content toolbar must not repeat the same heading');

assert.ok(source.includes('await db?.refreshAuthorityProjection?.({ notifyConsumers: false })'),
  'question preview must refresh the authenticated cloud projection before indexing local records');
assert.ok(source.includes('db.deleteCloudCachedQuestion'),
  'cloud-cached questions must create encrypted delete drafts instead of calling the retired embedded backend');
assert.ok(!source.includes('persistRemoteThenLocal('),
  'question preview edits must create encrypted drafts instead of directly writing to the retired embedded backend');
assert.ok(!source.includes("getApiBase('/api/question-bank')") && !source.includes('/storage/status'),
  'question preview must not depend on an embedded host or removable-disk storage status');
assert.ok(source.includes("new CustomEvent('navigate-page', { detail: 'question-bank-paper' })"),
  'batch selection must enter the shared paper editor');
assert.ok(source.includes('onToggleBasket={() => toggleQuestionBasket(q.id)}'),
  'every desktop question card must offer a direct add-or-remove basket action');
assert.ok(!source.includes('downloadAsWord(') && !source.includes('generateExamWord('),
  'question preview must not bypass the cloud export task with a browser-local Word file');
assert.ok(!source.includes('/api/permissions/my'),
  'question preview must not ask the embedded database to authorize a cloud question operation');
assert.ok(source.includes('normalizeDesktopQuestionDeleteContext(readDesktopAuthorizationSession())'),
  'question preview must derive its delete context from the verified cloud desktop session');

console.log('question bank preview cloud authority checks passed');
require('./QuestionBankPreview.pagination.test');
