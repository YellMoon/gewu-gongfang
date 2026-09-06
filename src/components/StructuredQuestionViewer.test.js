'use strict';
require('./QuestionFormulaContent.test');

const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync(require.resolve('./StructuredQuestionViewer.tsx'), 'utf8');

assert.ok(
  source.includes('showAnswer = false'),
  'structured questions must not reveal answer content unless the caller explicitly expands it',
);
assert.ok(
  source.includes('columnsForOptions'),
  'structured desktop options must reuse the ordinary-question column rules',
);
assert.ok(
  source.includes('normalizeOptionLabel'),
  'structured desktop option labels must reuse the ordinary-question numbering rules',
);

console.log('structured question viewer display contract checks passed');
