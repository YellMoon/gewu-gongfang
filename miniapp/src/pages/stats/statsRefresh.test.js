'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, 'index.tsx'), 'utf8');
assert.ok(source.includes('暂时无法读取统计数据'), 'failed cold load needs a readable retry state');
const output = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020,
} }).outputText;
const tick = () => new Promise(resolve => setImmediate(resolve));
const courses = [{ id: 'course', type: 1 }];
const lesson = (id, amount, status = 2) => ({ id, course_id: 'course', status, calculated_tuition: amount, start_time: '2026-09-01T09:00:00' });
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...nodes(tree.props?.children)];
}
function byClass(tree, name) { return nodes(tree).filter(n => (n.props.className || '').split(' ').includes(name)); }
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join('');
  if (tree == null || typeof tree === 'boolean') return '';
  return typeof tree === 'object' ? text(tree.props?.children) : String(tree);
}
function harness() {
  const state = [], effects = [];
  let cursor = 0;
  const h = { allowed: true, identity: 1, pulls: 0, stops: 0, reads: [],
    cache: { courses, schedules: [lesson('one', 100), lesson('two', 200), lesson('planned', 900, 1)] },
    result: async () => true };
  const jsx = (type, props, key) => ({ type, props: props || {}, key });
  const slot = initial => { const index = cursor++; if (!(index in state)) state[index] = initial; return index; };
  const dependencies = {
    react: {
      useState: initial => { const i = slot(initial); return [state[i], next => { state[i] = typeof next === 'function' ? next(state[i]) : next; }]; },
      useRef: initial => state[slot({ current: initial })],
      useEffect: fn => { slot(null); if (!h.mounted) effects.push(fn); },
    },
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    '@tarojs/components': { View: 'View', Text: 'Text' },
    '@tarojs/taro': { default: { stopPullDownRefresh: () => { h.stops++; } },
      useDidShow: fn => { h.show = fn; }, useDidHide: fn => { h.hide = fn; },
      usePullDownRefresh: fn => { h.pull = fn; } },
    '../../types': { ScheduleStatus: { COMPLETED: 2 } },
    '../../utils/sync': { getLocalData: key => { h.reads.push(key); return h.cache[key]; },
      pullFromCloudBusinessProjection: async () => { h.pulls++; return h.result(); } },
    '../../utils/miniappPageAccess': { canAccessMiniappPage: () => h.allowed, refreshMiniappPageAccess: async () => h.allowed },
    '../../utils/authSession': { authSessionRuntime: { capture: () => h.identity, isSameSession: id => id === h.identity } },
    '../../components/shared': { NetworkStatus: 'NetworkStatus', EmptyState: 'EmptyState', LoadingSkeleton: 'LoadingSkeleton' },
    '../../components/ForbiddenContent': { default: 'Forbidden' },
    './index.scss': {},
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `unexpected dependency ${name}`);
    return dependencies[name];
  }, module, module.exports);
  h.render = () => { cursor = 0; return module.exports.default(); };
  h.mount = () => { const tree = h.render(); h.mounted = true; h.cleanups = effects.map(fn => fn()); return tree; };
  return h;
}
(async () => {
  const h = harness();
  let tree = h.mount();
  assert.equal(nodes(tree).filter(n => n.type === 'LoadingSkeleton').length, 1, 'first paint must show loading, not fabricated zero revenue');
  assert.equal(byClass(tree, 'revenue-card').length, 0);
  await h.show(); await tick();
  tree = h.render();
  assert.equal(text(byClass(tree, 'revenue-amount')), '¥300.00');
  assert.equal(h.pulls, 1, 'one pull per page entry, not duplicated by mount effect');
  h.hide(); h.cache.schedules = [lesson('new', 450)];
  await h.show(); await tick();
  assert.equal(text(byClass(h.render(), 'revenue-amount')), '¥450.00', 'returning from another page reloads statistics');
  h.cache.schedules = [lesson('newer', 500)];
  await h.pull(); await tick();
  assert.equal(text(byClass(h.render(), 'revenue-amount')), '¥500.00', 'native pull-down updates statistics');
  assert.ok(h.stops >= 3, 'every completed refresh stops the native spinner');
  h.result = async () => false;
  await h.show(); await tick(); tree = h.render();
  assert.equal(text(byClass(tree, 'revenue-amount')), '¥500.00');
  assert.ok(text(tree).includes('已保存的数据'), 'failed refresh explicitly labels cached data');
  h.result = async () => { throw Error('OFFLINE'); };
  await h.pull(); await tick();
  assert.equal(text(byClass(h.render(), 'revenue-amount')), '¥500.00', 'thrown network errors also retain authorized cache');
  h.cache = { schedules: [], courses: [] };
  await h.show(); await tick(); tree = h.render();
  assert.equal(byClass(tree, 'revenue-card').length, 0, 'failed cold load must not claim zero income');
  const failed = nodes(tree).find(n => n.type === 'EmptyState');
  assert.equal(failed.props.text, '暂时无法读取统计数据');
  assert.equal(failed.props.actionText, '重试');
  h.result = async () => true;
  await failed.props.onAction(); await tick(); tree = h.render();
  assert.equal(text(byClass(tree, 'revenue-amount')), '¥0.00', 'verified empty projection is a genuine zero');
  assert.ok(text(tree).includes('暂无完成课程数据'));
  h.identity++;
  assert.equal(byClass(h.render(), 'revenue-card').length, 0, 'even an already rendered result must not cross identities');
  const racing = harness(); racing.mount();
  let finishOld;
  racing.result = () => new Promise(done => { finishOld = done; });
  const oldWork = racing.show(); await tick();
  racing.result = async () => true;
  racing.cache.schedules = [lesson('latest', 800)];
  await racing.pull(); await tick();
  const latestReads = racing.reads.length, latestStops = racing.stops;
  finishOld(false); await oldWork; await tick();
  assert.equal(racing.reads.length, latestReads, 'older request does not reread cache');
  assert.equal(racing.stops, latestStops, 'older request cannot stop the newer refresh spinner');
  assert.equal(text(byClass(racing.render(), 'revenue-amount')), '¥800.00');
  for (const reason of ['hide', 'unmount', 'identity', 'permission']) {
    const isolated = harness(); isolated.mount();
    let resolve;
    isolated.result = () => new Promise(done => { resolve = done; });
    const work = isolated.show(); await tick();
    if (reason === 'hide') isolated.hide();
    if (reason === 'unmount') isolated.cleanups.forEach(fn => fn?.());
    if (reason === 'identity') isolated.identity++;
    if (reason === 'permission') isolated.allowed = false;
    resolve(true); await work; await tick();
    assert.deepEqual(isolated.reads, [], `${reason}: obsolete response cannot read or render another session's cache`);
    assert.equal(byClass(isolated.render(), 'revenue-card').length, 0);
  }
  const denied = harness(); denied.allowed = false; denied.mount();
  await denied.show(); await tick();
  assert.equal(denied.render().type, 'Forbidden');
  assert.equal(denied.pulls, 0); assert.deepEqual(denied.reads, []);
  assert.match(fs.readFileSync(path.join(__dirname, 'index.config.ts'), 'utf8'), /enablePullDownRefresh:\s*true/);
  console.log('statistics loading, native refresh, cache failure and stale-session tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
