'use strict';
// Real calendar day components, drag handlers and course submit/footer; controlled transport.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const ts = require('typescript'), { chromium } = require('playwright');
const { code: calendar } = require('./ScheduleCalendar.local-date.test.js');
const root = path.resolve(__dirname, '../..'), out = path.join(root, 'output/schedule-interaction-20261015');
fs.mkdirSync(out, { recursive: true });
const compile = text => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
function declarations(file) {
  const ast = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), found = {};
  function visit(n) {
    if (ts.isFunctionDeclaration(n) && n.name) found[n.name.text] = n.getText(ast);
    if (ts.isVariableDeclaration(n) && n.initializer) found[n.name.getText(ast)] = n.initializer.getText(ast);
    ts.forEachChild(n, visit);
  }
  visit(ast); return found;
}
const schedule = declarations('src/pages/ScheduleCalendar.tsx'), course = declarations('src/pages/CourseList.tsx');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, timezoneId: 'Asia/Shanghai' });
    page.on('pageerror', error => { errors.push(error.message); console.error('browser pageerror: ' + error.message); });
    await page.route('**/*', route => route.abort());
    await page.route('http://regression.test/', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<html lang="zh-CN"><head><meta charset="UTF-8"><title>Schedule interaction regression</title></head><body><div id="root"></div></body></html>' }));
    await page.goto('http://regression.test/');
    for (const file of ['react/umd/react.production.min.js','react-dom/umd/react-dom.production.min.js','dayjs/dayjs.min.js','dayjs/plugin/isoWeek.js','antd/dist/antd.min.js']) await page.addScriptTag({ path: path.join(root, 'node_modules', file) });
    await page.evaluate(({ calendar, handlers }) => {
      const React = window.React, dayjs = window.dayjs; dayjs.extend(window.dayjs_plugin_isoWeek);
      const env = { React, dayjs, ...React, Dropdown: window.antd.Dropdown, holidays2026: [],
        ScheduleStatus: { PLANNED: 1, CANCELLED: 3, LEAVE: 4 }, DEFAULT_COURSE_COLOR: '#1890ff',
        getTextColorForBackground: () => '#fff', resolveCalendarRoomDisplay: () => 'Room' };
      const Week = new Function(...Object.keys(env), calendar)(...Object.values(env));
      const original = [{ id: 'original', course_id: 'course', course_name: 'Physics', status: 1,
        start_time: '2026-10-15T02:00:00Z', end_time: '2026-10-15T03:00:00Z', calculated_tuition: 180 },
      { id: 'occupied', course_id: 'course', course_name: 'Math', status: 1, start_time: '2026-10-15T04:00:00Z', end_time: '2026-10-15T05:00:00Z' }];
      window.writes = []; window.rows = original; window.warnings = [];
      function App() {
        const [rows, setRows] = React.useState(original);
        window.rows = rows;
        const dependencies = { dayjs, schedules: rows, courses: [], rooms: [], MIN_START_HOUR: 8, SLOT_DURATION: 5, GLOBAL_MAX_SLOT: 192,
          ScheduleStatus: env.ScheduleStatus, message: { warning: text => { window.warnings.push(text); window.antd.message.warning(text); }, success: () => {} },
          uuidv4: () => 'copy', resolveCalendarRoomDisplay: () => 'Room', buildFinancialFieldsForSchedule: () => ({}),
          setSchedulesWithHistory: updater => { const next = typeof updater === 'function' ? updater(rows) : updater; window.writes.push(next); localStorage.setItem('lessons', JSON.stringify(next)); window.ReactDOM.flushSync(() => setRows(next)); }, window };
        const actions = new Function(...Object.keys(dependencies), handlers + '\nreturn {handleDragSchedule,handleResizeSchedule};')(...Object.values(dependencies));
        return React.createElement(Week, { startMonday: dayjs('2026-10-12'), schedules: rows, courses: [], rooms: [],
          onDragSchedule: actions.handleDragSchedule, onResizeSchedule: actions.handleResizeSchedule,
          onDoubleClickDate() {}, onDoubleClickSchedule() {}, onScheduleStatusChange() {}, onDropCourse() {} });
      }
      window.fixtureRoot = window.ReactDOM.createRoot(document.getElementById('root'));
      window.fixtureRoot.render(React.createElement(App));
    }, { calendar, handlers: compile(['slotToTime','checkOverlap','handleDragSchedule','handleResizeSchedule'].map(name => schedule[name]).join('\n')) });
    const card = page.locator('[data-schedule-id="original"]');
    await card.waitFor();
    const box = await card.boundingBox(), body = await page.locator('[data-date="2026-10-15"] [data-day-body]').boundingBox();
    await page.mouse.move(box.x + 50, box.y + box.height / 2); await page.mouse.down();
    await page.mouse.move(box.x + 50, body.y + 48 * 2.5 + 15, { steps: 10 });
    assert.equal(await page.evaluate(() => window.writes.length), 0, 'holding drag over overlap must not persist or enqueue');
    assert.equal(await page.evaluate(() => window.warnings.length), 0, 'no conflict notification before mouse release');
    await page.screenshot({ path: path.join(out, 'drag-held-overlap.png') });
    await page.mouse.move(box.x + 50, body.y + 36 * 2.5 + 15, { steps: 6 }); await page.mouse.up();
    await page.waitForFunction(() => window.writes.length > 0 || window.warnings.length > 0);
    await page.waitForFunction(() => window.rows.find(r => r.id === 'original').start_time === '2026-10-15T03:00:00.000Z');
    assert.equal(await page.evaluate(() => window.rows.find(r => r.id === 'original').start_time), '2026-10-15T03:00:00.000Z');
    const moved = await card.boundingBox();
    await page.keyboard.down('Control'); await page.mouse.move(moved.x + 50, moved.y + moved.height / 2); await page.mouse.down();
    await page.mouse.move(moved.x + 50, body.y + 48 * 2.5 + 15, { steps: 6 });
    assert.equal(await page.evaluate(() => window.writes.length), 1);
    await page.mouse.up(); await page.keyboard.up('Control');
    await page.waitForFunction(() => window.warnings.length === 1);
    assert.equal(await page.evaluate(() => window.writes.length), 1, 'overlap copy does not save');
    assert.equal(await page.evaluate(() => window.rows.length), 2);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('lessons'))[0].start_time), '2026-10-15T03:00:00.000Z');
    await page.screenshot({ path: path.join(out, 'overlap-restored.png') });

    await page.evaluate(({ submit, footer }) => {
      const React = window.React, { Button } = window.antd;
      window.saves = 0; window.busy = []; window.fixtureClosed = 0;
      const values = { display_name: 'Physics', type: 1, source_type: 1, teacher_id: 'teacher', year: 2026, semester: 'Autumn', room_id: 'room', color: '#fff', student_pricings: [] };
      function App() {
        const [saving, setSaving] = React.useState(false), savingRef = React.useRef(false);
        const env = { saving, savingRef, setSaving: value => { window.busy.push(value); setSaving(value); },
          form: { getFieldsValue: () => values, validateFields: async () => values }, students: [], teachers: [], rooms: [], dbService: {}, editingCourse: null,
          CourseSourceType: { INSTITUTION: 2, MIXED: 3 }, message: window.antd.message, console,
          sanitizeCourseStudentPricings: x => x, resolveCourseRoomSelection: async () => ({ id: 'room', name: 'Room' }),
          submitCourseToAuthority: async () => { window.saves++; await new Promise(resolve => { window.finishSave = resolve; }); return true; },
          setModalVisible: () => { window.fixtureClosed++; }, setTimeout: callback => callback(), loadData: () => {}, navigator };
        const handleSubmit = new Function(...Object.keys(env), submit)(...Object.values(env));
        window.submit = handleSubmit;
        return new Function('React','Button','saving','handleSubmit','setModalVisible',footer)(React,Button,saving,handleSubmit,env.setModalVisible);
      }
      window.fixtureRoot.render(React.createElement(App));
    }, { submit: compile('return (' + course.handleSubmit + ');'), footer: compile('return (' + course.modalFooter + ');') });
    await page.getByRole('button', { name: /^确\s*定$/ }).click();
    await page.waitForFunction(() => window.saves === 1);
    await page.evaluate(() => { window.submit(); window.submit(); window.submit(); });
    assert.equal(await page.evaluate(() => window.saves), 1, 'same-tick/programmatic double clicks remain single-flight');
    assert.equal(await page.getByRole('button', { name: '保存中' }).count(), 1);
    await page.screenshot({ path: path.join(out, 'course-save-in-progress.png') });
    await page.evaluate(() => window.finishSave());
    await page.getByRole('button', { name: /^确\s*定$/ }).waitFor();
    assert.equal(await page.evaluate(() => window.fixtureClosed), 1);
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(out, 'checks.json'), JSON.stringify({ browser: 'Chrome/Playwright', reason: 'Browser plugin not available', viewport: '1280x900', heldDragWrites: 0, validDropWrites: 1, rejectedCopyWrites: 0, repeatedClicksRequests: 1, errors }, null, 2), 'utf8');
    console.log('rendered real calendar held-drag/drop/copy and real course save footer repeated-click/loading/recovery checks passed');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
