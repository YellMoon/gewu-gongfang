'use strict';

const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync(require.resolve('./QuestionPreviewCard.tsx'), 'utf8');

assert.ok(source.includes('onToggleBasket'), 'question cards must accept a direct basket action');
assert.ok(source.includes('inBasket ?'), 'the card action must render a distinct selected-basket state');
assert.ok(source.includes("String.fromCharCode(31227, 20986, 35797, 39064, 34013)"), 'the selected-basket action must state that clicking removes the question');
assert.ok(source.includes('ShoppingCartOutlined'), 'the direct basket action must remain visually identifiable');

console.log('question preview card basket action checks passed');
