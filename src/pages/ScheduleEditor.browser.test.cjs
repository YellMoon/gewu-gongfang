'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const ts = require('typescript');

const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'output/playwright/schedule-editor');
const entry = 'src/pages/ScheduleCalendar.tsx';
const modules = {};
const dependencies = {};

function collect(id) {
  if (modules[id]) return;
  const filename = path.join(root, id);
  const source = fs.readFileSync(filename, 'utf8');
  modules[id] = id.endsWith('.js') ? source : ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
    },
    fileName: id,
  }).outputText;
  dependencies[id] = {};
  for (const [, specifier] of modules[id].matchAll(/require\(["']([^"']+)["']\)/g)) {
    if (!specifier.startsWith('.') || specifier.endsWith('.css')) continue;
    const base = path.join(path.dirname(filename), specifier);
    const resolved = [base, base + '.ts', base + '.tsx', base + '.js', path.join(base, 'index.ts')]
      .find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
    assert(resolved, specifier);
    const dependency = path.relative(root, resolved).replaceAll('\\', '/');
    dependencies[id][specifier] = dependency;
    collect(dependency);
  }
}

const course = {
  id: 'course', name: '初二物理', display_name: '初二物理', teacher_id: 'teacher',
  teacher_name: '刘老师', type: 1, active: true, default_duration_minutes: 90,
  room_id: 'room', room_name: '和睦', billing_unit: 2,
  student_pricings: [
    { student_id: 'a', tuition: 220, teacher_fee: 110, status: 1 },
    { student_id: 'b', tuition: 200, teacher_fee: 100, status: 1 },
  ],
};

async function expectValue(locator, value) {
  assert.equal(await locator.inputValue(), value);
}

