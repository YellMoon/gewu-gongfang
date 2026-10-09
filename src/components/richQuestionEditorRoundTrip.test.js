require('./QuestionFormulaContent.test');
const assert = require('assert');
const Module = require('module');
const babel = require('@babel/core');
require.extensions['.css'] = () => {};
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>');
Object.assign(global, { window: dom.window, document: dom.window.document, DOMParser: dom.window.DOMParser, Node: dom.window.Node });
global.innerHeight = 800;
require.extensions['.ts'] = (module, file) => {
  const transformed = babel.transformFileSync(file, { presets: [['@babel/preset-env', { targets: { node: 'current' } }], '@babel/preset-typescript'] });
  module._compile(transformed.code, file);
};
require.extensions['.tsx'] = (module, file) => {
  const transformed = babel.transformFileSync(file, { presets: [['@babel/preset-env', { targets: { node: 'current' } }], ['@babel/preset-react', { runtime: 'automatic' }], '@babel/preset-typescript'] });
  module._compile(transformed.code, file);
};
const filename = require.resolve('./RichQuestionEditor.tsx');
const result = babel.transformFileSync(filename, { presets: [['@babel/preset-env', { targets: { node: 'current' } }], ['@babel/preset-react', { runtime: 'automatic' }], '@babel/preset-typescript'] });
const loaded = new Module(filename); loaded.filename = filename; loaded.paths = Module._nodeModulePaths(__dirname); loaded._compile(result.code, filename);
const { RichImage, Formula, FormulaBlock, QuestionTableNodes = [] } = loaded.exports;
const { createQuestionRichDocument } = require('../types/questionRichContent.ts');
const { createRichDocumentDirtyCoordinator } = require('./question-editor/questionEditorSession.ts');
const { Editor } = require('@tiptap/core');
const StarterKit = require('@tiptap/starter-kit').default;
const editor = new Editor({ extensions: [StarterKit, RichImage.configure({ allowBase64: false }), Formula, FormulaBlock], content: '<p><span data-formula="latex" data-id="f-1" data-latex="x^2" data-display-mode="inline" data-source-format="latex"></span><img src="question-asset://asset-1" data-asset-key="asset-1" data-align="center" alt="diagram" width="240"></p><div data-formula-block="latex" data-id="f-2" data-latex="E=mc^2" data-display-mode="block" data-source-format="latex" data-conversion-status="complete"></div>' });
const json = editor.getJSON();
const { normalizeQuestionRichContent } = require('../services/questionRichContent.ts');
const rich = normalizeQuestionRichContent({ version: 1, type: 'question-document', sections: { stem: json, answer: { type: 'doc', content: [] }, analysis: { type: 'doc', content: [] }, options: [], subQuestions: [] } });
const nodes = [];
const collect = node => { nodes.push(node); (node.content || []).forEach(collect); };
collect(rich.sections.stem);
assert.strictEqual(nodes.find(node => node.type === 'formula').attrs.canonicalLatex, 'x^2');
assert.strictEqual(nodes.find(node => node.type === 'image').attrs.src, 'question-asset://asset-1');
assert.strictEqual(nodes.find(node => node.type === 'formulaBlock').attrs.displayMode, 'block');
const geometryEditor = new Editor({ extensions: [StarterKit, RichImage], content: '<img src="question-asset://asset-geometry" data-asset-key="asset-geometry" width="107.5" height="49" alt="diagram">' });
assert.strictEqual(geometryEditor.getJSON().content[0].attrs.height, 49, 'editing must preserve imported document height');
assert.strictEqual(geometryEditor.getJSON().content[0].attrs.width, 107.5);
assert(geometryEditor.getHTML().includes('height="49"'), 'HTML output preserves both dimensions');
geometryEditor.destroy();

