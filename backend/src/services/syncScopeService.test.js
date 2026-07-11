const assert = require('assert');
const { validateSyncMutation, buildSyncProvenance } = require('./syncScopeService');

const lookup = {
  courses: [{ id: 'c1', teacher_id: 't1' }, { id: 'c2', teacher_id: 't2' }],
  schedules: [{ id: 'sc1', course_id: 'c1' }, { id: 'sc2', course_id: 'c2' }],
};
const teacher = { kind: 'teacher', userId: 'u1', teacherId: 't1', deviceId: 'd-auth' };
const op = (table, data, extra = {}) => ({ id: 'op-1', table, action: 'update', data, ...extra });

assert.throws(() => validateSyncMutation(op('courses', { id: 'c2', teacher_id: 't2' }), teacher, lookup), e => e.code === 'TEACHER_SCOPE_VIOLATION');
assert.strictEqual(validateSyncMutation(op('courses', { id: 'c1', teacher_id: 't1' }), teacher, lookup).decision, 'apply');
assert.throws(() => validateSyncMutation(op('courses',{id:'c2',teacher_id:'t1'}),teacher,{...lookup,existing:{id:'c2',teacher_id:'t2'}}),e=>e.code==='TEACHER_SCOPE_VIOLATION');
assert.throws(() => validateSyncMutation(op('courses',{id:'c1',teacher_id:'t2'}),teacher,{...lookup,existing:{id:'c1',teacher_id:'t1'}}),e=>e.code==='OWNERSHIP_FIELD_IMMUTABLE');
assert.throws(() => validateSyncMutation({...op('courses',{id:'c2',teacher_id:'t1'}),action:'delete'},teacher,{...lookup,existing:{id:'c2',teacher_id:'t2'}}),e=>e.code==='TEACHER_SCOPE_VIOLATION');
assert.strictEqual(validateSyncMutation(op('courses',{id:'c1',teacher_id:'t1',name:'renamed'}),teacher,{...lookup,existing:{id:'c1',teacher_id:'t1'}}).decision,'apply');
assert.throws(()=>validateSyncMutation(op('assetRecords',{id:'a',owner_user_id:'u1'}),teacher,{...lookup,existing:{id:'a',owner_user_id:'u2'}}),e=>e.code==='TEACHER_SCOPE_VIOLATION');
for (const [table, data] of [
  ['schedules', { id: 'sc1', course_id: 'c1' }],
  ['enrollments', { id: 'e1', schedule_id: 'sc1' }],
  ['payments', { id: 'p1', schedule_id: 'sc1' }],
  ['consumption_records', { id: 'x1', course_id: 'c1' }],
]) assert.strictEqual(validateSyncMutation(op(table, data), teacher, lookup).decision, 'apply');
assert.strictEqual(validateSyncMutation(op('assetRecords', { id: 'a1', owner_user_id: 'u1' }), teacher, lookup).decision, 'apply');
assert.throws(() => validateSyncMutation(op('assetRecords', { id: 'a2', owner_user_id: 'u2' }), teacher, lookup), e => e.code === 'TEACHER_SCOPE_VIOLATION');
assert.strictEqual(validateSyncMutation(op('payments', { id: 'unknown' }), teacher, lookup).decision, 'review');
assert.strictEqual(validateSyncMutation(op('mystery', { id: 'z' }), teacher, lookup).code, 'DATA_SCOPE_UNRESOLVED');
assert.throws(() => validateSyncMutation(op('courses', { id: 'c1' }), { kind: 'student', userId: 's' }, lookup), e => e.code === 'SYNC_WRITE_FORBIDDEN');
assert.throws(() => validateSyncMutation(op('courses', { id: 'c1' }), { kind: 'pending', userId: 'p' }, lookup), e => e.code === 'SYNC_WRITE_FORBIDDEN');
assert.strictEqual(validateSyncMutation(op('courses', { id: 'c2' }), { kind: 'admin', userId: 'admin', deviceId: 'd' }, lookup).decision, 'apply');
assert.strictEqual(validateSyncMutation(op('questions', { id: 'q1' }), teacher, lookup).decision, 'apply');
assert.strictEqual(validateSyncMutation({ ...op('questions', { id: 'local-draft' }), action: 'delete' }, teacher, lookup).decision, 'apply',
  'question bank is shared; local draft deletion stays allowed until Task 6 distinguishes committed records');
assert.strictEqual(validateSyncMutation(op('courses', { id: 'c1', _base_version: 'old' }), teacher, { ...lookup, existing: { id:'c1',teacher_id:'t1',updated_at: 'new' } }).decision, 'conflict');

const provenance = buildSyncProvenance({ ...op('courses', { id: 'c1' }), actorUserId: 'evil', actorTeacherId: 't2', sourceDeviceId: 'evil', sourceOperationId: 'evil' }, teacher);
assert.deepStrictEqual(provenance, { actorUserId: 'u1', actorTeacherId: 't1', sourceDeviceId: 'd-auth', sourceOperationId: 'op-1' });

console.log('syncScopeService tests passed');
