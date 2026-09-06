'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = ts.createSourceFile('QuestionBankPreview.tsx', fs.readFileSync(path.join(__dirname, 'QuestionBankPreview.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'jumpToQuestionPage') callback = node.initializer.arguments[0];
  ts.forEachChild(node, visit);
}
visit(source);
assert(callback, 'exercise the real page callback');
const executable = ts.transpileModule(`const jump = ${callback.getText(source)}; jump(2);`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
for (const nested of [true, false]) {
  const calls = [];
  const frames = [];
  vm.runInNewContext(executable, {
    setCurrentPage: page => calls.push(['page', page]),
    requestAnimationFrame: frame => frames.push(frame),
    document: { querySelector: selector => {
      assert.equal(selector, '.app-shell__content');
      return nested ? { scrollTo: options => calls.push(['content', options.top, options.behavior]) } : null;
    } },
    window: { scrollTo: options => calls.push(['window', options.top, options.behavior]) },
  });
  assert.deepEqual(calls, [['page', 2]]);
  assert.equal(frames.length, 1);
  frames[0]();
  assert.deepEqual(calls, [['page', 2], [nested ? 'content' : 'window', 0, 'auto']]);
}
console.log('question pagination scroll checks passed');
