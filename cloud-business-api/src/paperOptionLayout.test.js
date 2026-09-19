'use strict';
const assert = require('node:assert/strict');
const { columnsForOptions, normalizeOptions } = require('../../src/utils/questionOptions.ts');
const { paperOptionColumns } = require('./paperOptionLayout');
for (const count of [0, 1, 2, 3, 4, 5, 7]) {
  for (const content of ['x', 'x'.repeat(12), 'x'.repeat(13), 'x'.repeat(28), 'x'.repeat(29), '\u4e2d'.repeat(12), '\ud83d\ude00'.repeat(13), '<img src="asset.png">', '&amp; '.repeat(7)]) {
    const options = Array.from({ length: count }, (_, index) => ({ label: String.fromCharCode(65 + index), content }));
    assert.equal(paperOptionColumns(options), columnsForOptions(normalizeOptions(options)), `desktop parity: ${count} / ${content}`);
  }
}
const contents = [
  { type: 'text', text: 'x'.repeat(12) },
  { type: 'formula', attrs: { canonicalLatex: '\\frac{1}{2}' } },
  { type: 'image', attrs: {} },
];
for (const node of contents) {
  const options = Array.from({ length: 4 }, (_, index) => ({ label: String.fromCharCode(65 + index), content: { type: 'doc', content: [{ type: 'paragraph', content: [node] }] } }));
  const text = node.type === 'text' ? node.text : node.type === 'image' ? '[image]' : node.attrs.canonicalLatex;
  assert.equal(paperOptionColumns(options), columnsForOptions(options.map(option => ({ label: option.label, content: text }))));
}
console.log('paper option layout matches desktop option rules');
