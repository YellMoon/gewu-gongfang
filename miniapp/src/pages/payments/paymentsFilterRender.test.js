'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// Render the actual page and exercise its filter handlers, including students
// beyond the former 20-record cutoff. Only the authorized projection is supplied.
const students = Object.freeze(Array.from({ length: 35 }, (_, i) => Object.freeze({
  id: `student-${i + 1}`, name: `Student ${i + 1}`,
})));
const payments = Object.freeze([
  Object.freeze({ id: 'first', student_id: students[0].id, amount: 100, payment_type: 'tuition', payment_date: '2026-09-01', created_at: '2026-09-01' }),
  Object.freeze({ id: 'last-old', student_id: students[34].id, amount: 200, payment_type: 'tuition', payment_date: '2026-09-02', created_at: '2026-09-02' }),
  Object.freeze({ id: 'last-new', student_id: students[34].id, amount: 300, payment_type: 'tuition', payment_date: '2026-09-03', created_at: '2026-09-03' }),
]);
const state = [payments, students, false, false, ''];
let cursor = 0;
let allowed = true;
const jsx = (type, props, key) => ({ type, props: props || {}, key });
const Forbidden = function Forbidden() {};
const dependencies = {
  react: { useState: () => { const index = cursor++; return [state[index], value => { state[index] = value; }]; } },
  'react/jsx-runtime': { jsx, jsxs: jsx },
  '@tarojs/components': { View: 'View', Text: 'Text', ScrollView: 'ScrollView' },
  '@tarojs/taro': { useDidShow: () => {} },
  '../../types': { PaymentType: { TUITION: 'tuition' } },
  '../../utils/sync': {},
  '../../components/shared': { NetworkStatus: 'NetworkStatus', EmptyState: 'EmptyState', LoadingSkeleton: 'LoadingSkeleton' },
  './paymentsRuntime': require('./paymentsRuntime'),
  '../../utils/miniappPageAccess': { canAccessMiniappPage: () => allowed },
  '../../components/ForbiddenContent': { default: Forbidden },
  './index.scss': {},
};
const output = ts.transpileModule(fs.readFileSync(path.join(__dirname, 'index.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
}).outputText;
const page = { exports: {} };
new Function('require', 'module', 'exports', output)(name => {
  assert.ok(Object.hasOwn(dependencies, name), `unexpected dependency: ${name}`);
  return dependencies[name];
}, page, page.exports);
function render() { cursor = 0; return page.exports.default(); }
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...nodes(tree.props.children)];
}
function byClass(tree, name) { return nodes(tree).filter(node => (node.props.className || '').split(' ').includes(name)); }
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join('');
  if (tree == null || typeof tree === 'boolean') return '';
  return typeof tree === 'object' ? text(tree.props.children) : String(tree);
}
let tree = render();
let filters = byClass(tree, 'filter-tag');
assert.equal(filters.length, students.length + 1, 'every authorized student must have a filter, plus All');
assert.deepEqual(filters.slice(1).map(text), students.map(student => student.name));
assert.deepEqual(byClass(tree, 'pay-stat-value').map(text), ['¥600', '3']);
filters.at(-1).props.onClick();
tree = render();
assert.equal(text(byClass(tree, 'filter-tag').find(node => node.props.className.includes('active'))), 'Student 35');
assert.deepEqual(byClass(tree, 'pay-card').map(node => node.key), ['last-new', 'last-old']);
assert.deepEqual(byClass(tree, 'pay-stat-value').map(text), ['¥500', '2']);
// A student with no payments remains selectable and displays the genuine empty state.
byClass(tree, 'filter-tag')[21].props.onClick();
tree = render();
assert.deepEqual(byClass(tree, 'pay-stat-value').map(text), ['¥0', '0']);
assert.equal(nodes(tree).filter(node => node.type === 'EmptyState').length, 1);
byClass(tree, 'filter-tag')[0].props.onClick();
assert.equal(byClass(render(), 'pay-card').length, 3, 'All restores the complete authorized payment list');
allowed = false;
tree = render();
assert.equal(tree.type, Forbidden, 'restricted roles must not see cached financial data');
assert.equal(byClass(tree, 'filter-tag').length, 0);
assert.equal(byClass(tree, 'pay-card').length, 0);
allowed = true;
state[0] = [];
state[1] = [];
assert.equal(byClass(render(), 'filter-tag').length, 0, 'empty projections do not invent students');
console.log('miniapp payments full authorized student filter and click tests passed');
