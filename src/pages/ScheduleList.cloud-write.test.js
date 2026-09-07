'use strict';
const assert = require('assert');
const fs = require('fs');
const source = fs.readFileSync('src/pages/ScheduleList.tsx', 'utf8');
// Keep the historical runner name. The list must not become a second write
// surface. Original calendar mutation/confirmation contracts have their own tests.
require('./ScheduleList.business-parity.test');
assert.ok(source.includes('projectCloudScheduleRecords(projection)') && source.includes('await cloudRuntime.listCloudBusinessProjection()'),
  'the list must read a complete, scoped cloud snapshot');
assert.ok(!source.includes('dbService.updateSchedule'), 'no direct local authority write may be reintroduced');
assert.ok(!source.includes('setStudents([])'), 'scoped student labels and filters must remain available');
assert.ok(!source.includes('setTeachers([])'), 'scoped teacher labels and filters must remain available');
assert.match(source, /setCourses\(projectedCourses\.length > 0[\s\S]*cloudSchedules\.map/u,
  'prefer complete scoped course records');
console.log('schedule list cloud read and business parity checks passed');
