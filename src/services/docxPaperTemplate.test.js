const assert = require('assert');
const { QUESTION_PAPER_TEMPLATE, isChoiceOptionText } = require('./docxPaperTemplate');

assert.deepStrictEqual(QUESTION_PAPER_TEMPLATE.page.margin, {
  top: 1418,
  bottom: 1134,
  left: 1134,
  right: 1134,
  header: 454,
  footer: 850,
});
assert.strictEqual(QUESTION_PAPER_TEMPLATE.option.leftIndent, 420);
assert.strictEqual(QUESTION_PAPER_TEMPLATE.size.title, 30);
assert.strictEqual(isChoiceOptionText('A．速度增大'), true);
assert.strictEqual(isChoiceOptionText('1．题干内容'), false);

console.log('docxPaperTemplate tests passed');
