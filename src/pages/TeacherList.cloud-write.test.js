'use strict';

const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('src/pages/TeacherList.tsx', 'utf8');
assert.ok(source.includes('createCloudTeacher'), 'online teacher creation must use the cloud command');
assert.ok(source.includes('updateCloudTeacher'), 'online teacher edits must use the cloud command');
assert.ok(source.includes('deleteCloudTeacher'), 'online teacher deletion must use the cloud command');
assert.ok(source.includes('expectedUpdatedAt: editingTeacher.updated_at'), 'teacher updates must carry the observed version');
assert.ok(source.includes('expectedUpdatedAt: deletedTeacher.updated_at'), 'teacher deletion must carry the observed version');
assert.ok(source.includes('refreshAuthorityProjection'), 'successful teacher commands must refresh the cloud projection');
console.log('teacher list cloud-write source checks passed');