(async () => {
  collect(entry);
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, timezoneId: 'Asia/Shanghai' });
    page.setDefaultTimeout(6000);
    await page.clock.setFixedTime(new Date('2026-11-24T03:00:00Z'));
    const errors = [];
    page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
    page.on('console', message => { if (message.type() === 'error') { errors.push(message.text()); console.error(message.text()); } });
    await page.route('http://localhost:9876/', route => route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><title>课程表</title><div id="root"></div></html>',
    }));

    async function load() {
      await page.goto('http://localhost:9876/');
      for (const script of [
        'react/umd/react.production.min.js', 'react-dom/umd/react-dom.production.min.js',
        'dayjs/dayjs.min.js', 'dayjs/plugin/weekOfYear.js', 'dayjs/plugin/isoWeek.js', 'antd/dist/antd.min.js',
      ]) await page.addScriptTag({ path: path.join(root, 'node_modules', script) });
      for (const style of ['src/index.css', 'src/pages/ScheduleEditor.css']) {
        await page.addStyleTag({ path: path.join(root, style) });
      }
      await page.evaluate(({ modules, dependencies, entry, course }) => {
        const external = {
          react: window.React, antd: window.antd, dayjs: window.dayjs,
          'dayjs/plugin/weekOfYear': window.dayjs_plugin_weekOfYear,
          'dayjs/plugin/isoWeek': window.dayjs_plugin_isoWeek,
          uuid: { v4: () => crypto.randomUUID() },
        };
        const cache = new Map();
        function loadModule(id) {
          if (cache.has(id)) return cache.get(id).exports;
          const module = { exports: {} };
          cache.set(id, module);
          const require = specifier => {
            if (specifier.endsWith('.css')) return;
            if (Object.hasOwn(external, specifier)) return external[specifier];
            const dependency = dependencies[id][specifier];
            if (!dependency) throw Error('Unknown module: ' + specifier);
            return loadModule(dependency);
          };
          new Function('require', 'module', 'exports', modules[id])(require, module, module.exports);
          return module.exports;
        }
        const saved = () => JSON.parse(localStorage.getItem('primary-schedule-fixture') || '[]');
        window.dbService = {
          getAllSchedules: saved,
          replaceSchedules: rows => {
            localStorage.setItem('primary-schedule-fixture', JSON.stringify(rows));
            return saved();
          },
          getAllCourses: () => [course],
          getAllTeachers: () => [{ id: 'teacher', name: '刘老师' }],
          getAllRooms: () => [{ id: 'room', name: '和睦' }],
          getAllStudents: () => [{ id: 'a', name: '张同学' }, { id: 'b', name: '李同学' }],
        };
        const Calendar = loadModule(entry).default;
        window.ReactDOM.createRoot(document.getElementById('root')).render(window.React.createElement(Calendar));
      }, { modules, dependencies, entry, course });
      await page.getByRole('button', { name: /^排\s*课$/ }).waitFor();
    }

    async function select(dialog, field, option) {
      await dialog.getByRole('combobox', { name: field, exact: true }).locator('xpath=ancestor::div[contains(@class,"ant-select-selector")]').click();
      const options = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option-content');
      await options.filter({ hasText: new RegExp('^' + option + '$') }).click();
    }

    async function waitForDialogMotion() {
      await page.waitForFunction(() => {
        const dialog = document.querySelector('.schedule-editor[role="dialog"]');
        if (!dialog || /-(appear|enter|leave)( |-|$)/.test(dialog.className)) return false;
        const style = getComputedStyle(dialog);
        return style.opacity === '1' && style.transform === 'none';
      });
    }

    const readSaved = () => page.evaluate(() => window.dbService.getAllSchedules());
    await load();
    await page.getByRole('button', { name: /^排\s*课$/ }).click();
    const create = page.getByRole('dialog', { name: '新建排课' });
    await select(create, '老师', '刘老师');
    await select(create, '课程', '初二物理');
    await create.getByRole('table', { name: '默认学生出勤和费用' }).waitFor();
    assert.equal(await create.locator('#room').locator('..').locator('..').locator('.ant-select-selection-item').innerText(), '和睦');
    assert.match(await create.getByRole('row', { name: /张同学/ }).innerText(), /正常出勤\s+220\s+110/);
    assert.equal(await create.getByRole('spinbutton', { name: '张同学 学费' }).count(), 0);
    await create.getByLabel('开始时间').click();
    const timePopup = page.locator('.ant-picker-dropdown:not(.ant-picker-dropdown-hidden)');
    await timePopup.locator('.ant-picker-time-panel-column').nth(0).getByText('14', { exact: true }).click();
    await timePopup.locator('.ant-picker-time-panel-column').nth(1).getByText('00', { exact: true }).click();
    await timePopup.getByRole('button', { name: 'OK', exact: true }).click();
    await expectValue(create.getByLabel('开始时间'), '14:00');
    const dateStep = create.getByLabel('间隔天数', { exact: true });
    const decrease = create.getByRole('button', { name: '减少间隔天数' });
    const increase = create.getByRole('button', { name: '增加间隔天数' });
    assert(await decrease.isDisabled());
    await increase.click();
    await expectValue(dateStep, '2');
    await decrease.click();
    await expectValue(dateStep, '1');
    await dateStep.fill('2');
    await dateStep.press('Tab');
    const addDate = create.getByRole('button', { name: '添加日期' });
    await addDate.click();
    await addDate.click();
    await addDate.click();
    const dateEntries = create.locator('.schedule-editor__date-list .schedule-editor__date-entry');
    const desktopDates = await dateEntries.evaluateAll(entries =>
      entries.map(entry => ({ x: entry.offsetLeft, y: entry.offsetTop })));
    assert.equal(desktopDates.length, 3);
    assert(desktopDates.every(date => date.y === desktopDates[0].y), 'three additional dates fit across the desktop row');
    assert(desktopDates[0].x < desktopDates[1].x && desktopDates[1].x < desktopDates[2].x);
    await waitForDialogMotion();
    await create.screenshot({ path: path.join(output, 'new-batch.png') });
    await create.getByRole('button', { name: '删除第 4 个日期' }).click();
    await create.getByRole('button', { name: '删除第 3 个日期' }).click();
    assert.match(await create.innerText(), /共 2 节课程/);
    await create.getByRole('button', { name: '保存排课' }).click();
    await create.waitFor({ state: 'hidden' });
    const created = await readSaved();
    assert.equal(created.length, 2);
    assert.deepEqual(created.map(item => new Date(item.start_time).getUTCDate()), [24, 26]);
    assert.deepEqual(created[0].student_pricings, course.student_pricings);
    await page.evaluate(() => window.dbService.replaceSchedules(window.dbService.getAllSchedules().map((row, i) => i === 0 ? { ...row, notes: '历史备注' } : row)));
    await load();

    const card = page.locator(`[data-schedule-id="${created[0].id}"]`);
    await card.dblclick();
    const detail = page.getByRole('dialog', { name: '排课明细' });
    await detail.waitFor();
    await expectValue(detail.getByLabel('张同学 学费'), '220');
    await select(detail, '张同学 出勤', '请假');
    await detail.getByLabel('张同学 学费').fill('241.25');
    await detail.getByLabel('李同学 课时费').fill('85.5');
    assert.equal(await detail.getByLabel('备注').count(), 0);
    await detail.getByRole('button', { name: '保存修改' }).click();
    await detail.waitFor({ state: 'hidden' });
    const [updated, other] = await readSaved();
    assert.deepEqual(updated.student_pricings, [
      { student_id: 'a', tuition: 241.25, teacher_fee: 110, status: 4 },
      { student_id: 'b', tuition: 200, teacher_fee: 85.5, status: 1 },
    ]);
    assert.equal(updated.calculated_tuition, 200);
    assert.equal(updated.calculated_teacher_fee, 85.5);
    assert.equal(updated.notes, '历史备注');

    assert.deepEqual(other, created[1]);

    await load();
    await card.click({ button: 'right' });
    await page.getByRole('menuitem', { name: '查看排课明细' }).click();
    await detail.waitFor();
    await expectValue(detail.getByLabel('张同学 学费'), '241.25');
    await expectValue(detail.getByLabel('李同学 课时费'), '85.5');
    assert.match(await detail.getByRole('row', { name: /张同学/ }).innerText(), /请假/);
    await waitForDialogMotion();
    const widths = await detail.locator('.schedule-editor__field-groups .ant-select, .schedule-editor__field-groups .ant-picker')
      .evaluateAll(controls => controls.map(control => control.getBoundingClientRect().width));
    assert.equal(widths.length, 8);
    assert(widths.every(width => width === 128), 'desktop detail controls share a compact column width');
    assert(await detail.getByRole('columnheader').evaluateAll(headers =>
      headers.length === 4 && headers.every(header => getComputedStyle(header).textAlign === 'center')));
    assert(await detail.locator('.schedule-editor__field-groups label').evaluateAll(labels =>
      labels.every(label => {
        const line = document.createRange();
        line.selectNodeContents(label);
        return line.getClientRects().length === 1;
      })), 'desktop labels stay on one line');
    await detail.screenshot({ path: path.join(output, 'saved-detail.png') });
    await page.setViewportSize({ width: 420, height: 700 });
    assert((await detail.boundingBox()).width <= 420);
    const saveBox = await detail.getByRole('button', { name: '保存修改' }).boundingBox();
    assert(saveBox.y >= 0 && saveBox.y + saveBox.height <= 700);
    const attendance = detail.locator('.schedule-editor__table tbody tr:last-child .ant-select-selection-item');
    assert(await attendance.evaluate(el => el.scrollWidth <= el.clientWidth), 'attendance text fits at 420px');
    await page.screenshot({ path: path.join(output, 'narrow.png') });
    await detail.getByRole('button', { name: /^取\s*消$/ }).click();
    await page.getByRole('button', { name: /^排\s*课$/ }).click();
    await select(create, '老师', '刘老师');
    await select(create, '课程', '初二物理');
    assert.equal(await create.locator('#room').locator('..').locator('..').locator('.ant-select-selection-item').innerText(), '和睦');
    assert.match(await create.getByRole('row', { name: /张同学/ }).innerText(), /正常出勤\s+220\s+110/);
    await addDate.click();
    await addDate.click();
    await addDate.click();
    const narrowDates = await dateEntries.evaluateAll(entries => entries.map(entry => entry.offsetTop));
    assert.equal(narrowDates.length, 3);
    assert.equal(narrowDates[0], narrowDates[1]);
    assert(narrowDates[1] < narrowDates[2], 'the third additional date wraps at 420px');
    const nextDate = await dateEntries.first().locator('input').inputValue();
    await create.getByRole('button', { name: '删除首个日期' }).click();
    await expectValue(create.getByLabel('上课日期', { exact: true }), nextDate);
    assert.deepEqual(errors, []);
    console.log('Schedule editor: batch dates, default preview, per-lesson edit, reload and narrow layout passed.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
