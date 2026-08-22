'use strict';

const crypto = require('crypto');
const { types } = require('util');

function failure(code) {
  return Object.assign(new Error(code), { code });
}

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && !types.isProxy(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function exact(value, keys) {
  if (!plainObject(value) || Reflect.ownKeys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    throw failure('CLOUD_QUESTION_IMPORT_INPUT_INVALID');
  }
  return value;
}

function text(value, max = 256) {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.length > max) throw failure('CLOUD_QUESTION_IMPORT_INPUT_INVALID');
  return value;
}

function stableJson(value) {
  if (value === null || ['boolean', 'number', 'string'].includes(typeof value)) {
    if (typeof value === 'number' && !Number.isFinite(value)) throw failure('CLOUD_QUESTION_IMPORT_INPUT_INVALID');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (!plainObject(value)) throw failure('CLOUD_QUESTION_IMPORT_INPUT_INVALID');
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stableJson(value[key])).join(',') + '}';
}

function requestHash(value) {
  return crypto.createHash('sha256').update(stableJson(value), 'utf8').digest('hex');
}

function actor(value) {
  if (!plainObject(value) || !Array.isArray(value.roles)) throw failure('CLOUD_QUESTION_IMPORT_ACCESS_DENIED');
  const accountId = text(value.accountId, 512);
  if (!value.roles.some(role => ['super_admin', 'admin', 'teacher'].includes(role))) throw failure('CLOUD_QUESTION_IMPORT_ACCESS_DENIED');
  return { accountId, roles: value.roles.slice() };
}

function sourceRequest(value) {
  const request = exact(value, ['sourceType', 'sourceFileName', 'sourceMimeType', 'sourceSha256', 'sourceBytes', 'metadata', 'storage']);
  if (!['lecture', 'exam'].includes(request.sourceType)
    || !/^[A-Za-z0-9][A-Za-z0-9._ -]{0,507}\.(doc|docx)$/iu.test(request.sourceFileName)
    || !['application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(request.sourceMimeType)
    || !/^[0-9a-f]{64}$/.test(request.sourceSha256)
    || !Number.isSafeInteger(request.sourceBytes) || request.sourceBytes < 1 || request.sourceBytes > (64 * 1024 * 1024)
    || !plainObject(request.metadata)) {
    throw failure('CLOUD_QUESTION_IMPORT_INPUT_INVALID');
  }
  const storage = exact(request.storage, ['taskId', 'objectId', 'objectVersion']);
  if (!/^task_[A-Za-z0-9_-]{8,128}$/.test(storage.taskId)
    || !/^obj_[A-Za-z0-9_-]{1,128}$/.test(storage.objectId)
    || !Number.isSafeInteger(storage.objectVersion) || storage.objectVersion < 1) {
    throw failure('CLOUD_QUESTION_IMPORT_INPUT_INVALID');
  }
  return {
    sourceType: request.sourceType,
    sourceFileName: request.sourceFileName,
    sourceMimeType: request.sourceMimeType,
    sourceSha256: request.sourceSha256,
    sourceBytes: request.sourceBytes,
    metadata: JSON.parse(stableJson(request.metadata)),
    storage,
  };
}

function taskRow(row, replayed = false) {
  if (!plainObject(row) || typeof row.taskId !== 'string' || !/^question_import_task_[A-Za-z0-9_-]{1,128}$/.test(row.taskId)
    || !['awaiting_source_storage', 'queued_for_parse', 'parsing', 'candidates_ready', 'drafts_prepared', 'submitted', 'failed', 'cancelled', 'quarantined'].includes(row.status)
    || typeof row.phase !== 'string' || !/^[0-9a-f]{64}$/.test(row.requestHash)
    || !(row.createdAt instanceof Date) || !(row.updatedAt instanceof Date)) {
    throw failure('CLOUD_QUESTION_IMPORT_UNAVAILABLE');
  }
  return {
    taskId: row.taskId, status: row.status, phase: row.phase, requestHash: row.requestHash,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), replayed,
  };
}

