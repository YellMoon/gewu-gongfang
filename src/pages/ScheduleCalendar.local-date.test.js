'use strict';
// Execute real day/week components, including membership and card geometry.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { JSDOM } = require('jsdom');
const dayjs = require('dayjs');
dayjs.extend(require('dayjs/plugin/isoWeek'));
const source = fs.readFileSync('src/pages/ScheduleCalendar.tsx', 'utf8');
const ast = ts.createSourceFile('calendar.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(['MIN_START_HOUR', 'SLOT_DURATION', 'SLOT_HEIGHT', 'COLUMN_WIDTH',
  'GLOBAL_MAX_SLOT', 'timeToSlot', 'slotToTime', 'formatTime', 'stripCourseSystemPrefix',
  'getCourseDisplayName', 'DailyView', 'OneWeekRow']);
const declarations = [];
function visit(node) {
  if ((ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node)) && names.has(node.name?.getText(ast)))
    declarations.push((ts.isVariableDeclaration(node) ? 'const ' : '') + node.getText(ast) + ';');
  ts.forEachChild(node, visit);
}
visit(ast);
assert.equal(declarations.length, names.size);
const code = ts.transpileModule(declarations.join('\n') + '\nreturn OneWeekRow;', {
  compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 }
}).outputText;
module.exports = { code };
const env = { React, dayjs, ...React, Dropdown: ({ children }) => children,
  holidays2026: [], ScheduleStatus: { PLANNED: 1, CANCELLED: 3, LEAVE: 4 },
  DEFAULT_COURSE_COLOR: '#1890ff', getTextColorForBackground: () => '#fff',
  resolveCalendarRoomDisplay: () => '上课地址' };
const OneWeekRow = new Function(...Object.keys(env), code)(...Object.values(env));
const previousTimezone = process.env.TZ;
process.env.TZ = 'Asia/Shanghai';
try {
  for (const date of ['2026-09-28', '2026-09-29', '2026-10-01', '2026-10-04']) {
    for (const time of ['00:00', '00:05', '07:30', '07:59', '08:00', '23:30']) {
      for (const encoding of ['local', 'utc', 'offset']) {
        const start = dayjs(`${date} ${time}`), end = start.add(20, 'minute');
        const encode = value => encoding === 'utc' ? value.toISOString() :
          value.format(encoding === 'local' ? 'YYYY-MM-DD HH:mm:ss' : 'YYYY-MM-DDTHH:mm:ssZ');
        const schedule = { id: 'lesson', course_id: 'course', course_name: '早课', status: 1,
          start_time: encode(start), end_time: encode(end) };
        const html = renderToStaticMarkup(React.createElement(OneWeekRow, {
          startMonday: start.startOf('isoWeek'), schedules: [schedule], courses: [], rooms: []
        }));
        const document = new JSDOM(html).window.document;
        const cards = document.querySelectorAll('[data-schedule-id="lesson"]');
        assert.equal(cards.length, 1, `${date}/${time}/${encoding}: exactly one card`);
        assert.equal(cards[0].closest('[data-date]').dataset.date, date, `${date}/${time}/${encoding}: local date`);
        assert(Number.parseFloat(cards[0].style.top) >= 0, 'early lesson stays below its day header');
        assert(cards[0].textContent.includes(time), 'card clock uses the same timezone as its column');
      }
    }
  }
  console.log('calendar real day/week rendering: 72 timezone/date/geometry cases passed');
} finally {
  if (previousTimezone === undefined) delete process.env.TZ; else process.env.TZ = previousTimezone;
}
