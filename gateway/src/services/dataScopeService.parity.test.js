const assert = require('assert');
const path = require('path');
const backend = require('../../../backend/src/services/dataScopeService');
const gateway = require('./dataScopeService');
const snapshot = {
  courses: [{ id: 1, teacher_id: 't1', student_ids: '[2]' }],
  schedules: [{ id: 3, course_id: 1, student_ids: [2], calculated_tuition: '12' }],
  students: [{ id: 2, name: 'A', phone: 'secret' }],
  questions: [{ id: 'q', tenant_id: 'secret' }],
  questionPreviews: [{ id: 'preview-1', stemPreview: 'safe' }, { id: 'preview-2', tenant_id: 'secret' }],
  assets: [{ id: 'asset-u', owner_user_id: 'u', balance: 5, full_identifier: 'secret' }, { id: 'asset-other', owner_user_id: 'other', balance: 9 }],
  assetRecords: [{ id: 'record-u', owner_user_id: 'u', amount: 5 }, { id: 'record-other', owner_user_id: 'other', amount: 9 }],
  assetCategories: [{ id: 'category-u', owner_user_id: 'u' }, { id: 'category-other', owner_user_id: 'other' }],
};
for (const context of [
  { kind: 'teacher', teacherId: 't1', userId: 'u' },
  { kind: 'student', studentIds: ['2'], userId: 'u' },
  { kind: 'visitor', userId: 'u' },
  { kind: 'all', userId: 'u' },
  { kind: 'pending' },
]) assert.deepStrictEqual(gateway.scopeBusinessSnapshot(snapshot, context), backend.scopeBusinessSnapshot(snapshot, context));
assert.ok(!require.resolve('./dataScopeService').includes(`${path.sep}backend${path.sep}`));
console.log('gateway data scope parity checks passed');
