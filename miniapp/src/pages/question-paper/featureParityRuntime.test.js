'use strict';
// UTF-8: Execute the composed paper page and inspect actual cloud export payloads.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const { richPhysicsQuestions } = require(path.resolve(__dirname, '../../../../scripts/capture-miniapp-ui-matrix.js'));
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [];
const text = tree => Array.isArray(tree) ? tree.map(text).join('') : tree == null || typeof tree === 'boolean' ? '' : typeof tree === 'object' ? text(tree.props?.children) : String(tree);
const tick = () => new Promise(resolve => setImmediate(resolve));
function page(role) {
  const identity = { id: 'fixture-' + role, role, user_type: role, teacher_id: 'fixture-teacher', student_id: 'fixture-student' };
  const selected = [richPhysicsQuestions[0], richPhysicsQuestions[3]], ids = selected.map(item => item.id);
  const state = [], effects = [], effectSlots = [], saved = new Map(), submitted = [], toasts = []; let cursor = 0, revision = 0, reads = 0, dirty = false;
  const slot = value => { const i = cursor++; if (!(i in state)) state[i] = value; return i; };
  const jsx = (type, props) => ({ type, props: props || {} });
  const deps = {
    react: { useState: initial => { const i = slot(typeof initial === 'function' ? initial() : initial); return [state[i], next => { const value = typeof next === 'function' ? next(state[i]) : next; dirty = dirty || !Object.is(state[i], value); state[i] = value; }]; }, useRef: initial => state[slot({ current: initial })], useMemo: fn => fn(), useEffect: (fn, dependencies) => {
      const i = slot(null), old = effectSlots[i];
      if (!old || !dependencies || dependencies.some((value, index) => !Object.is(value, old.dependencies[index]))) {
        old?.cleanup?.(); const current = { dependencies, cleanup: null }; effectSlots[i] = current;
        effects.push(() => { current.cleanup = fn(); });
      }
    } },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    '@tarojs/components': Object.fromEntries(['View', 'Text', 'Input', 'Button', 'Picker', 'RichText'].map(name => [name, name])),
    '@tarojs/taro': { default: { getStorageSync: () => identity, showToast: value => toasts.push(value), stopPullDownRefresh: () => {}, navigateTo: () => {}, switchTab: () => {} }, usePullDownRefresh: () => {} },
    '../../utils/api': { miniappCloudBusinessApi: {
      listQuestionPreviewsByIds: async (_token, requestedIds) => { reads++; return { success: true, data: { questions: selected.filter(item => requestedIds.includes(item.id)), unavailableIds: [] } }; },
      createPaperExportTask: async (token, taskType, payload, idempotencyKey) => { submitted.push({ token, taskType, payload, idempotencyKey }); return { success: true, data: { task: { taskId: 'task-' + submitted.length, status: 'completed', progress: 100 } } }; },
    } },
    '../../utils/questionAssetDelivery': { loadQuestionAsset: async value => '/fixture/' + value.assetKey + '.png' },
    '../../utils/authSession': { authSessionRuntime: { capture: () => ({ identity, token: identity.id }), isSameSession: () => true } },
    '../../utils/miniappAuthorizationRuntime': require('../../utils/miniappAuthorizationRuntime'),
    '../../utils/storage': { storage: { get: key => saved.get(key) || null, set: (key, value) => { saved.set(key, value); return true; } } },
    '../../utils/questionBasketStore': { useQuestionBasket: () => ({ scopeKey: identity.id, ids: ids.slice(), revision }), questionBasketStore: { reconcileIdentity: () => {}, snapshot: () => ({ scopeKey: identity.id, ids: ids.slice() }), readPaperSelection: () => ({ selectedIds: ids.slice() }), seedQuestions: () => {}, question: id => selected.find(item => item.id === id), removeMany: removed => { removed.forEach(id => ids.splice(ids.indexOf(id), 1)); revision++; return { written: true }; } } },
    '../../components/QuestionBasketOverlay': { default: 'Basket' }, '../../components/ForbiddenContent': { default: 'Forbidden' },
    '../../utils/questionPaperWorkflow': require('../../utils/questionPaperWorkflow'), '../../utils/questionPaperDownload': {}, '../../utils/questionDisplay': require('../../utils/questionDisplay'), './index.scss': {},
  };
  const js = ts.transpileModule(fs.readFileSync(path.join(__dirname, 'index.tsx'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 } }).outputText;
  const m = { exports: {} }; new Function('require', 'module', 'exports', js)(name => { assert.ok(Object.hasOwn(deps, name), name); return deps[name]; }, m, m.exports);
  const render = () => { cursor = 0; return m.exports.default(); };
  const h = { submitted, toasts, saved, ids, render, reads: () => reads };
  h.find = cls => nodes(render()).filter(node => (node.props.className || '').split(' ').includes(cls));
  h.button = label => nodes(render()).find(node => node.type === 'Button' && text(node) === label);
  h.flush = async () => { for (let i = 0; i < 12; i++) { render(); dirty = false; effects.splice(0).forEach(fn => fn()); await tick(); if (!dirty) return; } throw Error('paper fixture did not settle'); };
  return h;
}
(async () => {
  for (const role of ['super_admin', 'teacher']) {
    const h = page(role); await h.flush(); assert.equal(h.reads(), 1); assert.equal(h.find('paper-item').length, 2);
    assert.ok(h.find('paper-subquestion-content').length, 'structured subquestions must be rendered');
    assert.ok(h.find('paper-answer-content').length, 'answers and explanations must be rendered as RichText');
    h.find('score-input')[0].props.onInput({ detail: { value: '4.5' } }); await h.flush();
    assert.equal(h.find('score-input')[0].props.value, '4.5', 'decimal score precision must survive editing');
    h.find('section-input')[0].props.onInput({ detail: { value: '第一节：力学' } }); await h.flush();
    h.find('section-input')[0].props.onBlur({ detail: { value: '第一节：力学' } }); await h.flush();
    assert.ok(h.find('paper-section-title').some(node => text(node) === '第一节：力学'));
    const first = h.ids[0], second = h.ids[1];
    h.button('下移').props.onClick(); await h.flush();
    await h.button('导出 Word').props.onClick(); await h.flush();
    await h.button('导出 PDF').props.onClick(); await h.flush();
    assert.deepEqual(h.submitted.map(request => request.taskType), ['paper-export-word', 'paper-export-pdf']);
    for (const request of h.submitted) {
      assert.equal(request.token, 'fixture-' + role); assert.deepEqual(request.payload.questionIds, [second, first]);
      assert.equal(request.payload.layout.items[1].score, 4.5); assert.equal(request.payload.layout.items[1].sectionTitle, '第一节：力学');
      assert.ok(request.idempotencyKey); assert.equal(request.payload.formulaMode, 'word-native');
    }
    h.find('score-input')[0].props.onInput({ detail: { value: '3.14' } }); await h.flush();
    await h.button('导出 PDF').props.onClick(); await h.flush();
    assert.equal(h.submitted.length, 2, 'invalid score must be blocked before creating a cloud task');
    assert.ok(h.find('paper-field-error').length);
    h.button('移除').props.onClick(); await h.flush(); assert.equal(h.find('paper-item').length, 1);
  }
  for (const role of ['student', 'family_member', 'visitor']) {
    const h = page(role); await h.flush(); assert.equal(h.render().type, 'Forbidden'); assert.equal(h.reads(), 0); assert.deepEqual(h.submitted, []);
  }
  console.log('paper actual page rich content/subquestions/decimal score/sections/order/Word-PDF payload/invalid input/role boundary passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
