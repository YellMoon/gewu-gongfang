'use strict';

const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('miniapp/src/pages/schedule/index.tsx', 'utf8');
const projectionSource = fs.readFileSync('miniapp/src/utils/cloudBusinessProjection.js', 'utf8');
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
assert.ok(source.includes('pullFromCloudBusinessProjection()'), 'schedule page must refresh the role-scoped cloud business projection');
assert.ok(source.includes("getCachedList<Schedule>('schedules')"), 'schedule page must render the cloud-backed derived cache');
assert.ok(source.includes('shanghaiWeekDateKeys(currentDateKey)'), 'schedule week layout must use the product calendar instead of device-local dates');
assert.ok(source.includes('shiftShanghaiDateKey(current, dir * 7)'), 'schedule week navigation must use product-calendar date keys');
assert.ok(!source.includes('.getDate()') && !source.includes('.getMonth()') && !source.includes('.getDay()'), 'schedule labels and today highlighting must not mix device-local calendar fields');
assert.ok(!source.includes('miniappCloudBusinessApi'), 'schedule page must not bypass the shared cloud projection runtime');
assert.ok(source.includes("course_name: course?.display_name || course?.name || '未知课程'"), 'cloud schedule cache must retain the course display name');
assert.ok(projectionSource.includes("timeZone: 'Asia/Shanghai'"), 'cloud schedule instants must be projected in the product time zone before date filtering');
assert.ok(projectionSource.includes('cloudScheduleDateTime(schedule.start_time)'), 'cloud schedule start times must be normalized before the calendar filter receives them');
assert.ok(projectionSource.includes('cloudScheduleDateTime(schedule.end_time)'), 'cloud schedule end times must be normalized before rendering');
assert.ok(!source.includes("'/pages/cloud-account-admin/index'"), 'retired cloud account authorization must not remain reachable from the schedule page');
assert.ok(packageJson.scripts['test:cloud-schedule'].includes('miniapp/src/pages/schedule/cloudBusinessSchedule.test.js'), 'cloud schedule test runner must include the miniapp cloud schedule boundary');
console.log('miniapp cloud schedule source checks passed');
