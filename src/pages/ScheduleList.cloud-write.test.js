'use strict';

const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('src/pages/ScheduleList.tsx', 'utf8');

assert.ok(source.includes('updateCloudSchedule'), 'schedule list must use the online cloud update capability');
assert.ok(source.includes('expectedUpdatedAt: editingSchedule.updated_at'), 'cloud schedule edits must carry the last observed version');
assert.ok(source.includes('pricings: (editingSchedule.student_pricings || []).map'), 'cloud schedule edits must preserve attendance and fee overrides atomically');
assert.ok(source.includes("CLOUD_BUSINESS_SCHEDULE_CONFLICT"), 'the UI must surface concurrent cloud changes instead of overwriting them');
assert.ok(source.includes('EditOutlined'), 'online cloud schedules must expose an explicit edit action');
assert.ok(!source.includes('dbService.updateSchedule'), 'the schedule list must not fall back to a local direct write when the cloud command is active');

console.log('schedule list cloud-write source checks passed');
