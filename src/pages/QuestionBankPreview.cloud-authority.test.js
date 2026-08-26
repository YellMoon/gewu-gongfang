const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync(require.resolve('./QuestionBankPreview.tsx'), 'utf8');

assert.ok(source.includes('await db?.refreshAuthorityProjection?.()'),
  'question preview must refresh the authenticated cloud projection before indexing local records');
assert.ok(source.includes('db.deleteCloudCachedQuestion'),
  'cloud-cached questions must create encrypted delete drafts instead of calling the retired embedded backend');
assert.ok(!source.includes('persistRemoteThenLocal('),
  'question preview edits must create encrypted drafts instead of directly writing to the retired embedded backend');
assert.ok(!source.includes("getApiBase('/api/question-bank')") && !source.includes('/storage/status'),
  'question preview must not depend on an embedded host or removable-disk storage status');
assert.ok(source.includes("new CustomEvent('navigate-page', { detail: 'question-bank-paper' })"),
  'batch selection must enter the shared paper editor');
assert.ok(!source.includes('downloadAsWord(') && !source.includes('generateExamWord('),
  'question preview must not bypass the cloud export task with a browser-local Word file');

console.log('question bank preview cloud authority checks passed');