const existingSql = [
  'SELECT task_id AS "taskId",status,phase,request_hash AS "requestHash",created_at AS "createdAt",updated_at AS "updatedAt"',
  'FROM business.question_import_tasks WHERE tenant_id=$1 AND account_id=$2 AND idempotency_key=$3',
].join(' ');

const insertSql = [
  'WITH inserted_storage_task AS (',
  'INSERT INTO business.storage_object_tasks (task_id,object_id,object_version,expected_sha256,expected_bytes,media_type,state)',
  "VALUES($12,$13,$14,$8,$9,$7,'queued') RETURNING task_id",
  '), inserted_task AS (',
  'INSERT INTO business.question_import_tasks',
  '(task_id,tenant_id,account_id,idempotency_key,source_type,source_file_name,source_mime_type,source_sha256,source_size_bytes,metadata_json,request_hash,status,phase)',
  "VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,'awaiting_source_storage','awaiting_source_storage')",
  'RETURNING task_id,status,phase,request_hash AS "requestHash",created_at AS "createdAt",updated_at AS "updatedAt"',
  '), inserted_source AS (',
  'INSERT INTO business.import_source_objects',
  '(import_task_id,tenant_id,object_id,object_version,storage_task_id,expected_sha256,expected_bytes,mime_type,storage_state)',
  "SELECT $1,$2,$13,$14,$12,$8,$9,$7,'queued' FROM inserted_storage_task",
  'RETURNING import_task_id',
  ') SELECT task_id AS "taskId",status,phase,"requestHash","createdAt","updatedAt" FROM inserted_task',
].join(' ');

const markSourceVerifiedSql = [
  'WITH verified_source AS (',
  "UPDATE business.import_source_objects SET storage_state='verified',verified_at=transaction_timestamp(),updated_at=transaction_timestamp()",
  "WHERE import_task_id=$1 AND storage_task_id=$2 AND storage_state='queued'",
  'RETURNING import_task_id',
  '), advanced_task AS (',
  "UPDATE business.question_import_tasks task SET status='queued_for_parse',phase='queued_for_parse',updated_at=transaction_timestamp()",
  "FROM verified_source source WHERE task.task_id=source.import_task_id AND task.status='awaiting_source_storage'",
  'RETURNING task.task_id AS "taskId",task.status,task.phase,task.request_hash AS "requestHash",task.created_at AS "createdAt",task.updated_at AS "updatedAt"',
  ') SELECT * FROM advanced_task',
].join(' ');

const storeCandidatesSql = [
  'WITH advanced_task AS (',
  "UPDATE business.question_import_tasks SET status='candidates_ready',phase='candidates_ready',updated_at=transaction_timestamp()",
  "WHERE task_id=$1 AND status IN ('queued_for_parse','parsing')",
  'RETURNING task_id,status,phase,request_hash AS "requestHash",created_at AS "createdAt",updated_at AS "updatedAt"',
  '), input_items AS (',
  "SELECT value AS item FROM jsonb_array_elements($2::jsonb)",
  '), inserted_items AS (',
  'INSERT INTO business.question_import_items (item_id,import_task_id,item_index,content_hash,candidate_json,validation_json,media_manifest_json,status)',
  "SELECT item->>'itemId',task.task_id,(item->>'itemIndex')::integer,item->>'contentHash',(item->'candidate'),(item->'validation'),(item->'mediaManifest'),item->'validation'->>'status'",
  'FROM advanced_task task CROSS JOIN input_items',
  'RETURNING item_id',
  ') SELECT task_id AS "taskId",status,phase,"requestHash","createdAt","updatedAt" FROM advanced_task',
].join(' ');

