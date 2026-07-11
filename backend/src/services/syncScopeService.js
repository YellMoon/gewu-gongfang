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
  if (table === 'questions' && operation.action !== 'delete') return { decision: 'apply', provenance };
  const data = operation.data || operation.payload || {};
  const existing = lookup.existing || null;
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
