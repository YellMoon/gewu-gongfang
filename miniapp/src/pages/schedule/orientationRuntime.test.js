'use strict';
// UTF-8: Rotate the actual page contract and exercise its role/date/view controls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const projection = require('../../utils/cloudBusinessProjection');
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [];
const text = tree => Array.isArray(tree) ? tree.map(text).join('') : tree == null || typeof tree === 'boolean' ? '' : typeof tree === 'object' ? text(tree.props?.children) : String(tree);
const config = fs.readFileSync(path.join(__dirname, 'index.config.ts'), 'utf8');
assert.match(config, /pageOrientation:\s*'auto'/, 'WeChat must allow actual device rotation before landscape CSS can be used');
const styles = fs.readFileSync(path.join(__dirname, 'index.scss'), 'utf8');
const landscape = styles.slice(styles.indexOf('@media (orientation: landscape)'));
assert.match(landscape, /\.schedule-page\s*\{[^}]*padding-bottom:\s*calc\(8PX\s*\+\s*env\(safe-area-inset-bottom\)\)/, 'landscape must not reserve a second scaled footer above the native tab bar');
assert.match(landscape, /\.week-header\s*\{[^}]*display:\s*none/, 'landscape columns already show dates; the duplicate date strip must not consume the course viewport');
assert.match(landscape, /grid-template-columns:\s*repeat\(7,\s*minmax\(0,\s*1fr\)\)/, 'landscape week must retain seven real day columns');
for (const [selector, minimum] of [['time-text', 14], ['schedule-course', 14], ['schedule-sub', 12]]) {
  const rule = landscape.match(new RegExp('\\.' + selector + '(?:,\\s*\\.schedule-note)?\\s*\\{([^}]*)\\}'));
  assert.ok(rule, selector + ' needs a landscape rule');
  const size = rule[1].match(/font-size:\s*(\d+)px/i);
  assert.ok(size && Number(size[1]) >= minimum, selector + ' must keep a readable fixed-pixel floor when landscape rpx changes');
}
assert.match(styles, /\.day-view,\s*\.week-view\s*\{[^}]*min-height:\s*0;/, 'both views must leave usable scroll space below controls');

