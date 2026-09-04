'use strict';

const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('src/pages/ScheduleCalendar.tsx', 'utf8');
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
