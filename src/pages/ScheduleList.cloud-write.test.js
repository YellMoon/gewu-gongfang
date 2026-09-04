'use strict';

const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('src/pages/ScheduleList.tsx', 'utf8');
const dataPageLayoutSource = fs.readFileSync('src/layout/DataPageLayout.tsx', 'utf8');

assert.ok(source.includes('updateCloudSchedule'), 'schedule list must use the online cloud update capability');
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
assert.ok(source.includes("authContext.activeRole === 'super_admin'")
  && source.includes("authContext.eligibleRoles.includes('super_admin')"),
  'cloud schedule mutation controls must fail closed unless super_admin is the active eligible role');
assert.ok(source.includes('...(canManageCloudSchedules ? [{'),
  'teacher schedule tables must omit the cloud edit action instead of rendering an unusable control');
assert.ok(source.includes('{canManageCloudSchedules && ('),
  'teacher schedule pages must not render the financial cloud edit form');
assert.ok(!source.includes('setStudents([])'), 'cloud schedule reads must retain the scoped student projection for row labels and filters');
assert.ok(!source.includes('setTeachers([])'), 'cloud schedule reads must retain the scoped teacher projection for row labels and filters');
assert.match(source, /setCourses\(projectedCourses\.length > 0[\s\S]*cloudSchedules\.map/u,
  'cloud schedule reads must prefer scoped full course records and only synthesize a fallback when projection data is unavailable');
assert.match(dataPageLayoutSource, /\(\{[\s\S]*children,[\s\S]*\}\) =>/u,
  'the shared data page layout must accept declared children at runtime');
assert.match(dataPageLayoutSource, /\{children\}/u,
  'the shared data page layout must render nested dialogs such as the cloud schedule editor');

console.log('schedule list cloud-write source checks passed');