function harness(role) {
  const state = [], show = [], routes = []; let cursor = 0;
  const identity = { id: role, role, user_type: role };
  const today = projection.shanghaiDateKey(new Date());
  const nextDay = projection.shiftShanghaiDateKey(today, 1);
  const sourceData = {
    schedules: [
      { id: 'today-a', course_id: 'course-a', start_time: today + 'T09:00:00', status: 1, student_ids: ['a'] },
      { id: 'today-b', course_id: 'course-b', start_time: today + 'T10:00:00', status: 1, student_ids: ['b'] },
      { id: 'cancelled', course_id: 'course-a', start_time: today + 'T11:00:00', status: 3, student_ids: ['a'] },
      { id: 'next', course_id: 'course-a', start_time: nextDay + 'T13:00:00', status: 1, student_ids: ['a'] },
    ],
    courses: [{ id: 'course-a', name: '物理', type: 1, student_pricings: [{ student_id: 'a' }] }, { id: 'course-b', name: '数学', type: 3, student_pricings: [{ student_id: 'b' }] }],
    students: [{ id: 'a', name: '甲同学' }, { id: 'b', name: '乙同学' }],
  };
  const scoped = ['student', 'family_member'].includes(role);
  const jsx = (type, props) => ({ type, props: props || {} });
  const slot = value => { const i = cursor++; if (!(i in state)) state[i] = value; return i; };
  const deps = {
    react: { useState: value => { const i = slot(typeof value === 'function' ? value() : value); return [state[i], next => { state[i] = typeof next === 'function' ? next(state[i]) : next; }]; }, useRef: value => state[slot({ current: value })], useMemo: fn => fn(), useEffect: () => {} },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    '@tarojs/components': { View: 'View', Text: 'Text', ScrollView: 'ScrollView' },
    '@tarojs/taro': { default: { stopPullDownRefresh: () => {}, navigateTo: value => routes.push(value.url) }, useDidShow: fn => show.push(fn), useDidHide: () => {}, usePullDownRefresh: () => {} },
    '../../types': { ScheduleStatus: { PLANNED: 1, COMPLETED: 2, CANCELLED: 3, LEAVE: 4 } },
    '../../utils/storage': { getCachedList: key => key === 'schedules' && scoped ? sourceData[key].filter(item => item.student_ids.includes('a')) : sourceData[key] },
    '../../utils/sync': { pullFromCloudBusinessProjection: async () => true },
    '../../utils/cloudBusinessProjection': projection,
    '../../components/shared': { EmptyState: 'Empty', LoadingSkeleton: 'Loading' },
    '../../components/ForbiddenContent': { default: 'Forbidden' },
    '../../utils/authSession': { authSessionRuntime: { capture: () => ({ identity }), isSameSession: () => true } },
    '../../utils/miniappPageAccess': { canAccessMiniappPage: () => true, refreshMiniappPageAccess: async () => true },
    '../../utils/accountExperience': { isVisitorIdentity: user => user.role === 'visitor' },
    '../../utils/permission': { isStudentScopedUser: () => scoped }, './index.scss': {},
  };
  const js = ts.transpileModule(fs.readFileSync(path.join(__dirname, 'index.tsx'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 } }).outputText;
  const m = { exports: {} };
  new Function('require', 'module', 'exports', js)(name => { assert.ok(Object.hasOwn(deps, name), name); return deps[name]; }, m, m.exports);
  const render = () => { cursor = 0; return m.exports.default(); };
  return { render, mount: async () => { render(); await show[0](); }, routes, find: cls => nodes(render()).filter(n => (n.props.className || '').split(' ').includes(cls)) };
}
(async () => {
  const sass = require(path.resolve(__dirname, '../../../..', 'miniapp/node_modules/sass'));
  const postcss = require(path.resolve(__dirname, '../../../..', 'miniapp/node_modules/postcss'));
  const pxtransform = require(path.resolve(__dirname, '../../../..', 'miniapp/node_modules/postcss-pxtransform'));
  const compiled = await postcss([pxtransform({ platform: 'weapp', designWidth: 375, deviceRatio: { 375: 2 } })]).process(sass.compileString(styles).css, { from: path.join(__dirname, 'index.scss') });
  for (const [selector, value] of [['.time-text', '14px'], ['.schedule-course', '14px'], ['.schedule-sub, .schedule-note', '12px']]) {
    let size;
    compiled.root.walkAtRules('media', media => {
      if (!media.params.includes('orientation: landscape')) return;
      media.walkRules(rule => { if (rule.selector.replace(/\s+/g, ' ') === selector) rule.walkDecls('font-size', declaration => { size = declaration.value; }); });
    });
    assert.equal(size?.toLowerCase(), value, selector + ' readable floor must survive the real Taro px-to-rpx compiler');
  }
  const landscapeDeclarations = {};
  compiled.root.walkAtRules('media', media => {
    if (!media.params.includes('orientation: landscape')) return;
    media.walkRules(rule => rule.walkDecls(decl => { for (const selector of rule.selector.split(',').map(v => v.trim())) (landscapeDeclarations[selector] ||= {})[decl.prop] = decl.value; }));
  });
  for (const selector of ['.toggle-btn', '.filter-tag', '.nav-arrow', '.nav-today']) {
    assert.equal(landscapeDeclarations[selector]['min-height'].toLowerCase(), '44px', selector + ' must keep its touch target without growing with landscape width');
  }
  // At 844 × 390, even staff controls and the native 50px tab leave the first full row.
  assert.equal(landscapeDeclarations['.day-section-title']['min-height'].toLowerCase(), '40px');
  assert.equal(landscapeDeclarations['.schedule-card']['min-height'].toLowerCase(), '112px');
  const pxValues = (selector, property) => landscapeDeclarations[selector][property].split(/\s+/).map(value => { assert.match(value, /^(?:0|\d+px)$/i, selector + ' ' + property + ' must stay in physical pixels'); return Number.parseInt(value, 10); });
  const blockSpacing = (selector, property) => { const values = pxValues(selector, property); return values[0] + (values[2] ?? values[0]); };
  const controlHeight = selector => pxValues(selector, 'min-height')[0];
  const firstRowBudget = 8 + controlHeight('.toggle-btn') + blockSpacing('.view-toggle', 'margin') + blockSpacing('.view-toggle', 'padding') + controlHeight('.filter-tag') + blockSpacing('.filter-bar', 'padding') + controlHeight('.week-nav') + blockSpacing('.week-nav', 'margin') + controlHeight('.day-section-title') + controlHeight('.schedule-card') + 50;
  assert.ok(firstRowBudget <= 390, 'compiled landscape controls plus one seven-column course row must fit at phone height');
  for (const role of ['super_admin', 'teacher', 'student', 'family_member']) {
    const h = harness(role); await h.mount();
    assert.equal(h.find('day-column').length, 7, role + ' week must retain seven day sections');
    assert.equal(h.find('filter-bar').length, ['student', 'family_member'].includes(role) ? 0 : 1, role + ' must expose only its allowed student selector');
    h.find('toggle-btn')[1].props.onClick();
    assert.equal(h.find('week-view').length, 0);
    assert.equal(h.find('day-view')[0].props.scrollY, true);
    assert.equal(h.find('day-view')[0].props.enableFlex, true);
    assert.equal(h.find('schedule-card').length, ['student', 'family_member'].includes(role) ? 2 : 3);
    if (h.find('filter-tag').length) {
      h.find('filter-tag')[1].props.onClick();
      assert.equal(h.find('schedule-card').length, 1, 'staff student filter must exclude other students and cancelled lessons');
    }
    h.find('nav-arrow')[1].props.onClick();
    assert.equal(h.find('schedule-card').length, 1, 'day navigation must use the Shanghai day key');
    h.find('schedule-card')[0].props.onClick();
    assert.deepEqual(h.routes, ['/pages/schedule/detail/index?id=next']);
    h.find('nav-today')[0].props.onClick();
    h.find('toggle-btn')[0].props.onClick();
    assert.equal(h.find('day-column').length, 7);
    assert.equal(h.find('week-view')[0].props.scrollY, true);
    assert.equal(h.find('week-view')[0].props.enableFlex, true);
  }
  const visitor = harness('visitor'); await visitor.mount();
  assert.equal(visitor.find('schedule-card').length, 0);
  console.log('schedule auto-rotation/readable landscape/week-day navigation/role-scoped runtime checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });

