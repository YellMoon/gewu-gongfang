const assert = require('assert');
const fs = require('fs');
const path = require('path');

const legacyPagePath = path.join(__dirname, 'QuestionBank.tsx');
const activePagePath = require.resolve('./QuestionBankPreview.tsx');
const activeSource = fs.readFileSync(activePagePath, 'utf8');

assert.ok(!fs.existsSync(legacyPagePath),
  'the unreachable legacy question-bank page must be removed instead of retaining a local HTTP import path');
assert.ok(activeSource.includes('db?.refreshAuthorityProjection?.()'),
  'the active question list must refresh the cloud authority projection before reading its local encrypted cache');
assert.ok(!activeSource.includes('/api/question-bank'),
  'the active question list must not call the retired embedded-backend question endpoint');

console.log('question bank cloud read checks passed');
