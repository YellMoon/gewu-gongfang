'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { createRequire } = require('node:module');
const cloudRequire = createRequire(path.resolve(__dirname, '../../cloud-business-api/package.json'));
const JSZip = cloudRequire('jszip');
const { renderPaperExport } = require('../../cloud-business-api/src/paperExportRenderer');
const workflow = require('../../miniapp/src/utils/questionPaperWorkflow');

// Execute the page's own declaration and event handler: do not inject a test-only formula mode.
function pageHandler(relativePath, handlerName, environment) {
  const file = path.resolve(__dirname, relativePath);
  const ast = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = new Map();
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      if (['formulaMode', handlerName].includes(node.name.text)) {
        assert.ok(!declarations.has(node.name.text), `Ambiguous page declaration: ${node.name.text}`);
        declarations.set(node.name.text, node.initializer.getText(ast));
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(declarations.size, 2);
  const code = `const formulaMode = ${declarations.get('formulaMode')}; return (${declarations.get(handlerName)});`;
  return new Function(...Object.keys(environment), ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText)(...Object.values(environment));
}

const noop = () => {};
const fail = message => { throw new Error(String(message?.title || message)); };
const snapshot = [{
  id: 'question-1', subject: '物理', stem: '', answer: 'A', explanation: '', assets: [],
  richContent: { version: 1, type: 'question-document', sections: {
    stem: { type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: '速度公式 ' },
      { type: 'formula', attrs: { canonicalLatex: '\\frac{1}{2}at^{2}', displayMode: 'inline' } },
    ] }] },
  } },
}];
const layout = { items: [{ id: 'question-1', sectionTitle: '计算题', score: 2.5 }] };

async function captureDesktop(format) {
  let captured;
  const handler = pageHandler('QuestionBankPaper.tsx', 'exportHostPaper', {
    runtimeConfig: {}, exportingFormat: null, setExportingFormat: noop,
    title: '原生公式验收', answerPosition: 'after',
    items: [{ question: snapshot[0], ...layout.items[0] }],
    submitPaperExportTask: async (_config, input) => {
      captured = input;
      return { accepted: true, task: { localId: 'task-1', status: 'queued' } };
    },
    setPaperTasks: noop, loadPaperExportTasks: () => [],
    window: { requestAnimationFrame: noop },
    messageApi: { success: noop, warning: fail, error: fail }, TASK_TEXT: {},
  });
  await handler(format);
  assert.ok(captured, 'Desktop export button must submit');
  return captured;
}

async function captureMiniapp(format, retry) {
  let captured;
  const handler = pageHandler('../../miniapp/src/pages/question-paper/index.tsx', 'submit', {
    canBuildPaper: true, taskState: { scopeKey: 'test-account', tasks: [] },
    title: '原生公式验收', answerPosition: 'after', items: layout.items, questions: snapshot,
    editedLayoutItems: () => layout.items, validateAndNormalizePaperLayout: workflow.validateAndNormalizePaperLayout,
    setItems: noop, setLayoutEdits: noop, setLayoutErrors: noop, setSubmitting: noop,
    workflow, authSessionRuntime: { capture: () => ({ token: 'isolated-test-token' }) },
    miniappCloudBusinessApi: { createPaperExportTask: async (token, taskType, payload) => {
      assert.equal(token, 'isolated-test-token');
      assert.equal(taskType, `paper-export-${format}`);
      captured = { ...payload, format };
      return { success: true, data: { task: { taskId: 'task-1', status: 'queued' } } };
    } }, persistTask: noop, Taro: { showToast: fail },
  });
  await handler(`paper-export-${format}`, retry);
  assert.ok(captured, 'Miniapp export button must submit');
  return captured;
}

(async () => {
  for (const [page, capture] of [['desktop', captureDesktop], ['miniapp', captureMiniapp]]) {
    for (const format of ['word', 'pdf']) {
      const request = await capture(format);
      assert.equal(request.formulaMode, 'word-native', `${page}: actual page must request editable Word formulas`);
      assert.deepEqual(request.questionIds, ['question-1']);
      assert.deepEqual(request.layout, layout);
      assert.equal(request.answerPosition, 'after');
      const artifact = await renderPaperExport({ ...request, snapshot });
      if (format === 'word') {
        const archive = await JSZip.loadAsync(artifact.bytes);
        const xml = await archive.file('word/document.xml').async('string');
        assert.equal((xml.match(/<m:oMath>/g) || []).length, 1, `${page}: output must contain native OMML`);
        assert.ok(xml.includes('<m:f>') && xml.includes('<m:sSup>'), 'Fraction and exponent must remain editable');
        assert.ok(!xml.includes('<w:drawing'), 'Formula must not become a picture');
        assert.equal(Object.keys(archive.files).filter(name => /^word\/media\/[^/]+$/.test(name)).length, 0);
      } else {
        assert.equal(artifact.extension, 'pdf');
        assert.equal(artifact.bytes.subarray(0, 5).toString(), '%PDF-');
      }
      console.log(`PASS ${page} actual export handler -> ${format} renderer`);
    }
  }
  const retry = await captureMiniapp('word', { request: { payload: {
    questionIds: ['question-1'], title: '保留重试编排', answerPosition: 'end', formulaMode: 'latex-vector', layout,
  } } });
  assert.equal(retry.formulaMode, 'word-native', 'Miniapp retries must not revive image formula mode');
  assert.equal(retry.title, '保留重试编排');
  assert.equal(retry.answerPosition, 'end');
  console.log('PASS miniapp retry preserves layout and requests editable formulas');
})().catch(error => { console.error(error); process.exitCode = 1; });