const hydrationBaseline = createQuestionRichDocument({ sections: {
  stem: { type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'seed ' }, { type: 'formula', attrs: { id: 'f-seed', canonicalLatex: 'x^2', displayMode: 'inline' } }] },
    { type: 'image', attrs: { src: 'question-asset://qa-image.png', assetKey: 'qa-image.png', alt: 'diagram' } },
  ] },
  options: [
    { id: 'a', label: 'A', isCorrect: true, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] } },
    { id: 'b', label: 'B', isCorrect: false, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'two' }] }] } },
  ],
  subQuestions: [],
  answer: { type: 'doc', content: [] },
  analysis: { type: 'doc', content: [] },
} });
const hydrate = value => {
  const instance = new Editor({ extensions: [StarterKit, RichImage.configure({ allowBase64: false }), Formula, FormulaBlock, ...QuestionTableNodes], content: value });
  const result = instance.getJSON();
  instance.destroy();
  return result;
};
const hydratedDocument = {
  ...hydrationBaseline,
  sections: {
    ...hydrationBaseline.sections,
    stem: hydrate(hydrationBaseline.sections.stem),
    options: hydrationBaseline.sections.options.map(option => ({ ...option, content: hydrate(option.content) })),
    answer: hydrate(hydrationBaseline.sections.answer),
    analysis: hydrate(hydrationBaseline.sections.analysis),
  },
};
const hydrationDirty = createRichDocumentDirtyCoordinator(hydrationBaseline);
assert.strictEqual(hydrationDirty.update(hydratedDocument).dirty, false, `actual TipTap hydration must be baseline-equivalent: ${JSON.stringify(hydratedDocument)}`);
const tableHtml = '<table><tbody><tr><th colspan="2"><p>Road</p></th></tr><tr><td rowspan="2"><p><span data-formula="latex" data-id="f-table" data-latex="x^2" data-display-mode="inline"></span></p></td><td><p>Dry</p></td></tr><tr><td><p></p><table><tr><td><p>Nested</p></td></tr></table></td></tr></tbody></table>';
const tableJson = hydrate(tableHtml);
assert.strictEqual(tableJson.content[0].type, 'table', 'TipTap must not flatten imported tables');
assert.strictEqual(tableJson.content[0].content[0].content[0].attrs.colspan, 2);
assert.strictEqual(tableJson.content[0].content[1].content[0].attrs.rowspan, 2);
assert.deepStrictEqual(hydrate(tableJson), tableJson, 'loading and saving cannot lose table cells');
const tableDocument = normalizeQuestionRichContent({ ...rich, sections: { ...rich.sections, stem: tableJson } });
const viewer = require('./StructuredQuestionViewer.tsx').default;
const renderedTable = require('react-dom/server').renderToStaticMarkup(require('react').createElement(viewer, { value: tableDocument }));
const renderedDom = new JSDOM(renderedTable).window.document;
assert.strictEqual(renderedDom.querySelectorAll('table').length, 2);
assert.strictEqual(renderedDom.querySelector('th').colSpan, 2);
assert.strictEqual(renderedDom.querySelector('td').rowSpan, 2);
assert(renderedDom.body.textContent.includes('Nested'));
const fullyMerged = hydrate('<table><tr><td rowspan="2"><p>Whole column</p></td></tr><tr></tr></table>');
assert.strictEqual(fullyMerged.content[0].content.length, 2, 'an empty continuation row is not discarded');
assert.strictEqual(fullyMerged.content[0].content[1].content?.length || 0, 0);
normalizeQuestionRichContent({ ...rich, sections: { ...rich.sections, stem: fullyMerged } });
const { beginQuestionImageDrag, dropQuestionImage, endQuestionImageDrag } = require('./richQuestionImageDrag.ts');
const { maskPersistedImagesForEditor: maskDrag, restorePersistedImagesFromEditor: restoreDrag } = require('./richQuestionEditorState.ts');
const dragDoc={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Before'}]},{type:'image',attrs:{src:'question-asset://drag-diagram',assetKey:'drag-diagram',width:107.5,height:49,alt:'Diagram'}},{type:'paragraph',content:[{type:'text',text:'After'}]}]};
const sender=new Editor({extensions:[StarterKit,RichImage],content:maskDrag(dragDoc)});
const receiver=new Editor({extensions:[StarterKit,RichImage],content:'<p>Target</p>'});
const imagePos=()=>{let pos;sender.state.doc.descendants((node,position)=>{if(node.type.name==='image')pos=position;});return pos;};
const transferValues=new Map();const transfer={setData:(key,value)=>transferValues.set(key,value),getData:key=>transferValues.get(key)||''};
const dragEvent={dataTransfer:transfer,clientX:1,clientY:1,preventDefault:()=>{}};
global.requestAnimationFrame=()=>0;
sender.view.posAtCoords=()=>({pos:sender.state.doc.content.size-1,inside:-1});
beginQuestionImageDrag(sender,imagePos,transfer);assert(dropQuestionImage(sender,dragEvent));
let movedDoc=restoreDrag(sender.getJSON());assert(movedDoc.content.findIndex(node=>node.type==='image')>movedDoc.content.findIndex(node=>JSON.stringify(node).includes('After')));
receiver.view.posAtCoords=()=>({pos:receiver.state.doc.content.size-1,inside:-1});
beginQuestionImageDrag(sender,imagePos,transfer);receiver.setEditable(false);assert(dropQuestionImage(receiver,dragEvent));assert.equal(sender.getJSON().content.filter(node=>node.type==='image').length,1);
receiver.setEditable(true);beginQuestionImageDrag(sender,imagePos,transfer);
sender.view.dragging={slice:sender.state.selection.content(),move:true};transferValues.clear();
transferValues.set('application/x-gewu-question-image','foreign-gesture');assert.equal(dropQuestionImage(receiver,dragEvent),false);
transferValues.clear();assert(dropQuestionImage(receiver,dragEvent),'native drag remains supported after ProseMirror clears custom transfer data');
assert.equal(sender.getJSON().content.filter(node=>node.type==='image').length,0);
const transferred=restoreDrag(receiver.getJSON()).content.find(node=>node.type==='image');
assert.equal(transferred.attrs.src,'question-asset://drag-diagram');assert.equal(transferred.attrs.width,107.5);assert.equal(transferred.attrs.height,49);
assert(!JSON.stringify(restoreDrag(receiver.getJSON())).includes('data:image'));
endQuestionImageDrag();assert.equal(dropQuestionImage(receiver,dragEvent),false);
sender.destroy();receiver.destroy();
editor.destroy();
console.log('rich editor TipTap HTML/JSON roundtrip tests passed');
process.exit(0);
