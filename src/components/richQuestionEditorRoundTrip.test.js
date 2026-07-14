const assert = require('assert');
const Module = require('module');
const babel = require('@babel/core');
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
const { RichImage, Formula, FormulaBlock } = loaded.exports;
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
  const instance = new Editor({ extensions: [StarterKit, RichImage.configure({ allowBase64: false }), Formula, FormulaBlock], content: value });
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
editor.destroy();
console.log('rich editor TipTap HTML/JSON roundtrip tests passed');
process.exit(0);
