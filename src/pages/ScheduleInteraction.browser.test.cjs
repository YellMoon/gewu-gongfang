'use strict';
// Real calendar day components, drag handlers and course submit/footer; controlled transport.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const ts = require('typescript'), { chromium } = require('playwright');
const { code: calendar } = require('./ScheduleCalendar.local-date.test.js');
const root = path.resolve(__dirname, '../..'), out = path.join(require('node:os').tmpdir(), 'gewu-schedule-interaction-20261017');
fs.mkdirSync(out, { recursive: true });
const compile = text => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
function declarations(file) {
  const ast = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), found = {};
  function visit(n) {
    if (ts.isFunctionDeclaration(n) && n.name) found[n.name.text] = n.getText(ast);
    if (ts.isVariableDeclaration(n) && n.initializer) found[n.name.getText(ast)] = n.initializer.getText(ast);
    if (ts.isJsxElement(n) && n.openingElement.tagName.getText(ast) === 'Form.Item'
      && n.openingElement.attributes.properties.some(p => p.name?.text === 'name' && p.initializer?.text === 'startTime')) found.startTimeField = n.getText(ast);
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
    page.on('console', entry => { if (entry.type() === 'error') errors.push(entry.text()); });
    await page.route('**/*', route => route.abort());
    await page.route('http://regression.test/', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<html lang="zh-CN"><head><meta charset="UTF-8"><title>Schedule interaction regression</title></head><body><div id="root"></div></body></html>' }));
    await page.goto('http://regression.test/');
    for (const file of ['react/umd/react.production.min.js','react-dom/umd/react-dom.production.min.js','dayjs/dayjs.min.js','dayjs/plugin/isoWeek.js','antd/dist/antd.min.js']) await page.addScriptTag({ path: path.join(root, 'node_modules', file) });
    await page.evaluate(({ calendar, handlers, startField }) => {
      const React = window.React, dayjs = window.dayjs; dayjs.extend(window.dayjs_plugin_isoWeek);
      const env = { React, dayjs, ...React, Dropdown: window.antd.Dropdown, holidays2026: [],
        ScheduleStatus: { PLANNED: 1, CANCELLED: 3, LEAVE: 4 }, DEFAULT_COURSE_COLOR: '#1890ff',
        getTextColorForBackground: () => '#fff', resolveCalendarRoomDisplay: () => 'Room' };
      const Week = new Function(...Object.keys(env), calendar)(...Object.values(env));
      const original = [{ id: 'original', course_id: 'course', course_name: 'Physics', status: 1,
        start_time: '2026-10-15T02:00:00Z', end_time: '2026-10-15T03:00:00Z', calculated_tuition: 180 },
      { id: 'occupied', course_id: 'course', course_name: 'Math', status: 1, start_time: '2026-10-15T04:00:00Z', end_time: '2026-10-15T05:00:00Z' }];
      window.writes = []; window.rows = original; window.warnings = []; window.opens = [];
      function App() {
        const [rows, setRows] = React.useState(original);
        const [open, setOpen] = React.useState(false);
        const [form] = window.antd.Form.useForm();
        window.closeSchedule = () => setOpen(false);
        window.replaceSchedules = setRows;
        window.scheduleForm = form;
        window.rows = rows;
        const dependencies = { dayjs, schedules: rows, courses: [], rooms: [], MIN_START_HOUR: 8, SLOT_DURATION: 5, GLOBAL_MAX_SLOT: 192, DEFAULT_DURATION_HOURS: 2,
          form, setEditingSchedule: value => { window.editing = value; }, setModalTeacherId() {}, setBatchDates: value => { window.batchDates = value; },
          setModalVisible: value => { window.opens.push(window.editing?.id || 'new'); setOpen(value); }, getCourseDisplayName: (_, fallback) => fallback,
          ScheduleStatus: env.ScheduleStatus, message: { warning: text => { window.warnings.push(text); window.antd.message.warning(text); }, success: () => {} },
          uuidv4: () => 'copy', resolveCalendarRoomDisplay: () => 'Room', buildFinancialFieldsForSchedule: () => ({}),
          setSchedulesWithHistory: updater => { const next = typeof updater === 'function' ? updater(rows) : updater; window.writes.push(next); localStorage.setItem('lessons', JSON.stringify(next)); window.ReactDOM.flushSync(() => setRows(next)); }, window };
        const actions = new Function(...Object.keys(dependencies), handlers + '\nreturn {handleDragSchedule,handleResizeSchedule,handleDoubleClickDate,handleDoubleClickSchedule};')(...Object.values(dependencies));
        return React.createElement(React.Fragment, null, React.createElement(Week, { startMonday: dayjs('2026-10-12'), schedules: rows, courses: [], rooms: [],
          onDragSchedule: actions.handleDragSchedule, onResizeSchedule: actions.handleResizeSchedule,
          onDoubleClickDate: actions.handleDoubleClickDate, onDoubleClickSchedule: actions.handleDoubleClickSchedule, onScheduleStatusChange() {}, onDropCourse() {} }),
          React.createElement(window.antd.Modal, { title: 'Schedule editor', open, onCancel: window.closeSchedule, footer: null },
            React.createElement(window.antd.Form, { form },
              new Function('React', 'Form', 'TimePicker', 'form', 'DEFAULT_DURATION_HOURS', startField)(React, window.antd.Form, window.antd.TimePicker, form, 2),
              React.createElement(window.antd.Form.Item, { name: 'endTime', label: 'End time' }, React.createElement(window.antd.TimePicker, { format: 'HH:mm' })))));
      }
      window.fixtureRoot = window.ReactDOM.createRoot(document.getElementById('root'));
      window.fixtureRoot.render(React.createElement(App));
    }, { calendar, handlers: compile(['slotToTime','checkOverlap','handleDragSchedule','handleResizeSchedule','handleDoubleClickDate','handleDoubleClickSchedule'].map(name => schedule[name]).join('\n')),
      startField: compile('return (' + schedule.startTimeField + ');') });
    const card = page.locator('[data-schedule-id="original"]');
    await card.waitFor();
    assert.equal(await page.title(), 'Schedule interaction regression');
    const initialBox = await card.boundingBox();
    // Press away from the center: the former eager drag state moved the card immediately.
    await page.mouse.move(initialBox.x + 40, initialBox.y + 9);
    await page.mouse.down();
    await page.waitForTimeout(120);
    assert.deepEqual(await card.boundingBox(), initialBox, 'pressing a card must not change its geometry');
    await page.mouse.move(initialBox.x + 42, initialBox.y + 11);
    assert.equal(await card.evaluate(el => getComputedStyle(el).opacity), '1', 'click jitter must not hide the card');
    assert.equal(await card.evaluate(el => el.style.cursor), 'move', 'click jitter must not activate dragging');
    await page.mouse.up();
    assert.equal(await page.evaluate(() => window.writes.length), 0);
    for (const offset of [2, 10, initialBox.height - 2]) {
      await card.dblclick({ position: { x: 45, y: offset } });
      await page.getByRole('dialog', { name: 'Schedule editor' }).waitFor();
      assert.equal(await page.evaluate(() => window.editing.id), 'original', 'body and resize edges both open the lesson');
      assert.equal(await page.locator('#startTime').inputValue(), '10:00');
      assert.equal(await page.locator('#endTime').inputValue(), '11:00');
      assert.equal(await page.evaluate(() => window.opens.at(-1)), 'original', 'card double click must not create a blank lesson');
      await page.evaluate(() => window.closeSchedule());
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
    }
    // A larger movement during the second press is still a double click, not a drag.
    await page.mouse.move(initialBox.x + 45, initialBox.y + 10);
    await page.mouse.down({ clickCount: 1 }); await page.mouse.up({ clickCount: 1 });
    await page.mouse.down({ clickCount: 2 });
    await page.mouse.move(initialBox.x + 53, initialBox.y + 10);
    assert.equal(await card.evaluate(el => el.style.cursor), 'move');
    await page.mouse.up({ clickCount: 2 });
    await page.getByRole('dialog').waitFor();
    assert.equal(await page.evaluate(() => window.editing.id), 'original');
    await page.evaluate(() => window.closeSchedule());
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    const blank = page.locator('[data-date="2026-10-15"] [data-day-body]');
    const blankBox = await blank.boundingBox();
    await page.mouse.dblclick(blankBox.x + 60, blankBox.y + 19 * 2.5 + 1);
    await page.getByRole('dialog', { name: 'Schedule editor' }).waitFor();
    assert.equal(await page.locator('#startTime').inputValue(), '09:35');
    assert.equal(await page.locator('#endTime').inputValue(), '11:35');
    assert.equal(await page.evaluate(() => window.batchDates[0].format('YYYY-MM-DD')), '2026-10-15');
    assert.equal(await page.evaluate(() => window.editing), null);
    assert.equal(await page.evaluate(() => window.writes.length), 0, 'opening any modal never persists a schedule');
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(out, 'blank-double-click-time.png'), animations: 'disabled' });
    await page.locator('#startTime').click();
    const minuteOptions = page.locator('.ant-picker-dropdown:visible .ant-picker-time-panel-column').nth(1).locator('.ant-picker-time-panel-cell-inner');
    await minuteOptions.first().waitFor();
    assert.deepEqual(await minuteOptions.allTextContents(), ['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55']);
    await minuteOptions.filter({ hasText: /^25$/ }).click();
    await page.getByRole('button', { name: 'OK', exact: true }).click();
    assert.equal(await page.locator('#startTime').inputValue(), '09:25');
    assert.equal(await page.locator('#endTime').inputValue(), '11:25', 'choosing a five-minute option updates the end time');
    await page.evaluate(() => window.closeSchedule());
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
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

    // Changing visible start hour and scrolling must not change the time mapping.
    await page.evaluate(() => window.replaceSchedules([{ id: 'early', course_id: 'course', course_name: 'Early lesson', status: 1,
      start_time: '2026-10-15T23:30:00Z', end_time: '2026-10-16T00:00:00Z' }]));
    await page.locator('[data-schedule-id="early"]').waitFor();
    const earlyBody = page.locator('[data-date="2026-10-16"] [data-day-body]');
    const earlyBox = await earlyBody.boundingBox();
    assert.equal(await earlyBody.getAttribute('data-min-start-slot'), '-12');
    await page.mouse.dblclick(earlyBox.x + 60, earlyBox.y + 3 * 2.5 + 1);
    await page.getByRole('dialog').waitFor();
    assert.equal(await page.locator('#startTime').inputValue(), '07:15');
    assert.equal(await page.evaluate(() => window.batchDates[0].format('YYYY-MM-DD')), '2026-10-16');
    await page.evaluate(() => window.closeSchedule());
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.setViewportSize({ width: 1280, height: 400 });
    await earlyBody.evaluate(el => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY + 240));
    const scrolledBox = await earlyBody.boundingBox();
    await page.mouse.dblclick(scrolledBox.x + 60, scrolledBox.y + 180 * 2.5 + 1);
    await page.getByRole('dialog').waitFor();
    assert.equal(await page.locator('#startTime').inputValue(), '22:00');
    await page.evaluate(() => window.closeSchedule());
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.setViewportSize({ width: 1280, height: 900 });

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
    fs.writeFileSync(path.join(out, 'checks.json'), JSON.stringify({ browser: 'Chrome/Playwright', reason: 'Browser plugin not available', url: 'http://regression.test/', viewport: '1280x900',
      cardPressStable: true, bodyAndEdgeDoubleClick: true, secondPressJitter: true, blankTime: '09:35', earlyTime: '07:15', scrolledTime: '22:00', startMinuteStep: 5,
      heldDragWrites: 0, validDropWrites: 1, rejectedCopyWrites: 0, repeatedClicksRequests: 1, errors }, null, 2), 'utf8');
    console.log('rendered calendar click stability, card/blank double-click time filling, held-drag/drop/copy and course single-flight save checks passed; evidence: ' + out);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
