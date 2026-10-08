'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const { createNavigationOverlayRuntime } = require('../utils/navigationOverlayRuntime');
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [];
function mount(env, allowed = true) {
  const state = [], effects = [], pending = []; let cursor = 0, denied = 0;
  const navigation = createNavigationOverlayRuntime();
  const basket = { scopeKey: allowed ? 'teacher' : null, ids: ['q1'], revision: 1, questionRevision: 1 };
  const slot = value => { const i = cursor++; if (!(i in state)) state[i] = value; return i; };
  const jsx = (type, props) => ({ type, props: props || {} });
  const deps = {
    react: { useState: value => { const i = slot(value); return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value; }]; }, useRef: value => state[slot({ current: value })], useMemo: fn => fn(), useEffect: (fn, dependencies) => { const i = slot(null), old = effects[i]; if (!old || dependencies.some((value, index) => value !== old.dependencies[index])) { old?.cleanup?.(); const next = { dependencies }; effects[i] = next; pending.push(() => { next.cleanup = fn(); }); } } },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    '@tarojs/components': Object.fromEntries(['Button','Checkbox','CheckboxGroup','PageContainer','RichText','ScrollView','Text','View'].map(name => [name, name])),
    '@tarojs/taro': { default: { showToast() {}, navigateTo() {}, showModal() {} } },
    '../utils/questionBasketStore': { useQuestionBasket: () => basket, questionBasketStore: { reconcileIdentity() {}, snapshot: () => basket, question: () => ({ id: 'q1', type: 'single_choice', subject: 'physics', stemPreview: '题干' }) } },
    '../utils/navigationOverlayRuntime': { navigationOverlayRuntime: navigation },
    '../utils/questionDisplay': require('../utils/questionDisplay'), './QuestionBasketOverlay.scss': {},
  };
  const js = ts.transpileModule(fs.readFileSync(path.join(__dirname, 'QuestionBasketOverlay.tsx'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const result = { exports: {} };
  new Function('require', 'module', 'exports', 'process', js)(name => { assert.ok(Object.hasOwn(deps, name), name); return deps[name]; }, result, result.exports, { env: { TARO_ENV: env } });
  const render = () => { cursor = 0; const tree = result.exports.default({ canUse: allowed, inline: true, onRestricted: () => { denied++; } }); pending.splice(0).forEach(fn => fn()); return tree; };
  const find = cls => nodes(render()).filter(node => (node.props.className || '').split(' ').includes(cls));
  return { render, find, navigation, denied: () => denied, open: () => find('global-question-basket')[0].props.onClick(), unmount: () => effects.forEach(effect => effect?.cleanup?.()) };
}
for (const env of ['h5', 'weapp']) {
  const h = mount(env);
  assert.equal(h.find('question-basket-drawer').length, 0, env + ': closed drawer must not enter DOM even if PageContainer ignores show');
  assert.equal(nodes(h.render()).filter(n => n.type === 'PageContainer').length, 0);
  assert.equal(h.navigation.isBlocked(), false);
  h.open(); h.render();
  assert.equal(h.find('question-basket-drawer').length, 1);
  assert.equal(h.navigation.isBlocked(), true);
  if (env === 'h5') {
    assert.equal(h.find('question-basket-web-overlay').length, 1, 'H5 needs a real fixed overlay instead of unsupported PageContainer');
    h.find('question-basket-web-overlay')[0].props.onClick();
  } else {
    const container = nodes(h.render()).find(n => n.type === 'PageContainer');
    assert.equal(container.props.closeOnSlideDown, true);
    container.props.onAfterLeave();
  }
  assert.equal(h.find('question-basket-drawer').length, 0);
  assert.equal(h.navigation.isBlocked(), false, 'overlay/native back must release the navigation owner');
  h.open(); h.render(); h.find('question-basket-close')[0].props.onClick(); h.render();
  assert.equal(h.navigation.isBlocked(), false);
  h.open(); h.render(); h.unmount(); assert.equal(h.navigation.isBlocked(), false, 'unmount must release a live drawer');
  const restricted = mount(env, false); restricted.open();
  assert.equal(restricted.find('question-basket-drawer').length, 0);
  assert.equal(restricted.denied(), 1);
  assert.equal(restricted.navigation.isBlocked(), false);
}
console.log('actual basket H5/WeApp closed/open/native-back/overlay/close/unmount/restricted checks passed');
