const assert = require('assert');
const dayjs = require('dayjs');

(async () => {
  const {
    normalizeRefreshDateRange,
    updateRefreshDateRangeBoundary,
  } = await import('./scheduleRefreshRange.mjs');

  const initialRange = [dayjs('2026-07-10'), dayjs('2026-07-20')];

  const changedStart = updateRefreshDateRangeBoundary(initialRange, 'start', dayjs('2026-07-05'));
  assert.strictEqual(changedStart[0].format('YYYY-MM-DD'), '2026-07-05');
  assert.strictEqual(changedStart[1].format('YYYY-MM-DD'), '2026-07-20');

  const changedEnd = updateRefreshDateRangeBoundary(initialRange, 'end', dayjs('2026-07-25'));
  assert.strictEqual(changedEnd[0].format('YYYY-MM-DD'), '2026-07-10');
  assert.strictEqual(changedEnd[1].format('YYYY-MM-DD'), '2026-07-25');

  const startAfterEnd = updateRefreshDateRangeBoundary(initialRange, 'start', dayjs('2026-08-01'));
  assert.strictEqual(startAfterEnd[0].format('YYYY-MM-DD'), '2026-08-01');
  assert.strictEqual(startAfterEnd[1].format('YYYY-MM-DD'), '2026-08-01');

  const endBeforeStart = updateRefreshDateRangeBoundary(initialRange, 'end', dayjs('2026-07-01'));
  assert.strictEqual(endBeforeStart[0].format('YYYY-MM-DD'), '2026-07-01');
  assert.strictEqual(endBeforeStart[1].format('YYYY-MM-DD'), '2026-07-01');

  const reversed = normalizeRefreshDateRange([dayjs('2026-07-20'), dayjs('2026-07-10')]);
  assert.strictEqual(reversed[0].format('YYYY-MM-DD'), '2026-07-10');
  assert.strictEqual(reversed[1].format('YYYY-MM-DD'), '2026-07-20');
  assert.strictEqual(normalizeRefreshDateRange(null), null);

  const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
  const source = ts.createSourceFile('ScheduleCalendar.tsx', fs.readFileSync(path.join(__dirname, '../pages/ScheduleCalendar.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handler, expression;
  function findHandler(node) { if (ts.isFunctionDeclaration(node) && node.name?.getText(source) === 'handleRefreshCourseInfo') handler = node; ts.forEachChild(node, findHandler); }
  findHandler(source); assert(handler);
  function findDate(node) { if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'sDate') expression = node.initializer; ts.forEachChild(node, findDate); }
  findDate(handler); assert(expression);
  const readDate = new Function('dayjs', 's', `return (${expression.getText(source)});`);
  const first = dayjs('2026-09-07'), last = dayjs('2026-09-20');
  for (const [localTime, expected] of [['2026-09-06T23:59:00', false], ['2026-09-07T00:00:00', true], ['2026-09-20T00:00:00', true], ['2026-09-20T10:00:00', true], ['2026-09-20T23:55:00', true], ['2026-09-21T00:00:00', false]]) {
    const date = readDate(dayjs, { start_time: dayjs(localTime).toISOString() });
    assert.strictEqual(!date.isBefore(first) && !date.isAfter(last), expected, `original refresh range includes whole local end date: ${localTime}`);
  }
  console.log('scheduleRefreshRange tests passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