const prepareDraftsSql = [
  'WITH eligible_items AS (',
  "SELECT item_id FROM business.question_import_items WHERE import_task_id=$1 AND status IN ('accepted','warning')",
  '), owned_task AS (',
  "UPDATE business.question_import_tasks SET status='drafts_prepared',phase='drafts_prepared',updated_at=transaction_timestamp()",
  "WHERE task_id=$1 AND tenant_id=$2 AND account_id=$3 AND status='candidates_ready' AND EXISTS (SELECT 1 FROM eligible_items)",
  'RETURNING task_id,status,phase,request_hash AS "requestHash",created_at AS "createdAt",updated_at AS "updatedAt"',
  '), marked_items AS (',
  "UPDATE business.question_import_items item SET status='draft_prepared',updated_at=transaction_timestamp()",
  "FROM owned_task task WHERE item.import_task_id=task.task_id AND item.status IN ('accepted','warning')",
  'RETURNING item.item_id AS "itemId",item.item_index AS "itemIndex",item.content_hash AS "contentHash",item.candidate_json AS candidate,item.validation_json AS validation,item.media_manifest_json AS "mediaManifest"',
  ') SELECT task.task_id AS "taskId",task.status,task.phase,task."requestHash",task."createdAt",task."updatedAt",',
  "COALESCE((SELECT jsonb_agg(jsonb_build_object('itemId',item.\"itemId\",'itemIndex',item.\"itemIndex\",'contentHash',item.\"contentHash\",'candidate',item.candidate,'validation',item.validation,'mediaManifest',item.\"mediaManifest\") ORDER BY item.\"itemIndex\") FROM marked_items item),'[]'::jsonb) AS items",
  'FROM owned_task task',
].join(' ');

function preparedTaskRow(row) {
  const task = taskRow(row, false);
  if (!Array.isArray(row.items) || row.items.length < 1 || row.items.some(item => !plainObject(item)
    || typeof item.itemId !== 'string' || !/^question_import_item_[A-Za-z0-9_-]{1,128}$/.test(item.itemId)
    || !Number.isSafeInteger(item.itemIndex) || item.itemIndex < 0 || !/^[0-9a-f]{64}$/.test(item.contentHash)
    || !plainObject(item.candidate) || !plainObject(item.validation) || !Array.isArray(item.mediaManifest))) {
    throw failure('CLOUD_QUESTION_IMPORT_UNAVAILABLE');
  }
  return { ...task, items: row.items.map(item => ({
    itemId: item.itemId, itemIndex: item.itemIndex, contentHash: item.contentHash,
    candidate: item.candidate, validation: item.validation, mediaManifest: item.mediaManifest,
  })) };
}

function candidateRows(value, randomId) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 500) throw failure('CLOUD_QUESTION_IMPORT_INPUT_INVALID');
  return value.map((entry, itemIndex) => {
    const item = exact(entry, ['contentHash', 'candidate', 'validation', 'mediaManifest']);
    if (!/^[0-9a-f]{64}$/.test(item.contentHash) || !plainObject(item.candidate) || !plainObject(item.validation)
      || !['accepted', 'warning', 'rejected'].includes(item.validation.status) || !Array.isArray(item.mediaManifest)) {
      throw failure('CLOUD_QUESTION_IMPORT_INPUT_INVALID');
    }
    const candidateJson = stableJson(item.candidate);
    const validationJson = stableJson(item.validation);
    const mediaManifestJson = stableJson(item.mediaManifest);
    if (candidateJson.length > (1024 * 1024) || validationJson.length > (64 * 1024) || mediaManifestJson.length > (256 * 1024)
      || /data:[^,]*;base64|"(?:bytes|ciphertext|plaintext)"\s*:/iu.test(candidateJson + validationJson + mediaManifestJson)) {
      throw failure('CLOUD_QUESTION_IMPORT_INPUT_INVALID');
    }
    const itemId = 'question_import_item_' + String(randomId()).replace(/[^A-Za-z0-9_-]/g, '') + '_' + itemIndex;
    if (!/^question_import_item_[A-Za-z0-9_-]{1,128}$/.test(itemId)) throw failure('CLOUD_QUESTION_IMPORT_UNAVAILABLE');
    return {
      itemId, itemIndex, contentHash: item.contentHash,
      candidate: JSON.parse(candidateJson), validation: JSON.parse(validationJson), mediaManifest: JSON.parse(mediaManifestJson),
    };
  });
}

