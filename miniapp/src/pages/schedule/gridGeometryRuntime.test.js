'use strict';
// Execute the actual desktop geometry statements and the actual miniapp page.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const dayjs = require('dayjs');
const { harness, nodes } = require('./cardContentRuntime.test');
const projection = require('../../utils/cloudBusinessProjection');
const source = fs.readFileSync(path.resolve(__dirname, '../../../../src/pages/ScheduleCalendar.tsx'), 'utf8');
const ast = ts.createSourceFile('ScheduleCalendar.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = new Map(), functions = new Map();
function visit(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) declarations.set(node.name.text, node);
  if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node);
  ts.forEachChild(node, visit);
}
visit(ast);
const constant = name => Number(declarations.get(name).initializer.getText(ast));
const compile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const timeToSlot = new Function('MIN_START_HOUR', 'SLOT_DURATION', compile(`return (${functions.get('timeToSlot').getText(ast)});`))(constant('MIN_START_HOUR'), constant('SLOT_DURATION'));
const daily = declarations.get('DailyView').initializer.body.statements;
const snippet = statement => statement.getText(ast);
const named = (statements, name) => statements.find(statement => ts.isVariableStatement(statement) && statement.declarationList.declarations.some(declaration => declaration.name.getText(ast) === name));
const dayRangeCode = ['minStartSlot', 'effectiveMaxEndSlot', 'maxEndSlot'].map(name => snippet(named(daily, name))).join('\n') + '\n' + snippet(daily.find(statement => ts.isExpressionStatement(statement) && statement.getText(ast).startsWith('daySchedules.forEach'))) + '\n' + snippet(named(daily, 'bodyHeight'));
const desktopBody = new Function('dayjs', 'timeToSlot', 'SLOT_HEIGHT', 'minHour', 'maxHour', 'daySchedules', compile(dayRangeCode + '\nreturn { minStartSlot, bodyHeight };'));
const desktopPosition = new Function('dayjs', 'timeToSlot', 'slotToDisplayTop', 'SLOT_HEIGHT', compile(`return (${functions.get('getCoursePosition').getText(ast)});`));
const row = declarations.get('OneWeekRow').initializer.body.statements;
const desktopHours = new Function('dayjs', 'visibleSchedules', compile(snippet(named(row, 'dynMinHour')) + '\n' + snippet(row.find(statement => ts.isExpressionStatement(statement) && statement.getText(ast).startsWith('visibleSchedules.forEach'))) + '\nreturn { minHour: dynMinHour, maxHour: dynMaxHour };'));
const px = value => Number.parseFloat(String(value));
(async () => {
  const today = projection.shanghaiDateKey(new Date());
  const week = projection.shanghaiWeekDateKeys(today);
  const schedule = (id, date, start, end, status = 1) => ({ id, course_id: 'course', course_name: '物理', start_time: date + 'T' + start + ':00', end_time: date + 'T' + end + ':00', status });
  const lessons = [schedule('one', today, '08:05', '09:35'), schedule('two', today, '09:40', '10:40'), schedule('three', today, '10:45', '12:15'), schedule('four', today, '13:10', '14:10')];
  for (const role of ['super_admin', 'teacher', 'student', 'family_member']) {
    for (const extended of [false, true]) {
      const data = { schedules: extended ? [...lessons, schedule('early', today, '07:05', '07:35'), schedule('late', today, '23:10', '23:55')] : lessons, courses: [], students: [], rooms: [] };
      const page = harness(role, data); await page.mount();
      for (const mode of ['two-weeks']) {
        const dates = [...week, ...week.map(date => projection.shiftShanghaiDateKey(date, 7))];
        assert.equal(page.find('week-grid').length, 2, 'actual desktop canvas contains two consecutive weeks');
        assert.equal(page.find('day-column').length, 14, role + ' must render two rows of seven parallel days');
        assert.deepEqual(page.find('day-column').map(column => column.props['data-date']), dates, 'both actual week rows must use consecutive Shanghai date keys');
        page.find('day-section-title').forEach((header, index) => {
          assert.equal(header.props.children.length, 2, 'desktop header has a weekday and its date, with no count');
          const date = projection.shanghaiDateParts(dates[index]);
          assert.equal(header.props.children[1].props.children, `${date.month}月${date.day}日`);
        });
        assert.equal(page.find('toggle-btn').length, 0, 'desktop has no day/week mode switch');
        assert.equal(page.find('day-section-count').length, 0, 'desktop has no per-day lesson count');
        assert.equal(page.find('filter-bar').length, 0, 'removed student selector must not consume the calendar');
        assert.equal(page.find('week-nav').length, 0, 'no separate summary/navigation row');
        assert.equal(page.find('nav-title').length, 0, 'dates belong only in real day headers');
        const bodies = page.find('day-grid-body'); assert.equal(bodies.length, dates.length, 'actual time grid must exist instead of a card list');
        bodies.forEach((body, index) => {
          const rowDates = dates.slice(Math.floor(index / 7) * 7, Math.floor(index / 7) * 7 + 7);
          const hours = desktopHours(dayjs, data.schedules.filter(item => rowDates.includes(item.start_time.slice(0, 10)) && ![3, 4].includes(item.status)));
          const dailyLessons = data.schedules.filter(item => item.start_time.startsWith(dates[index]));
          const expected = desktopBody(dayjs, timeToSlot, constant('SLOT_HEIGHT'), hours.minHour, hours.maxHour, dailyLessons);
          assert.equal(px(body.props.style.height), expected.bodyHeight, 'default 8–23 and extended range must match actual desktop');
          const actualCards = nodes(body).filter(node => (node.props.className || '').split(' ').includes('schedule-card'));
          assert.equal(actualCards.length, dailyLessons.length);
          const position = desktopPosition(dayjs, timeToSlot, slot => (slot - expected.minStartSlot) * constant('SLOT_HEIGHT'), constant('SLOT_HEIGHT'));
          actualCards.forEach((card, cardIndex) => {
            const expectedCard = position(dailyLessons[cardIndex]);
            assert.equal(card.props.style.position, 'absolute');
            assert.equal(px(card.props.style.top), expectedCard.top);
            assert.equal(px(card.props.style.height), expectedCard.height, 'course height must use the real duration, never min112');
            assert.equal(px(card.props.style.minHeight), 24);
            assert.equal(card.props.style.zIndex, 10);
          });
          const lines = nodes(body).filter(node => node.props.className === 'hour-grid-line');
          assert.equal(px(lines[0].props.style.top), 0);
          assert.equal(px(lines[1].props.style.top), 30, 'hour lines must follow desktop twelve slots × 2.5px');
        });
        const scroller = page.find('week-view')[0];
        assert.equal(scroller.props.scrollX, true, 'portrait fixed 140px columns remain horizontally scrollable; landscape fits seven columns via orientation CSS');
        assert.equal(scroller.props.scrollY, true, 'full 450px day is vertically reachable');
      }
    }
  }
  // Desktop renders retained overlaps at identical horizontal coordinates in cache order.
  const overlapping = harness('teacher', { schedules: [schedule('back', today, '10:00', '11:00'), schedule('front', today, '10:30', '11:30')], courses: [], students: [], rooms: [] }); await overlapping.mount();
  const cards = overlapping.find('schedule-card');
  assert.deepEqual(cards.map(card => [px(card.props.style.left), px(card.props.style.right), card.props.style.zIndex]), [[4, 4, 10], [4, 4, 10]]);
  assert.equal(px(cards[1].props.style.top) - px(cards[0].props.style.top), 15, 'overlap stays on the time coordinate rather than being stacked as a later row');
  console.log('actual desktop/miniapp time-grid geometry, two rows/seven days, compact toolbar, 5min slots, 60/90min heights, hour lines, extensions, scroll and retained overlap order passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
