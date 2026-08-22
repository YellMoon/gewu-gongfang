'use strict';

const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('miniapp/src/pages/schedule/index.tsx', 'utf8');
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
assert.ok(source.includes("identity?.token_use === 'miniapp-cloud'"), 'schedule page must distinguish the new cloud session');
assert.ok(source.includes('miniappCloudBusinessApi.listSchedules(token)'), 'cloud session must read schedules from cloud business API');
assert.ok(source.includes('course_name: row.courseName'), 'cloud schedule response must retain the course display name');
assert.ok(source.includes('student_ids: []'), 'cloud schedule projection must not invent roster data');
assert.ok(source.includes("timeZone: 'Asia/Shanghai'"), 'cloud schedule instants must be projected in the product time zone before date filtering');
assert.ok(source.includes('cloudScheduleDateTime(row.startAt)'), 'cloud schedule start times must be normalized before the legacy calendar filter receives them');
assert.ok(source.includes('cloudScheduleDateTime(row.endAt)'), 'cloud schedule end times must be normalized before rendering');
assert.ok(source.includes("'/pages/cloud-account-admin/index'"), 'the bootstrap super administrator must be able to reach the cloud account authorization page');
assert.ok(packageJson.scripts['test:cloud-schedule'].includes('miniapp/src/pages/schedule/cloudBusinessSchedule.test.js'), 'cloud schedule test runner must include the miniapp cloud schedule boundary');
console.log('miniapp cloud schedule source checks passed');
