'use strict';

const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('src/pages/StudentList.tsx', 'utf8');

assert.ok(source.includes('getAllStudentContacts'), 'student editor must read cloud-projected contact records');
assert.ok(source.includes("import { studentContactFormValues } from '../services/studentContactDraftProjection.mjs'"), 'student editor must use the behavior-tested local contact draft projection');
assert.ok(source.includes('updateCloudStudentRecord'), 'online student edits must use the atomic cloud command');
assert.ok(source.includes('createCloudStudentRecord'), 'online student creation must use the cloud command');
assert.ok(source.includes('deleteCloudStudent'), 'online student deletion must use the cloud command');
assert.ok(source.includes('expectedUpdatedAt: editingStudent.updated_at'), 'student record updates must carry the observed student version');
assert.ok(source.includes('expectedUpdatedAt: deletedStudent.updated_at'), 'student deletion must carry the observed student version');
assert.ok(source.includes('expectedUpdatedAt: existing.updated_at'), 'student contact updates must carry every observed contact version');
for (const field of ['student_wechat', 'parent_phone', 'parent_wechat', 'second_parent_phone', 'second_parent_wechat']) {
  assert.ok(source.includes(`name="${field}"`), `student editor must expose ${field} instead of silently preserving it`);
}
assert.ok(source.includes('phone: null, wechat: null'), 'clearing an existing student contact must submit a versioned unbind command');
assert.ok(source.includes('refreshAuthorityProjection'), 'a successful command must refresh the cloud projection before rendering');
assert.ok(source.includes('CLOUD_BUSINESS_STUDENT_CONFLICT'), 'the UI must surface concurrent changes instead of overwriting them');

console.log('student list cloud-write source checks passed');
