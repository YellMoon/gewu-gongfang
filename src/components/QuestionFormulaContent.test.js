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
    if (name === './RichAssetImage') return { RichAssetImage: ({assetKey,...props}) => React.createElement('img', props), ResolvedRichHtml: ({as = 'span', html}) => React.createElement(as, {dangerouslySetInnerHTML: {__html: html}}) };
    if (name.endsWith('.css')) return {};
    if (name === '../utils/sanitizeHtml') return load('../utils/sanitizeHtml.ts');
    if (name === '../utils/questionOptions') return require('../utils/questionOptions.ts');
    return require(name);
  }, DOMParser: new (require('jsdom').JSDOM)('').window.DOMParser, Node: new (require('jsdom').JSDOM)('').window.Node });
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
assert(!hidden.includes('katex-display'), 'exam formulas must not force a display row');
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
assert(!hidden.includes('structured-question-viewer__formula is-block'));

const splitUnits=renderToStaticMarkup(React.createElement(Viewer,{value:{sections:{...markedValue.sections,stem:doc([{type:'paragraph',content:[{type:'text',text:'长度 2 '},{type:'text',text:'m',marks:[{type:'bold'}]},{type:'text',text:'，速度 3 '},{type:'text',text:'m/'},{type:'text',text:'s'},{type:'text',text:'，质量 '},{type:'text',text:'m'}]}])}}}));
assert(!splitUnits.includes('<i>s</i>'),'split unit denominator stays upright');
assert.equal((splitUnits.match(/<i>m<\/i>/g)||[]).length,1,'only mass m is italic, not meters split across marks');
assert(splitUnits.includes('font-weight:700'),'contextual unit recognition retains marks');

assert(marked.includes('<i>v</i>'),'subscript boundaries do not turn variable v into a word v0');
const {applyPhysicsNotationToTextRuns}=load('../utils/physicsNotation.ts');
const spaced=applyPhysicsNotationToTextRuns(['长度 2  ','m','，质量 ','m']);
assert.deepEqual(spaced,['长度 2  ','<span class="physics-unit">m</span>','，质量 ','<i>m</i>'],'preserve spaces and source mark offsets');

const { JSDOM } = require('jsdom');
const formulaDoc = doc([
  {type:'paragraph',content:[{type:'text',text:'Before '},{type:'formula',attrs:{canonicalLatex:'x^2',displayMode:'block'}},{type:'text',text:' after'},{type:'hardBreak'},{type:'text',text:'Next line'}]},
  {type:'paragraph',content:[{type:'text',text:'Next paragraph'}]},
]);
const exam = {sections:{stem:formulaDoc,options:[{id:'a',label:'A',content:formulaDoc}],answer:formulaDoc,analysis:formulaDoc,subQuestions:[]}};
const originalExam = JSON.stringify(exam);
const examHtml = renderToStaticMarkup(React.createElement(Viewer,{value:exam,showAnswer:true}));
const examDom = new JSDOM(examHtml).window.document;
assert.equal(examDom.querySelectorAll('.katex-display, .is-block').length,0);
assert.equal(examDom.querySelectorAll('p').length,8,'all four sections retain their paragraph boundaries');
assert.equal(examDom.querySelectorAll('br').length,4,'all four sections retain their hard breaks');
assert.equal(examDom.querySelectorAll('.structured-question-viewer__option-content > p').length,2,
  'option paragraphs share one content column beside their label');
assert.equal(JSON.stringify(exam),originalExam,'rendering cannot rewrite the source document');
const QuestionRenderer = load('QuestionRenderer.tsx').default;
const legacyText = String.raw`<p>Before $$\frac{1}{2}$$ after<br />Next line</p><p>Next paragraph</p>`;
const legacyHtml = renderToStaticMarkup(React.createElement(QuestionRenderer,{content:legacyText,options:[{label:'A',content:legacyText}],answer:legacyText,analysis:legacyText,showAnalysis:true}));
const legacyDom = new JSDOM(legacyHtml).window.document;
assert.equal(legacyDom.querySelectorAll('.katex-display, .math-display').length,0);
assert.equal(legacyDom.querySelectorAll('.katex').length,4,'each legacy section renders the complete delimited formula once');
assert.equal(legacyDom.querySelectorAll('p').length,8,'legacy formulas must not split surrounding HTML paragraphs');
assert.equal(legacyDom.querySelectorAll('br').length,4);
assert(!legacyDom.body.textContent.includes('$'),'no unmatched display delimiters may leak into exam text');
const alignedHtml = renderToStaticMarkup(React.createElement(QuestionRenderer,{content:String.raw`Before \[\begin{aligned}x&=1\\y&=2\end{aligned}\] after`}));
assert(alignedHtml.includes('mtable'),'aligned formula rows remain inside the formula');
assert(!alignedHtml.includes('katex-error') && !alignedHtml.includes('latex-fallback'));

// Imported HTML often has formatting newlines between table rows/cells.
// Those newlines must not become foster-parented <br> nodes above the table.
const legacyTable = `<p>表格前</p><table>
<thead><tr><th colspan="2">测量数据</th></tr></thead>
<tbody>
<tr><td rowspan="2">速度</td><td>第一行\n第二行 $x^2$</td></tr>
<tr><td><table><tr><td>嵌套</td></tr></table></td></tr>
</tbody>
</table><p>表格后</p>`;
const tableHtml = renderToStaticMarkup(React.createElement(QuestionRenderer, {
  content: legacyTable, options: [{label:'A',content:legacyTable}],
  answer: legacyTable, analysis: legacyTable, showAnalysis: true,
}));
const tableDom = new JSDOM(tableHtml).window.document;
assert.equal(tableDom.querySelectorAll('table.question-table').length, 8,
  'HTML tables in every question section, including nested tables, need grid styling');
assert.equal(tableDom.querySelectorAll('.question-table-scroll > table').length, 8,
  'wide tables must scroll inside their question section');
assert.equal(tableDom.querySelectorAll('br').length, 4,
  'only intentional line breaks inside cells survive; table indentation creates no blank lines');
assert.equal(tableDom.querySelectorAll('th[colspan="2"]').length, 4);
assert.equal(tableDom.querySelectorAll('td[rowspan="2"]').length, 4);
assert.equal(tableDom.querySelectorAll('td .katex').length, 4);
assert.equal(tableDom.querySelectorAll('.question-table-scroll > br').length, 0);
console.log('legacy table display checks passed: four sections, merged cells, nested tables and cell formulas');
module.exports = { load, tableHtml };
