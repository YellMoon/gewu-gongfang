'use strict';

const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync(require.resolve('./QuestionPreviewCard.tsx'), 'utf8');

assert.ok(source.includes('onToggleBasket'), 'question cards must accept a direct basket action');
assert.ok(source.includes('inBasket ?'), 'the card action must render a distinct selected-basket state');
assert.ok(source.includes('String.fromCharCode(31227, 20986, 35797, 39064, 34013)'), 'the selected-basket action must state that clicking removes the question');
assert.ok(source.includes('ShoppingCartOutlined'), 'the direct basket action must remain visually identifiable');
assert.ok(source.includes('showAnswer = false'), 'desktop question cards must keep answers and explanations collapsed by default');
assert.ok(!source.includes('qb-answer-button'), 'only clicking the question area toggles answers; no separate answer button');
assert.ok(
  source.includes('visited && children'),
  'answers must render lazily when first opened',
);
assert.ok(
  source.includes('open={answerExpanded}') && source.includes('showAnswer answerOnly'),
  'structured questions must use the same animated card-level drawer as ordinary questions',
);

console.log('question preview card answer and basket action checks passed');

require('./QuestionPreviewCard.interaction.test.js');
