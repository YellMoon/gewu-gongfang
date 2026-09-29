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
    if (name === '../utils/physicsNotation') { const m={exports:{}}; new Function('module','exports',ts.transpileModule(fs.readFileSync(path.join(__dirname,'../utils/physicsNotation.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(m,m.exports);return m.exports;}
    if (name === './QuestionFormulaContent') return load('QuestionFormulaContent.tsx');
    if (name === './RichAssetImage') return { RichAssetImage: ({assetKey,...props}) => React.createElement('img', props) };
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

const vector = renderToStaticMarkup(React.createElement(QuestionFormulaContent,{latex:'\\vect{F}'}));
assert(!vector.includes('katex-error'),'structured formulae must use the established physics macros');
const physics=renderToStaticMarkup(React.createElement(Viewer,{value:{sections:{...markedValue.sections,stem:doc([{type:'paragraph',content:[{type:'text',text:'质量 m，速度 v，长度 2 m'}]}])}}}));
assert(physics.includes('<i>m</i>') && physics.includes('<i>v</i>'));
assert(physics.includes('class="physics-unit"'),'units retain upright typography');

const geometry=renderToStaticMarkup(React.createElement(Viewer,{value:{sections:{...markedValue.sections,stem:doc([{type:'image',attrs:{src:'data:image/png;base64,YQ==',width:389,height:297}}])}}}));
assert(geometry.includes('width="389"') && geometry.includes('height="297"'));
assert(geometry.includes('width:389px;max-width:100%;height:auto'),'imported display geometry remains responsive without enlargement');
assert(hidden.includes('structured-question-viewer__formula is-block'));

const splitUnits=renderToStaticMarkup(React.createElement(Viewer,{value:{sections:{...markedValue.sections,stem:doc([{type:'paragraph',content:[{type:'text',text:'长度 2 '},{type:'text',text:'m',marks:[{type:'bold'}]},{type:'text',text:'，速度 3 '},{type:'text',text:'m/'},{type:'text',text:'s'},{type:'text',text:'，质量 '},{type:'text',text:'m'}]}])}}}));
assert(!splitUnits.includes('<i>s</i>'),'split unit denominator stays upright');
assert.equal((splitUnits.match(/<i>m<\/i>/g)||[]).length,1,'only mass m is italic, not meters split across marks');
assert(splitUnits.includes('font-weight:700'),'contextual unit recognition retains marks');

assert(marked.includes('<i>v</i>'),'subscript boundaries do not turn variable v into a word v0');
const {applyPhysicsNotationToTextRuns}=load('../utils/physicsNotation.ts');
const spaced=applyPhysicsNotationToTextRuns(['长度 2  ','m','，质量 ','m']);
assert.deepEqual(spaced,['长度 2  ','<span class="physics-unit">m</span>','，质量 ','<i>m</i>'],'preserve spaces and source mark offsets');
