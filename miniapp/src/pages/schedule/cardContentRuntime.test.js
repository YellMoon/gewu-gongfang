'use strict';
// Execute the actual miniapp page and compare its cards with the actual desktop JSX.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { JSDOM } = require('jsdom');
const dayjs = require('dayjs');
const { pathToFileURL } = require('node:url');
const projection = require('../../utils/cloudBusinessProjection');
const desktopColors = require('./desktopCourseColors.test-support');
const compiledCss = require(path.resolve(__dirname, '../../../..', 'miniapp/node_modules/sass')).compileString(fs.readFileSync(path.join(__dirname, 'index.scss'), 'utf8')).css;
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [];
const desktopSource = fs.readFileSync(path.resolve(__dirname, '../../../../src/pages/ScheduleCalendar.tsx'), 'utf8');
const desktopAst = ts.createSourceFile('ScheduleCalendar.tsx', desktopSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let desktopCard, desktopStyle, desktopStatusStyle;
function visit(node) {
  if (ts.isJsxExpression(node) && node.expression?.getText(desktopAst) === 'schedule.course_name') desktopCard = node.parent.parent;
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'getStatusStyle') desktopStatusStyle = node;
  if (ts.isJsxOpeningElement(node) && node.attributes.properties.some(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(desktopAst) === 'data-course-card')) desktopStyle = node.attributes.properties.find(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(desktopAst) === 'style').initializer.expression;
  ts.forEachChild(node, visit);
}
visit(desktopAst);
assert.ok(desktopCard, 'reference must be the settled desktop card, not a copied template');
const renderDesktop = new Function('React', 'dayjs', 'schedule', 'roomDisplay', 'textColor', 'isDragging', ts.transpileModule(`return (${desktopCard.getText(desktopAst)});`, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText);
const statuses = { PLANNED: 1, COMPLETED: 2, CANCELLED: 3, LEAVE: 4 };
const statusStyle = new Function('ScheduleStatus', 'DEFAULT_COURSE_COLOR', ts.transpileModule(`return (${desktopStatusStyle.getText(desktopAst)});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText)(statuses, desktopColors.DEFAULT_COURSE_COLOR);
const finalDesktopStyle = new Function('pos', 'isDragging', 'getStatusStyle', 'schedule', 'courseColor', 'dragState', 'isFlashing', ts.transpileModule(`return (${desktopStyle.getText(desktopAst)});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText);
const lines = element => {
  const window = new JSDOM(renderToStaticMarkup(element)).window;
  const result = [...window.document.body.firstElementChild.children].map(child => child.textContent);
  window.close(); return result;
};
const toReact = tree => Array.isArray(tree) ? tree.map((child, index) => child && typeof child === 'object' ? React.cloneElement(toReact(child), { key: index }) : toReact(child)) : tree && typeof tree === 'object' ? React.createElement(tree.type === 'Text' ? 'span' : 'div', { className: tree.props.className, style: tree.props.style }, toReact(tree.props.children)) : tree;

function harness(role, data) {
  const state = [], show = []; let cursor = 0;
  const identity = { id: role, role, user_type: role };
  const jsx = (type, props) => ({ type, props: props || {} });
  const slot = value => { const i = cursor++; if (!(i in state)) state[i] = value; return i; };
  const deps = {
    react: { useState: value => { const i = slot(typeof value === 'function' ? value() : value); return [state[i], next => { state[i] = typeof next === 'function' ? next(state[i]) : next; }]; }, useRef: value => state[slot({ current: value })], useMemo: fn => fn(), useEffect: () => {} },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    '@tarojs/components': { View: 'View', Text: 'Text', ScrollView: 'ScrollView' },
    '@tarojs/taro': { default: { stopPullDownRefresh: () => {}, navigateTo: () => {} }, useDidShow: fn => show.push(fn), useDidHide: () => {}, usePullDownRefresh: () => {} },
    '../../types': { ScheduleStatus: statuses },
    '../../../../shared/courseColors': desktopColors,
    '../../../../shared/calendarHolidays': require(path.resolve(__dirname, '../../../../shared/calendarHolidays')),
    '../../utils/storage': { getCachedList: key => data[key] || [] },
    '../../utils/sync': { pullFromCloudBusinessProjection: async () => true },
    '../../utils/cloudBusinessProjection': projection,
    '../../components/shared': { EmptyState: 'Empty', LoadingSkeleton: 'Loading' },
    '../../components/ForbiddenContent': { default: 'Forbidden' },
    '../../utils/authSession': { authSessionRuntime: { capture: () => ({ identity }), isSameSession: () => true } },
    '../../utils/miniappPageAccess': { canAccessMiniappPage: () => true, refreshMiniappPageAccess: async () => true },
    '../../utils/accountExperience': { isVisitorIdentity: user => user.role === 'visitor' },
    '../../utils/permission': { isStudentScopedUser: () => ['student', 'family_member'].includes(role) }, './index.scss': {},
  };
  const js = ts.transpileModule(fs.readFileSync(path.join(__dirname, 'index.tsx'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 } }).outputText;
  const m = { exports: {} };
  new Function('require', 'module', 'exports', js)(name => { assert.ok(Object.hasOwn(deps, name), name); return deps[name]; }, m, m.exports);
  const render = () => { cursor = 0; return m.exports.default(); };
  const find = cls => nodes(render()).filter(node => (node.props.className || '').split(' ').includes(cls));
  return { mount: async () => { render(); await show[0](); }, find };
}

module.exports = { harness, nodes, toReact };
if (require.main === module) (async () => {
  const { resolveCalendarRoomDisplay } = await import(pathToFileURL(path.resolve(__dirname, '../../../../src/utils/scheduleRoomDisplay.mjs')).href);
  const today = projection.shanghaiDateKey(new Date());
  const cases = [
    { name: '初二物理', scheduleRoom: '旧地点', course: { display_name: '初二物理', room_name: '东湖上课点' } },
    { name: 'E2E-20260905-物理课程', scheduleRoom: 'room-b', course: { name: 'E2E-20260905-物理课程' } },
    { name: '2026提高班-A01', scheduleRoom: '', course: { name: '2026 上学期 2026提高班-A01', room_id: 'room-a, room-b' } },
    { name: '历史课程完整名称', scheduleRoom: '旧地点,备用地点', course: null },
    { name: '无地点课程', scheduleRoom: '', course: { display_name: ' 无地点课程 ' } },
    { name: '长地点时间完整', scheduleRoom: '非常长的真实上课地点名称，不能挤掉结束时间', course: null },
  ];
  for (const role of ['super_admin', 'teacher', 'student', 'family_member']) {
    for (const [index, sample] of cases.entries()) {
      const schedule = { id: 'schedule', course_id: 'course', course_name: sample.name, course_type: 4, start_time: today + 'T10:05:00', end_time: today + 'T12:35:00', status: index % 4 + 1, room: sample.scheduleRoom };
      const course = sample.course && { id: 'course', type: 4, ...sample.course };
      const rooms = [{ id: 'room-a', name: '东区A教室' }, { id: 'room-b', name: '西区B教室' }];
      const data = { schedules: [schedule], courses: course ? [course] : [], students: [], rooms };
      const before = structuredClone(data);
      const h = harness(role, data); await h.mount();
      const expected = lines(renderDesktop(React, dayjs, schedule, resolveCalendarRoomDisplay(schedule, course || {}, rooms), '#333', false));
      for (const mode of ['two-weeks']) {
        const cards = h.find('schedule-card'); assert.equal(cards.length, 1);
        const body = h.find('schedule-body')[0];
        assert.deepEqual(lines(toReact(body)), expected, role + '/' + mode + ': complete name then resolved place and full time; no index/type/status');
        assert.deepEqual(cards[0].props.children, body, 'card must have one centered content wrapper');
      }
      assert.deepEqual(data, before, 'display normalization cannot rewrite cloud data');
    }
  }
  // Missing end time must stay absent, never fabricate a duration.
  const h = harness('teacher', { schedules: [{ id: 'missing-end', course_id: 'course', course_name: '保留缺失时间', start_time: today + 'T09:15:00', end_time: '', status: 1 }], courses: [], students: [], rooms: [] });
  await h.mount();
  assert.deepEqual(lines(toReact(h.find('schedule-card')[0].props.children)), ['保留缺失时间', '09:15']);
  const colorCourses = [{ id: 'one', room_id: 'room-a' }, { id: 'two', room_name: '西区B教室' }, { id: 'three', room_name: '南区C教室', color: '#000000' }, { id: 'four', room_id: 'room-a' }, { id: 'unbound' }, { id: 'authoritative-dark', calendar_color: '#102030' }];
  const rooms = [{ id: 'room-a', name: '东区A教室' }];
  const colors = desktopColors.buildCourseColorMap(colorCourses, rooms);
  assert.notEqual(colors.one, colors.two, 'fixture must actually exercise multiple course colors');
  assert.equal(colors.one, colors.four, 'desktop assigns the same color to the same place');
  assert.notEqual(colors.three, '#000000', 'desktop does not use stored arbitrary course.color');
  for (const role of ['super_admin', 'teacher', 'student', 'family_member']) {
    const schedules = colorCourses.flatMap(course => Object.values(statuses).map(status => ({ id: `${course.id}-${status}`, course_id: course.id, course_name: course.id, start_time: today + 'T10:05:00', end_time: today + 'T12:35:00', status })));
    const page = harness(role, { schedules, courses: colorCourses, rooms, students: [] }); await page.mount();
    for (const mode of ['two-weeks']) {
      page.find('schedule-card').forEach((card, index) => {
        const schedule = schedules[index], background = colors[schedule.course_id];
        const expected = finalDesktopStyle({ top: 0, height: 100 }, false, statusStyle, schedule, background, null, false);
        assert.equal(card.props.style?.background, expected.background, role + '/' + mode + ' must use desktop location color');
        assert.equal(card.props.style?.opacity, expected.opacity, 'compare final static JSX opacity, including overrides after status style');
        assert.equal(card.props.style?.border, expected.border, 'compare final static JSX border, not a drag state');
        const window = new JSDOM(`<style>${compiledCss}</style>${renderToStaticMarkup(toReact(card))}`).window;
        const actualCard = window.getComputedStyle(window.document.querySelector('.schedule-card'));
        assert.equal(actualCard.opacity, String(expected.opacity), 'status CSS must not override settled desktop opacity');
        assert.equal(actualCard.borderTopWidth, '', 'miniapp must not add a border absent from settled desktop JSX');
        assert.equal(window.getComputedStyle(window.document.querySelector('.schedule-time-range')).flexShrink, '0', 'complete end time receives space before truncating a long place');
        for (const selector of ['.schedule-course', '.schedule-location-time']) assert.equal(window.getComputedStyle(window.document.querySelector(selector)).color, desktopColors.getTextColorForBackground(background) === '#333333' ? 'rgb(51, 51, 51)' : 'rgb(255, 255, 255)', 'both rendered lines must use desktop text contrast color');
        window.close();
      });
    }
  }
  // A scoped role must keep the globally derived color without receiving other courses.
  for (const role of ['teacher', 'student', 'family_member']) {
    const scopedCourse = { ...colorCourses[2], calendar_color: colors.three };
    const scopedSchedule = { id: 'scoped-color', course_id: scopedCourse.id, course_name: '范围内课程', start_time: today + 'T10:05:00', end_time: today + 'T12:35:00', status: 1 };
    const scoped = harness(role, { schedules: [scopedSchedule], courses: [scopedCourse], rooms: [], students: [] }); await scoped.mount();
    assert.equal(scoped.find('schedule-card')[0].props.style.background, colors.three, role + ' must retain authoritative calendar_color despite a different subset and missing global rooms');
  }
  console.log('actual miniapp/desktop two-week card content and final static color/style parity passed for four roles, rooms, history, names, missing end time, all statuses and authoritative scoped colors');
})().catch(error => { console.error(error); process.exitCode = 1; });
