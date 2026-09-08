'use strict';

const assert = require('assert');
const fs = require('fs');
require('./ScheduleCalendar.card-content.test.js');

const source = fs.readFileSync('src/pages/ScheduleCalendar.tsx', 'utf8');
// UTF-8: exercise the real form's conflict/log templates with cloud UTC timestamps.
const ts = require('typescript');
const dayjs = require('dayjs');
const originalTimezone = process.env.TZ;
process.env.TZ = 'Asia/Shanghai';
try {
  const ast = ts.createSourceFile('ScheduleCalendar.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let saveHandler;
  const findHandler = node => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'handleSave') saveHandler = node;
    ts.forEachChild(node, findHandler);
  };
  findHandler(ast);
  assert(saveHandler);
  const templates = [];
  const findTemplates = node => {
    if (ts.isTemplateExpression(node)) templates.push(node.getText(ast));
    ts.forEachChild(node, findTemplates);
  };
  findTemplates(saveHandler);
  const conflict = templates.find(text => text.includes('时间重叠：'));
  const log = templates.find(text => text.includes('修改排课「'));
  assert(conflict && log);
  const overlap = {course_name:'原物理课',start_time:'2026-09-07T06:00:00+00:00',end_time:'2026-09-07T07:30:00+00:00'};
  assert.equal(new Function('dayjs','dateStr','overlap','return '+conflict)(dayjs,'2026-09-07',overlap),
    '时间重叠：2026-09-07 与「原物理课」(14:00-15:30)冲突，已恢复');
  assert.equal(new Function('dayjs','courseName','startTimeStr','endTimeStr','return '+log)(dayjs,'初二物理','2026-09-07T08:00:00.000Z','2026-09-07T10:00:00.000Z'),
    '修改排课「初二物理」时间 16:00-18:00');
} finally {
  if (originalTimezone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimezone;
}
assert.ok(source.includes('persistScheduleCalendarState('), 'calendar must distinguish persisted drafts from rejected saves');
assert.ok(source.includes('setSchedules(restored as ScheduleEvent[])'), 'failed saves must restore the visible calendar');
assert.ok(source.includes('pendingSaveNoticeRef.current'), 'form success must wait until draft persistence');
assert.ok(source.includes('start_time: startTime.toISOString()'),
  'drag-created schedules must persist a strict ISO instant');
assert.ok(source.includes('const startTimeStr = localStart.toISOString()'),
  'form-created schedules must persist a strict ISO instant');
assert.ok(!source.includes(".start_time.split(' ')"),
  'schedule rendering and editing must support canonical ISO instants');
assert.ok(!source.includes(".end_time.split(' ')"),
  'schedule rendering and editing must support canonical ISO instants');
assert.ok(!source.includes("start_time: startTime.format('YYYY-MM-DD HH:mm')"),
  'ScheduleCalendar must not persist a non-canonical drag-created timestamp');
assert.ok(!source.includes('const startTimeStr = `${dateStr} ${startDayjs.format'),
  'ScheduleCalendar must not persist a non-canonical form-created timestamp');

console.log('schedule calendar cloud-write source checks passed');
