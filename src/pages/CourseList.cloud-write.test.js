'use strict';

const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('src/pages/CourseList.tsx', 'utf8');
assert.ok(source.includes('createCloudCourse'), 'online course creation must use the cloud command');
assert.ok(source.includes('updateCloudCourse'), 'online course edits must use the cloud command');
assert.ok(source.includes('deleteCloudCourse'), 'online course deletion must use the cloud command');
assert.ok(source.includes('expectedUpdatedAt: editingCourse.updated_at'), 'course updates must carry the observed version');
assert.ok(source.includes('expectedUpdatedAt: deletedCourse.updated_at'), 'course deletion must carry the observed version');
assert.ok(source.includes('refreshAuthorityProjection'), 'successful course commands must refresh the cloud projection');
assert.ok(!source.includes('dbService.addOrUpdateRoom(roomId)'), 'course editing must not silently create a local room');
console.log('course list cloud-write source checks passed');
