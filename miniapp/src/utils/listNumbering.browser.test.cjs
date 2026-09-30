'use strict';
// Render the actual record-list JSX with native View/Text adapters. This is a
// focused numbering check, not a substitute for the full WeChat UI matrix.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { chromium } = require('playwright');
const sass = require('../../node_modules/sass');
const root = path.resolve(__dirname, '../..');
const source = page => {
  const file = path.join(root, 'src/pages', page, 'index.tsx');
  return ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
};
function mapExpression(page, collection) {
  let found;
  const visit = node => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === 'map' && node.expression.expression.getText() === collection) found = node.getText();
    ts.forEachChild(node, visit);
  };
  visit(source(page));
  assert.ok(found, page + '/' + collection);
  return found;
}
function evaluate(expression, fixtures) {
  const context = { React, View: 'div', Text: 'span', Taro: { navigateTo() {} }, ...fixtures };
  const code = ts.transpileModule('const result = ' + expression + ';', {
    compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  return new Function(...Object.keys(context), code + '\nreturn result;')(...Object.values(context));
}
const course = (id, name) => ({ id, name, type: 1, billing_unit: 1, price_tuition: 100, price_teacher: 80 });
const common = { TYPE_LABELS: { 1: '一对一' }, SOURCE_LABELS: {}, StudentSource: { SELF: 1 },
  studentSchoolLabel: () => '', studentGradeLabel: () => '', PaymentType: { TUITION: 1, HOURS: 2 },
  getStudentName: () => '学生甲', sortPaymentsNewestFirst: rows => [...rows].sort((a, b) => b.payment_date.localeCompare(a.payment_date)) };
const scenarios = [
  { page: 'courses', collection: 'activeCourses', selector: '.course-name', fixtures: { activeCourses: [course('a', '物理提高'), course('b', '数学复习')], isStudent: false }, expected: ['1. 物理提高', '2. 数学复习'] },
  { page: 'courses', collection: 'inactiveCourses', selector: '.course-name', fixtures: { activeCourses: [course('a', '物理提高'), course('b', '数学复习')], inactiveCourses: [course('c', '已结课程')] }, expected: ['3. 已结课程'] },
  { page: 'students', collection: 'filteredStudents', selector: '.student-name', fixtures: { filteredStudents: [{ id: 'a', name: '学生甲' }, { id: 'b', name: '学生乙' }] }, expected: ['1. 学生甲', '2. 学生乙'] },
  { page: 'teachers', collection: 'teachers', selector: '.teacher-name', fixtures: { teachers: [{ id: 'a', name: '教师甲' }, { id: 'b', name: '教师乙' }] }, expected: ['1. 教师甲', '2. 教师乙'] },
  { page: 'payments', collection: 'sortPaymentsNewestFirst(filteredPayments)', selector: '.pay-student', fixtures: { filteredPayments: [{ id: 'old', payment_date: '2026-09-01', amount: 100, payment_type: 1 }, { id: 'new', payment_date: '2026-09-02', amount: 200, payment_type: 1 }] }, expected: ['1. 学生甲', '2. 学生甲'] },
];
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const output = path.join(root, '../output/list-numbering-20260930/miniapp');
  fs.mkdirSync(output, { recursive: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 760 } });
    for (const scenario of scenarios) {
      const expression = mapExpression(scenario.page, scenario.collection);
      const tree = evaluate(expression, { ...common, ...scenario.fixtures });
      const css = sass.compile(path.join(root, 'src/pages', scenario.page, 'index.scss')).css
        .replace(/(-?\d+(?:\.\d+)?)rpx/g, (_match, n) => Number(n) / 2 + 'px');
      await page.setContent('<style>body{margin:0;background:#f7f4ee;font:14px sans-serif}span{display:inline-block}' + css + '</style><main class="' + scenario.page + '-page">' + renderToStaticMarkup(tree) + '</main>');
      assert.deepEqual(await page.locator(scenario.selector).allTextContents(), scenario.expected);
      if (scenario.page === 'payments') assert.match(await page.locator('.pay-date').first().innerText(), /2026-09-02/, 'numbers follow sorted rows');
      await page.screenshot({ path: path.join(output, scenario.page + '-' + scenarios.indexOf(scenario) + '.png'), fullPage: true });
    }
    // Filtering restarts visible numbering; the source ID is deliberately unchanged.
    const filtered = evaluate(mapExpression('students', 'filteredStudents'), { ...common, filteredStudents: [{ id: 'b', name: '学生乙' }] });
    await page.setContent(renderToStaticMarkup(filtered));
    assert.equal(await page.locator('.student-name').innerText(), '1. 学生乙');
    let cardExpression;
    const visit = node => {
      if (ts.isVariableDeclaration(node) && node.name.getText() === 'renderScheduleCard') cardExpression = node.initializer.getText();
      ts.forEachChild(node, visit);
    };
    visit(source('schedule'));
    const schedule = id => ({ id, course_name: '课程' + id, start_time: '10:00', status: 1 });
    const schedules = { monday: [schedule('甲'), schedule('乙')], tuesday: [schedule('丙')] };
    const renderScheduleCard = evaluate(cardExpression, { getStatusClass: () => 'planned', formatTime: value => value,
      getCourseTypeLabel: () => '一对一', getStatusLabel: () => '未上课' });
    const week = evaluate(mapExpression('schedule', 'weekRange'), { weekRange: ['monday', 'tuesday'],
      getSchedulesForDate: key => schedules[key], isToday: () => false, getDayTitle: key => key, renderScheduleCard });
    await page.setContent(renderToStaticMarkup(week));
    assert.deepEqual(await page.locator('.schedule-course').allTextContents(), ['1. 课程甲', '2. 课程乙', '3. 课程丙']);
    console.log('miniapp actual list JSX numbering, grouped-course/weekly continuity, sorting and filtering passed; 5 focused screenshots');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
