'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
// Read the actual UTF-8 page source below, not a separate model of its behavior.
const tick = () => new Promise(resolve => setImmediate(resolve));
const fixtures = {
  students: [{ id: 'student-1', name: 'Alice', phone: '13000000001', school: '["School One"]', source_type: 1 },
    { id: 'student-2', name: 'Bob', phone: '13000000002', school: 'School Two', source_type: 1 }],
  teachers: [{ id: 'teacher-1', name: 'Teacher One', subject: 'Physics', hourly_rate: 0 },
    { id: 'teacher-2', name: 'Teacher Two', subject: 'Math', hourly_rate: 100 }],
};
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...nodes(tree.props?.children)];
}
const byClass = (tree, name) => nodes(tree).filter(n => (n.props.className || '').split(' ').includes(name));
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join('');
  if (tree == null || typeof tree === 'boolean') return '';
  return typeof tree === 'object' ? text(tree.props?.children) : String(tree);
}
function harness(page) {
  const state = [], effects = [];
  let cursor = 0;
  const h = { allowed: true, identity: 1, pulls: 0, stops: 0, reads: [], routes: [],
    cache: fixtures[page], result: async () => true };
  const jsx = (type, props) => ({ type, props: props || {} });
  const slot = initial => { const i = cursor++; if (!(i in state)) state[i] = initial; return i; };
  const deps = {
    react: { useState: initial => { const i = slot(initial); return [state[i], next => { state[i] = typeof next === 'function' ? next(state[i]) : next; }]; },
      useRef: initial => state[slot({ current: initial })], useEffect: fn => { slot(null); if (!h.mounted) effects.push(fn); } },
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    '@tarojs/components': { View: 'View', Text: 'Text', Input: 'Input' },
    '@tarojs/taro': { default: { stopPullDownRefresh: () => { h.stops++; }, navigateTo: options => h.routes.push(options.url) },
      useDidShow: fn => { h.show = fn; }, useDidHide: fn => { h.hide = fn; }, usePullDownRefresh: fn => { h.pull = fn; } },
    '../../types': { StudentSource: { SELF: 1 } },
    '../../utils/sync': { getLocalData: key => { h.reads.push(key); return h.cache; }, pullFromCloudBusinessProjection: async () => { h.pulls++; return h.result(); } },
    '../../utils/miniappPageAccess': { canAccessMiniappPage: () => h.allowed, refreshMiniappPageAccess: async () => h.allowed },
    '../../utils/authSession': { authSessionRuntime: { capture: () => h.identity, isSameSession: id => id === h.identity } },
    '../../utils/studentDisplay': { studentSchoolLabel: value => value?.startsWith('[') ? JSON.parse(value).join(', ') : value, studentGradeLabel: () => '' },
    '../../components/shared': { NetworkStatus: 'NetworkStatus', EmptyState: 'EmptyState', LoadingSkeleton: 'LoadingSkeleton', PullRefreshView: 'PullRefreshView' },
    '../../components/ForbiddenContent': { default: 'Forbidden' }, './index.scss': {},
  };
  const source = fs.readFileSync(path.join(__dirname, '../pages', page, 'index.tsx'), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output)(name => { assert.ok(Object.hasOwn(deps, name), name); return deps[name]; }, module, module.exports);
  h.render = () => { cursor = 0; return module.exports.default(); };
  h.mount = () => { const tree = h.render(); h.mounted = true; h.cleanups = effects.map(fn => fn()); return tree; };
  return h;
}
(async () => {
  for (const page of ['students', 'teachers']) {
    const card = page === 'students' ? 'student-card' : 'teacher-card';
    const h = harness(page);
    assert.equal(nodes(h.mount()).filter(n => n.type === 'LoadingSkeleton').length, 1);
    await h.show(); await tick();
    assert.equal(byClass(h.render(), card).length, 2);
    assert.equal(h.pulls, 1);
    if (page === 'teachers') assert.notEqual(byClass(h.render(), card)[0].props.children.at(-1), 0, 'zero fee must not render an orphan numeric text node');
    if (page === 'students') {
      for (const query of ['Alice', '13000000001', 'School One']) {
        nodes(h.render()).find(n => n.type === 'Input').props.onInput({ detail: { value: query } });
        assert.equal(byClass(h.render(), card).length, 1, `search ${query}`);
      }
      byClass(h.render(), 'student-info')[0].props.onClick();
      assert.deepEqual(h.routes, ['/pages/student-detail/index?id=student-1']);
      nodes(h.render()).find(n => n.type === 'Input').props.onInput({ detail: { value: 'not found' } });
      assert.equal(nodes(h.render()).find(n => n.type === 'EmptyState').props.text, '没有匹配的学生');
      nodes(h.render()).find(n => n.type === 'Input').props.onInput({ detail: { value: '' } });
    }
    h.result = async () => false;
    await h.pull(); await tick();
    assert.equal(byClass(h.render(), card).length, 2);
    assert.ok(text(h.render()).includes('已保存的数据'));
    h.result = async () => { throw new Error('request rejected'); };
    await h.pull(); await tick();
    assert.equal(byClass(h.render(), card).length, 2, 'a rejected request also preserves authorized cache');
    assert.equal(byClass(h.render(), 'people-cache-notice').length, 1);
    h.cache = [];
    await h.pull(); await tick();
    let empty = nodes(h.render()).find(n => n.type === 'EmptyState');
    assert.equal(empty.props.actionText, '重试', 'failed empty cache is not an empty business list');
    assert.equal(byClass(h.render(), card).length, 0);
    h.result = async () => true;
    await empty.props.onAction(); await tick();
    empty = nodes(h.render()).find(n => n.type === 'EmptyState');
    assert.equal(empty.props.text, page === 'students' ? '暂无学生数据' : '暂无教师数据');
    h.cache = fixtures[page];
    await h.pull(); await tick();
    assert.equal(byClass(h.render(), card).length, 2, 'native refresh works from the empty state');
    h.hide(); h.cache = fixtures[page].slice(0, 1);
    await h.show(); await tick();
    assert.equal(byClass(h.render(), card).length, 1, 'return refresh');
    h.identity++;
    assert.equal(byClass(h.render(), card).length, 0, 'already rendered rows cannot cross accounts');
    for (const reason of ['hide', 'unmount', 'identity', 'permission']) {
      const isolated = harness(page); isolated.mount();
      let resolve; isolated.result = () => new Promise(done => { resolve = done; });
      const pending = isolated.show(); await tick();
      if (reason === 'hide') isolated.hide();
      if (reason === 'unmount') isolated.cleanups.forEach(fn => fn?.());
      if (reason === 'identity') isolated.identity++;
      if (reason === 'permission') isolated.allowed = false;
      resolve(true); await pending; await tick();
      assert.deepEqual(isolated.reads, [], `${page}: stale ${reason} response cannot read cache`);
      assert.equal(byClass(isolated.render(), card).length, 0);
    }
    const denied = harness(page); denied.allowed = false;
    assert.equal(denied.mount().type, 'Forbidden');
    await denied.show(); await tick();
    assert.equal(denied.pulls, 0); assert.deepEqual(denied.reads, []);
    const race = harness(page); race.mount();
    let finishOld;
    race.result = () => new Promise(resolve => { finishOld = resolve; });
    const oldRequest = race.show(); await tick();
    race.result = async () => true;
    race.cache = fixtures[page].slice(0, 1);
    await race.pull(); await tick();
    const readsAfterNew = race.reads.length, stopsAfterNew = race.stops;
    finishOld(false); await oldRequest; await tick();
    assert.equal(byClass(race.render(), card).length, 1);
    assert.equal(byClass(race.render(), 'people-cache-notice').length, 0);
    assert.equal(race.reads.length, readsAfterNew, 'superseded response cannot reread cache');
    assert.equal(race.stops, stopsAfterNew, 'superseded request cannot stop the new refresh');
    assert.match(fs.readFileSync(path.join(__dirname, '../pages', page, 'index.config.ts'), 'utf8'), /enablePullDownRefresh:\s*true/);
    assert.equal(nodes(h.render()).filter(n => n.type === 'PullRefreshView').length, 0, 'refresh must also work outside populated lists');
  }
  console.log('people pages access, search, detail navigation, refresh and stale-session tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
