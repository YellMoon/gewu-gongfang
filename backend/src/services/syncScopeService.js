const { assertRecordWritable } = require('./dataScopeService');

function error(code, message = code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function normalizeTable(table) {
  return ({ consumption_records: 'consumptions', asset_records: 'assetRecords', personal_assets: 'assetRecords' })[table] || table;
}

function buildSyncProvenance(operation = {}, authz = {}) {
  return {
    actorUserId: authz.userId || null,
    actorTeacherId: authz.teacherId || null,
    sourceDeviceId: authz.deviceId || null,
    sourceOperationId: operation.id || operation.operationId || null,
  };
}

function validateSyncMutation(operation = {}, authz = {}, lookup = {}) {
  if (authz.kind === 'student' || authz.kind === 'pending') throw error('SYNC_WRITE_FORBIDDEN');
  if (!authz || !authz.kind || !authz.userId || !authz.deviceId) throw error('AUTHORIZATION_CONTEXT_REQUIRED');
  const provenance = buildSyncProvenance(operation, authz);
  if (authz.kind === 'admin') return { decision: 'apply', provenance };
  if (authz.kind !== 'teacher' || !authz.teacherId) throw error('AUTHORIZATION_CONTEXT_REQUIRED');

  const table = normalizeTable(operation.table);
  // Question-bank content is shared rather than teacher-owned. Task 6 adds the
  // committed-storage distinction; until then delete here represents a local draft.
  if (table === 'questions') return { decision: 'apply', provenance };
  const data = operation.data || operation.payload || {};
  const existing = lookup.existing || null;
  try {
    if (existing) assertRecordWritable(table, existing, authz, lookup);
  } catch (err) {
    if (err.code === 'DATA_SCOPE_UNRESOLVED') return { decision:'review', code:err.code, provenance };
    throw err;
  }
  if (existing && operation.action !== 'delete') {
    const immutable = {
      courses:['teacher_id','teacherId'], schedules:['course_id','courseId'], enrollments:['schedule_id','scheduleId','course_id','courseId','student_id','studentId'],
      consumptions:['schedule_id','scheduleId','course_id','courseId','student_id','studentId'], payments:['schedule_id','scheduleId','course_id','courseId','student_id','studentId'],
      assetRecords:['owner_user_id','ownerUserId'],
    }[table] || [];
    for (let index=0; index<immutable.length; index+=2) {
      const keys=immutable.slice(index,index+2); const before=existing[keys[0]] ?? existing[keys[1]]; const after=data[keys[0]] ?? data[keys[1]];
      if(after!==undefined&&String(after)!==String(before??'')) throw error('OWNERSHIP_FIELD_IMMUTABLE');
    }
  }
  if (existing && operation.action === 'delete') return { decision:'apply', provenance };
  const baseVersion = data._base_version || operation.baseVersion;
  if (existing && baseVersion && existing.updated_at && baseVersion !== existing.updated_at) {
    return { decision: 'conflict', provenance };
  }
  try {
    assertRecordWritable(table, data, authz, lookup);
    return { decision: 'apply', provenance };
  } catch (err) {
    if (err.code === 'DATA_SCOPE_UNRESOLVED') return { decision: 'review', code: err.code, provenance };
    throw err;
  }
}

module.exports = { validateSyncMutation, buildSyncProvenance };
