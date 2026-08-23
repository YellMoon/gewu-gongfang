'use strict';

const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('src/pages/CourseList.tsx', 'utf8');
const roomSource = fs.readFileSync('src/pages/RoomManager.tsx', 'utf8');
const studentSource = fs.readFileSync('src/pages/StudentList.tsx', 'utf8');
const teacherSource = fs.readFileSync('src/pages/TeacherList.tsx', 'utf8');
assert.ok(source.includes('createCloudCourse'), 'online course creation must use the cloud command');
assert.ok(source.includes('updateCloudCourse'), 'online course edits must use the cloud command');
assert.ok(source.includes('deleteCloudCourse'), 'online course deletion must use the cloud command');
assert.ok(source.includes('expectedUpdatedAt: editingCourse.updated_at'), 'course updates must carry the observed version');
assert.ok(source.includes('expectedUpdatedAt: deletedCourse.updated_at'), 'course deletion must carry the observed version');
assert.ok(source.includes('refreshAuthorityProjection'), 'successful course commands must refresh the cloud projection');
assert.ok(!source.includes('dbService.addOrUpdateRoom(roomId)'), 'course editing must not silently create a local room');
for (const [name, pageSource] of Object.entries({ course: source, room: roomSource, student: studentSource, teacher: teacherSource })) {
  assert.ok(!pageSource.includes('legacyStage'), `${name} page must not retain an unused local-write legacy helper`);
}
for (const [name, pageSource] of Object.entries({ course: source, room: roomSource, teacher: teacherSource })) {
  assert.ok(!pageSource.replace(/\r\n/g, '\n').includes('return;\n      if (editing'), `${name} page must not retain an unreachable local-write fallback`);
}
assert.ok(!studentSource.includes('__legacyStudentEditFallback'), 'student page must not retain a legacy local-write fallback');
console.log('course list cloud-write source checks passed');
