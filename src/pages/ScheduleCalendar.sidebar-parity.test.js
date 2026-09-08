'use strict';
// UTF-8: compare actual historical/current sidebar rendering, not copied JSX.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const cp = require('node:child_process');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { JSDOM } = require('jsdom');
const { Select, Divider } = require('antd');
const root = path.resolve(__dirname, '../..');
const file = 'src/pages/ScheduleCalendar.tsx';
const current = fs.readFileSync(path.join(root, file), 'utf8');
// This is a pre-cloud source comparison point, not approval of the entire old UI.
const historical = cp.execFileSync('git', ['show', '8118419f:' + file], { cwd: root, encoding: 'utf8' });
const compile = text => ts.transpileModule(text, {
  compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const types = {};
new Function('exports', compile(fs.readFileSync(path.join(root, 'src/types/index.ts'), 'utf8')))(types);
function sidebarFrom(text) {
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const wanted = new Map(['SIDEBAR_WIDTH', 'stripCourseSystemPrefix', 'getCourseDisplayName', 'Sidebar'].map(name => [name, null]));
  function visit(node) {
    if ((ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) && wanted.has(node.name?.getText(ast))) {
      wanted.set(node.name.getText(ast), (ts.isVariableDeclaration(node) ? 'const ' : '') + node.getText(ast) + ';');
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  for (const [name, value] of wanted) assert(value, 'missing real source: ' + name);
  return new Function('React', 'Select', 'Divider', 'CourseType', compile([...wanted.values()].join('\n')) + '\nreturn Sidebar;')(
    React, Select, Divider, types.CourseType);
}
function view(Component, props) {
  const dom = new JSDOM(renderToStaticMarkup(React.createElement(Component, props)));
  const document = dom.window.document;
  const result = {
    width: document.body.firstElementChild.style.width,
    headings: [...document.querySelectorAll('h4')].map(el => el.textContent),
    cards: [...document.querySelectorAll('[draggable]')].map(el => ({
      lines: [...el.children].map(line => line.textContent),
      draggable: el.getAttribute('draggable'), style: el.getAttribute('style'),
    })),
    empty: ['暂无未结课程', '请先选择老师'].filter(text => document.body.textContent.includes(text)),
    selectors: document.querySelectorAll('.ant-select').length,
  };
  dom.window.close();
  return result;
}
(async () => {
  const { buildAuthorityBackedBrowserCache } = await import('../services/authorityProjectionCacheAdapter.mjs');
  const OldSidebar = sidebarFrom(historical), Sidebar = sidebarFrom(current);
  const teachers = [{ id: 'teacher-a', name: '林老师' }, { id: 'teacher-b', name: '周老师' }];
  const courses = [
    { id: 'INTERNAL-A', teacher_id: 'teacher-a', active: true, name: '2026 秋学期 初二物理', display_name: '初二物理', year: 2026, semester: '秋学期', room_name: '东湖上课点', type: types.CourseType.ONE_ON_ONE },
    { id: 'INTERNAL-B', teacher_id: 'teacher-a', active: true, name: '2025 春学期 双人讨论课', room_name: '西湖上课点', type: types.CourseType.ONE_ON_TWO },
    { id: 'INTERNAL-C', teacher_id: 'teacher-a', active: true, name: '2026提高班-A01', type: types.CourseType.GROUP },
    { id: 'INTERNAL-D', teacher_id: 'teacher-b', active: true, name: '其他老师的课程' },
    { id: 'INTERNAL-E', teacher_id: 'teacher-a', active: false, name: '已结课程' },
  ];
  const projection = { protocol: 'gewu.authority-projection.v1', sourceVersion: 1, payload: { courses, teachers } };
  const before = JSON.stringify(projection);
  const cache = buildAuthorityBackedBrowserCache({ projection });
  for (const selectedTeacherId of ['teacher-a', 'teacher-b', 'no-courses', undefined]) {
    const props = { teachers, courses, selectedTeacherId, onTeacherChange: () => {} };
    assert.deepEqual(view(Sidebar, { ...props, courses: cache.courses }), view(OldSidebar, props),
      'cloud-derived sidebar must preserve the original same-data display and filtering');
  }
  const selected = view(Sidebar, { teachers, courses: cache.courses, selectedTeacherId: 'teacher-a' });
  assert.equal(selected.width, '220px');
  assert.deepEqual(selected.headings, ['选择老师', '未结课程 (3)']);
  assert.deepEqual(selected.cards.map(card => card.lines), [
    ['初二物理', '2026 年 秋学期', '东湖上课点 一对一'],
    ['双人讨论课', '2025 年 春学期', '西湖上课点 一对二'],
    // UTF-8: the original year fallback reads the leading four digits, even without a semester.
    ['2026提高班-A01', '2026 年 -', '班课'],
  ]);
  assert(selected.cards.every(card => card.draggable === 'true'));
  assert(!JSON.stringify(selected).includes('INTERNAL-'));
  assert.deepEqual(view(Sidebar, { teachers: [], courses: [] }), view(OldSidebar, { teachers: [], courses: [] }));
  assert.deepEqual(view(Sidebar, { teachers, courses: [], selectedTeacherId: 'teacher-a' }).empty, ['暂无未结课程']);
  assert.deepEqual(view(Sidebar, { teachers, courses }).empty, ['请先选择老师']);
  assert.equal(JSON.stringify(projection), before, 'rendering and cache hydration must not rewrite cloud data');
  // UTF-8: an unconfirmed course completion only overlays local derived data.
  const outbox = [{ id: 'draft-complete', type: 'course.update.v1', status: 'awaiting_confirmation',
    payload: { id: 'INTERNAL-A', changes: { active: false } } }];
  const draftBefore = JSON.stringify(outbox);
  const pending = buildAuthorityBackedBrowserCache({ projection, outbox });
  const originalEditedCourses = courses.map(course => course.id === 'INTERNAL-A' ? { ...course, active: false } : course);
  assert.deepEqual(view(Sidebar, { teachers, courses: pending.courses, selectedTeacherId: 'teacher-a' }),
    view(OldSidebar, { teachers, courses: originalEditedCourses, selectedTeacherId: 'teacher-a' }));
  assert.equal(JSON.stringify(projection), before);
  assert.equal(JSON.stringify(outbox), draftBefore);
  // The comparison must detect an internal-ID regression, rather than merely execute successfully.
  const bad = sidebarFrom(current.replace('{getCourseDisplayName(course)}', '{course.id}'));
  assert.notDeepEqual(view(bad, { teachers, courses, selectedTeacherId: 'teacher-a' }), selected);
  console.log('original/cloud sidebar same-data rendering: teacher filtering, six states, labels and IDs passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
