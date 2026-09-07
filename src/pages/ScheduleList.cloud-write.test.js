'use strict';

const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('src/pages/ScheduleList.tsx', 'utf8');
const dataPageLayoutSource = fs.readFileSync('src/layout/DataPageLayout.tsx', 'utf8');

assert.ok(source.includes('updateCloudSchedule'), 'schedule list must use the online cloud update capability');
assert.ok(source.includes('projectCloudScheduleRecords(projection)') && source.includes('await cloudRuntime.listCloudBusinessProjection()'),
  'schedule editor must read complete overrides and recurrence from one cloud snapshot, not infer them from a summary');
assert.ok(source.includes('expectedUpdatedAt: editingSchedule.updated_at'), 'cloud schedule edits must carry the last observed version');
assert.ok(source.includes('pricings: (editingSchedule.student_pricings || []).map'), 'cloud schedule edits must preserve attendance and fee overrides atomically');
assert.ok(source.includes('courseId: editingSchedule.course_id'), 'cloud schedule edits must preserve or update their course atomically');
assert.ok(source.includes('recurringRule: editingSchedule.recurring_rule ?? null'), 'cloud schedule edits must preserve recurrence semantics');
assert.ok(source.includes('serviceType: editingSchedule.service_type ?? null'), 'cloud schedule edits must preserve service type semantics');
assert.ok(source.includes("CLOUD_BUSINESS_SCHEDULE_CONFLICT"), 'the UI must surface concurrent cloud changes instead of overwriting them');
assert.ok(source.includes('EditOutlined'), 'online cloud schedules must expose an explicit edit action');
assert.ok(!source.includes('dbService.updateSchedule'), 'the schedule list must not fall back to a local direct write when the cloud command is active');
assert.ok(source.includes('readDesktopAuthorizationSession'),
  'cloud schedule controls must use the current signed desktop role');
assert.ok(source.includes('hasDesktopScheduleWriteAccess(authContext)'),
  'cloud schedule controls must allow the active bound teacher as well as super_admin');
assert.ok(source.includes('...(canManageCloudSchedules ? [{'),
  'unauthorized schedule tables must omit the cloud edit action');
assert.ok(source.includes('{canManageCloudSchedules && ('),
  'unauthorized schedule pages must not render the edit form');
assert.ok(!source.includes('setStudents([])'), 'cloud schedule reads must retain the scoped student projection for row labels and filters');
assert.ok(!source.includes('setTeachers([])'), 'cloud schedule reads must retain the scoped teacher projection for row labels and filters');
assert.match(source, /setCourses\(projectedCourses\.length > 0[\s\S]*cloudSchedules\.map/u,
  'cloud schedule reads must prefer scoped full course records and only synthesize a fallback when projection data is unavailable');
assert.match(dataPageLayoutSource, /\(\{[\s\S]*children,[\s\S]*\}\) =>/u,
  'the shared data page layout must accept declared children at runtime');
assert.match(dataPageLayoutSource, /\{children\}/u,
  'the shared data page layout must render nested dialogs such as the cloud schedule editor');

console.log('schedule list cloud-write source checks passed');
require('../services/desktopScheduleWriteAccess.test');
