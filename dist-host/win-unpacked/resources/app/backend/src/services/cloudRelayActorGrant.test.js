const assert = require('assert');
const { actorGrantFromSyncActor } = require('./cloudRelayActorGrant');

const grant = actorGrantFromSyncActor({
  userId: 'u-1', deviceId: 'd-1', activeRole: 'teacher', eligibleRoles: ['teacher'],
  teacherId: 't-1', authVersion: 1, credentialVersion: 1, scope: { kind: 'teacher', teacherIds: ['t-1'] },
});
assert.strictEqual(grant.userId, 'u-1');
assert.strictEqual(grant.teacherId, 't-1');
assert.throws(() => actorGrantFromSyncActor({ userId: 'u-1', deviceId: 'd-1', activeRole: 'teacher', eligibleRoles: ['teacher'] }),
  error => error.code === 'RELAY_ACTOR_GRANT_INVALID');
console.log('cloud relay actor grant checks passed');
