'use strict';

const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('src/pages/RoomManager.tsx', 'utf8');
assert.ok(source.includes('createCloudRoom'), 'online room creation must use the cloud command');
assert.ok(source.includes('updateCloudRoom'), 'online room edits must use the cloud command');
assert.ok(source.includes('deleteCloudRoom'), 'online room deletion must use the cloud command');
assert.ok(source.includes('expectedUpdatedAt: editingRoom.updated_at'), 'room updates must carry the observed version');
assert.ok(source.includes('expectedUpdatedAt: deletedRoom.updated_at'), 'room deletion must carry the observed version');
assert.ok(source.includes('refreshAuthorityProjection'), 'successful room commands must refresh the cloud projection');
console.log('room manager cloud-write source checks passed');
