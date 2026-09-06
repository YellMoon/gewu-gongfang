'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
function load(file) {
  const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, require: name => {
    if (name === './QuestionFormulaContent') return load('QuestionFormulaContent.tsx');
    if (name === './RichAssetImage') return { RichAssetImage: props => React.createElement('img', props) };
    if (name === '../utils/questionOptions') return require('../utils/questionOptions.ts');
    return require(name);
  } });
  return module.exports;
}
const { QuestionFormulaContent } = load('QuestionFormulaContent.tsx');
const pending = renderToStaticMarkup(React.createElement(QuestionFormulaContent, { latex: '' }));
assert(pending.includes('[\u516c\u5f0f\u5f85\u8865\u5168]'));
assert(pending.includes('role="status"'));
assert(!pending.includes('katex'));
const block = renderToStaticMarkup(React.createElement(QuestionFormulaContent, { latex: 'x^2', block: true }));
assert(block.includes('katex-display'));
const Viewer = load('StructuredQuestionViewer.tsx').default;
const doc = content => ({ type: 'doc', content });
const value = { sections: { stem: doc([{ type: 'formulaBlock', attrs: { canonicalLatex: 'x^2', displayMode: 'block' } }]),
  answer: doc([{ type: 'formula', attrs: { canonicalLatex: null, conversionStatus: 'preview_only', previewRef: 'word/media/image67.wmf' } }]),
  analysis: doc([]), options: [], subQuestions: [] } };
const hidden = renderToStaticMarkup(React.createElement(Viewer, { value }));
assert(hidden.includes('katex-display'));
assert(!hidden.includes('question-formula-pending'));
const expanded = renderToStaticMarkup(React.createElement(Viewer, { value, showAnswer: true }));
assert(expanded.includes('question-formula-pending'));
assert(!expanded.includes('src="word/'));
const markedValue = { sections: { ...value.sections, options: [], subQuestions: [],
  stem: doc([{type:'paragraph',content:[
    {type:'text',text:'v'}, {type:'text',text:'0',marks:[{type:'subscript'}]},
    {type:'text',text:' + 3 m/s'}, {type:'text',text:'2',marks:[{type:'superscript'}]},
    {type:'text',text:'<unsafe>',marks:[{type:'superscript'},{type:'italic'}]},
  ]}]),answer:doc([]),analysis:doc([]) } };
const marked = renderToStaticMarkup(React.createElement(Viewer,{value:markedValue}));
assert.match(marked,/<sub>.*?0.*?<\/sub>/u,'structured text must preserve subscripts');
assert.match(marked,/<sup>.*?2.*?<\/sup>/u,'structured text must preserve superscripts');
assert(marked.includes('&lt;unsafe&gt;'),'marked text remains escaped');
assert(marked.includes('font-style:italic'),'vertical marks retain other typography');
assert(fs.readFileSync(path.join(__dirname, 'RichQuestionEditor.tsx'), 'utf8').includes('<QuestionFormulaContent latex={latex}'));
console.log('formula rendering checks passed: block formula, vertical text marks, unresolved placeholder, answer toggle and no raw package URL');