function createQuestionImportTaskRepository({ query, randomId = () => crypto.randomUUID() } = {}) {
  if (typeof query !== 'function' || typeof randomId !== 'function') throw failure('CLOUD_QUESTION_IMPORT_INPUT_INVALID');
  return Object.freeze({
    async create(input) {
      const request = exact(input, ['tenantId', 'actor', 'idempotencyKey', 'request']);
      const tenantId = text(request.tenantId, 128);
      const currentActor = actor(request.actor);
      const idempotencyKey = text(request.idempotencyKey, 256);
      const source = sourceRequest(request.request);
      const hash = requestHash({
        sourceType: source.sourceType, sourceFileName: source.sourceFileName, sourceMimeType: source.sourceMimeType,
        sourceSha256: source.sourceSha256, sourceBytes: source.sourceBytes, metadata: source.metadata, storage: source.storage,
      });
      const existing = await query(existingSql, [tenantId, currentActor.accountId, idempotencyKey]);
      if (!existing || !Array.isArray(existing.rows) || existing.rows.length > 1) throw failure('CLOUD_QUESTION_IMPORT_UNAVAILABLE');
      if (existing.rows.length === 1) {
        const row = existing.rows[0];
        if (row.requestHash !== hash) throw failure('CLOUD_QUESTION_IMPORT_CONFLICT');
        return taskRow(row, true);
      }
      const taskId = 'question_import_task_' + String(randomId()).replace(/[^A-Za-z0-9_-]/g, '');
      if (!/^question_import_task_[A-Za-z0-9_-]{1,128}$/.test(taskId)) throw failure('CLOUD_QUESTION_IMPORT_UNAVAILABLE');
      const result = await query(insertSql, [
        taskId, tenantId, currentActor.accountId, idempotencyKey, source.sourceType, source.sourceFileName,
        source.sourceMimeType, source.sourceSha256, source.sourceBytes, stableJson(source.metadata), hash,
        source.storage.taskId, source.storage.objectId, source.storage.objectVersion,
      ]);
      if (!result || !Array.isArray(result.rows) || result.rows.length !== 1) throw failure('CLOUD_QUESTION_IMPORT_UNAVAILABLE');
      return taskRow(result.rows[0], false);
    },
    async markSourceVerified(input) {
      const request = exact(input, ['taskId', 'storageTaskId']);
      const taskId = text(request.taskId, 160);
      const storageTaskId = text(request.storageTaskId, 160);
      if (!/^question_import_task_[A-Za-z0-9_-]{1,128}$/.test(taskId) || !/^task_[A-Za-z0-9_-]{8,128}$/.test(storageTaskId)) {
        throw failure('CLOUD_QUESTION_IMPORT_INPUT_INVALID');
      }
      const result = await query(markSourceVerifiedSql, [taskId, storageTaskId]);
      if (!result || !Array.isArray(result.rows) || result.rows.length !== 1) throw failure('CLOUD_QUESTION_IMPORT_SOURCE_UNVERIFIED');
      return taskRow(result.rows[0], false);
    },
    async storeCandidates(input) {
      const request = exact(input, ['taskId', 'candidates']);
      const taskId = text(request.taskId, 160);
      if (!/^question_import_task_[A-Za-z0-9_-]{1,128}$/.test(taskId)) throw failure('CLOUD_QUESTION_IMPORT_INPUT_INVALID');
      const candidates = candidateRows(request.candidates, randomId);
      const result = await query(storeCandidatesSql, [taskId, stableJson(candidates)]);
      if (!result || !Array.isArray(result.rows) || result.rows.length !== 1) throw failure('CLOUD_QUESTION_IMPORT_SOURCE_UNVERIFIED');
      return taskRow(result.rows[0], false);
    },
    async prepareDrafts(input) {
      const request = exact(input, ['tenantId', 'actor', 'taskId']);
      const tenantId = text(request.tenantId, 128);
      const currentActor = actor(request.actor);
      const taskId = text(request.taskId, 160);
      if (!/^question_import_task_[A-Za-z0-9_-]{1,128}$/.test(taskId)) throw failure('CLOUD_QUESTION_IMPORT_INPUT_INVALID');
      const result = await query(prepareDraftsSql, [taskId, tenantId, currentActor.accountId]);
      if (!result || !Array.isArray(result.rows) || result.rows.length !== 1) throw failure('CLOUD_QUESTION_IMPORT_NOT_CONFIRMABLE');
      return preparedTaskRow(result.rows[0]);
    },
  });
}

module.exports = Object.freeze({ createQuestionImportTaskRepository });
