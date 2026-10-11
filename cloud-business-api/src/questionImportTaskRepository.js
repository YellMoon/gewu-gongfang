'use strict';

const crypto = require('crypto');
const { types } = require('util');
const { INVALID_CHOICE_STRUCTURE, validateChoiceQuestionStructure } = require('./questionChoiceStructure');
const { normalizeQuestionRichContent, projectQuestionRichContent } = require('../../shared/questionRichContentContract');
const { applyImportLabels, inferImportedQuestionType } = require('../../shared/questionImportMetadata');

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

function canonicalBase64url(value, { length = null, max = 4096 } = {}) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value) || value.length > max) throw failure('CLOUD_QUESTION_IMPORT_INPUT_INVALID');
  const bytes = Buffer.from(value, 'base64url');
  if (!bytes.length || (length !== null && bytes.length !== length) || bytes.toString('base64url') !== value) throw failure('CLOUD_QUESTION_IMPORT_INPUT_INVALID');
  return bytes;
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
  if (!value.roles.some(role => ['super_admin', 'teacher'].includes(role))) throw failure('CLOUD_QUESTION_IMPORT_ACCESS_DENIED');
  return { accountId, roles: value.roles.slice() };
}

function safeWordFileName(value) {
  return typeof value === 'string' && value === value.trim() && value.length > 5 && value.length <= 512
    && !/[\\/\u0000\r\n]/.test(value) && /^[\p{L}\p{N}]/u.test(value) && /\.(?:doc|docx)$/iu.test(value);
}

function sourceRequest(value, now) {
  const request = exact(value, ['sourceType', 'sourceFileName', 'sourceMimeType', 'sourceSha256', 'sourceBytes', 'metadata', 'storage', 'relay']);
  if (!['lecture', 'exam'].includes(request.sourceType)
    || !safeWordFileName(request.sourceFileName)
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
  const relay = exact(request.relay, ['agentKeyFingerprint', 'envelope', 'ciphertext', 'expiresAt']);
  const envelope = exact(relay.envelope, [
    'version', 'ephemeralPublicKey', 'keyDerivationSalt', 'wrappedKeyNonce', 'wrappedKeyCiphertext', 'wrappedKeyTag',
    'contentNonce', 'contentTag', 'ciphertextSha256', 'ciphertextBytes', 'plaintextSha256', 'plaintextBytes',
  ]);
  if (typeof relay.agentKeyFingerprint !== 'string' || relay.agentKeyFingerprint.length !== 64 || !/^[0-9a-f]{64}$/.test(relay.agentKeyFingerprint)
    || envelope.version !== 'x25519-aes-256-gcm-v1' || !/^[0-9a-f]{64}$/.test(envelope.ciphertextSha256)
    || envelope.plaintextSha256 !== request.sourceSha256 || envelope.plaintextBytes !== request.sourceBytes
    || !Number.isSafeInteger(envelope.ciphertextBytes) || envelope.ciphertextBytes < 1 || envelope.ciphertextBytes > (64 * 1024 * 1024)) {
    throw failure('CLOUD_QUESTION_IMPORT_INPUT_INVALID');
  }
  canonicalBase64url(envelope.ephemeralPublicKey, { max: 512 });
  canonicalBase64url(envelope.keyDerivationSalt, { length: 16 });
  canonicalBase64url(envelope.wrappedKeyNonce, { length: 12 });
  canonicalBase64url(envelope.wrappedKeyCiphertext, { length: 32 });
  canonicalBase64url(envelope.wrappedKeyTag, { length: 16 });
  canonicalBase64url(envelope.contentNonce, { length: 12 });
  canonicalBase64url(envelope.contentTag, { length: 16 });
  const ciphertext = Buffer.isBuffer(relay.ciphertext) ? Buffer.from(relay.ciphertext) : null;
  if (!ciphertext || ciphertext.length !== envelope.ciphertextBytes
    || crypto.createHash('sha256').update(ciphertext).digest('hex') !== envelope.ciphertextSha256) {
    throw failure('CLOUD_QUESTION_IMPORT_INPUT_INVALID');
  }
  const expiresAt = new Date(relay.expiresAt);
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()) || typeof relay.expiresAt !== 'string'
    || relay.expiresAt.length > 64 || !Number.isFinite(expiresAt.getTime()) || expiresAt.toISOString() !== relay.expiresAt
    || expiresAt.getTime() <= now.getTime() || expiresAt.getTime() > now.getTime() + (15 * 60 * 1000)) {
    throw failure('CLOUD_QUESTION_IMPORT_INPUT_INVALID');
  }
  return {
    sourceType: request.sourceType,
    sourceFileName: request.sourceFileName,
    sourceMimeType: request.sourceMimeType,
    sourceSha256: request.sourceSha256,
    sourceBytes: request.sourceBytes,
    metadata: JSON.parse(stableJson(request.metadata)),
    storage, relay: { agentKeyFingerprint: relay.agentKeyFingerprint, envelope, ciphertext, expiresAt: expiresAt.toISOString() },
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
  'WITH latest_runtime AS (',
  'SELECT receipt_id,contracts,parser_sha256,observed_at FROM business.storage_agent_runtime_receipts',
  'WHERE agent_id=$20 ORDER BY observed_at DESC,receipt_id DESC LIMIT 1',
  '), trusted_runtime AS (',
  'SELECT receipt_id,parser_sha256 FROM latest_runtime',
  "WHERE contracts=jsonb_build_object('questionPaperExport',3,'storageAgentTransport',3,'questionImportParserProof',1)",
  "AND parser_sha256 ~ '^[0-9a-f]{64}$' AND observed_at >= transaction_timestamp()-($21::integer * interval '1 second')",
  '), inserted_task AS (',
  'INSERT INTO business.question_import_tasks',
  '(task_id,tenant_id,account_id,idempotency_key,source_type,source_file_name,source_mime_type,source_sha256,source_size_bytes,metadata_json,request_hash,parser_contract_version,parser_sha256,parser_runtime_receipt_id,status,phase)',
  "SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,1,runtime.parser_sha256,runtime.receipt_id,'awaiting_source_storage','awaiting_source_storage' FROM trusted_runtime runtime",
  'RETURNING task_id,status,phase,request_hash AS "requestHash",created_at AS "createdAt",updated_at AS "updatedAt"',
  '), inserted_storage_task AS (',
  'INSERT INTO business.storage_object_tasks (task_id,object_id,object_version,expected_sha256,expected_bytes,media_type,state)',
  "SELECT $12,$13,$14,$8,$9,$7,'queued' FROM inserted_task RETURNING task_id",
  '), inserted_source AS (',
  'INSERT INTO business.import_source_objects',
  '(import_task_id,tenant_id,object_id,object_version,storage_task_id,expected_sha256,expected_bytes,mime_type,storage_state)',
  "SELECT task.task_id,$2,$13,$14,storage.task_id,$8,$9,$7,'queued' FROM inserted_task task CROSS JOIN inserted_storage_task storage",
  'RETURNING import_task_id,storage_task_id',
  '), inserted_relay AS (',
  'INSERT INTO business.encrypted_import_source_relays (storage_task_id,import_task_id,tenant_id,actor_account_id,agent_key_fingerprint,envelope_json,ciphertext,ciphertext_sha256,expires_at)',
  'SELECT source.storage_task_id,source.import_task_id,$2,$3,$15,$16::jsonb,$17,$18,$19::timestamptz FROM inserted_source source',
  'RETURNING storage_task_id',
  ') SELECT task_id AS "taskId",status,phase,"requestHash","createdAt","updatedAt" FROM inserted_task CROSS JOIN inserted_relay',
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

const completeSourceAndStoreCandidatesSql = [
  'WITH completed AS (',
  "UPDATE business.storage_object_tasks storage SET state='verified',updated_at=transaction_timestamp()",
  'FROM business.import_source_objects source',
  "WHERE source.import_task_id=$1 AND storage.task_id=source.storage_task_id AND storage.state='leased' AND storage.lease_agent_id=$2 AND storage.lease_token_sha256=$3",
  'AND storage.lease_expires_at > transaction_timestamp() AND storage.expected_sha256=$4 AND storage.expected_bytes=$5',
  'AND EXISTS (SELECT 1 FROM business.question_import_tasks expected WHERE expected.task_id=source.import_task_id AND (',
  "(expected.processing_location='storage_agent' AND expected.parser_contract_version=0 AND $8::text IS NULL)",
  'OR (expected.parser_contract_version=1 AND expected.parser_sha256=$8::text)))',
  'RETURNING storage.task_id',
  '), receipt AS (',
  'INSERT INTO business.storage_task_receipts (receipt_id,task_id,agent_id,observed_sha256,observed_bytes)',
  'SELECT $6,task_id,$2,$4,$5 FROM completed',
  'RETURNING task_id',
  '), verified_source AS (',
  "UPDATE business.import_source_objects source SET storage_state='verified',verified_at=transaction_timestamp(),updated_at=transaction_timestamp()",
  "FROM receipt WHERE source.storage_task_id=receipt.task_id AND source.storage_state='queued'",
  'RETURNING source.import_task_id',
  '), advanced_task AS (',
  "UPDATE business.question_import_tasks task SET status='candidates_ready',phase='candidates_ready',updated_at=transaction_timestamp()",
  "FROM verified_source source WHERE task.task_id=source.import_task_id AND task.task_id=$1 AND task.status='awaiting_source_storage'",
  'RETURNING task.task_id,status,phase,request_hash AS "requestHash",created_at AS "createdAt",updated_at AS "updatedAt"',
  '), input_items AS (',
  "SELECT value AS item FROM jsonb_array_elements($7::jsonb)",
  '), inserted_items AS (',
  'INSERT INTO business.question_import_items (item_id,import_task_id,item_index,content_hash,candidate_json,validation_json,media_manifest_json,status)',
  "SELECT item->>'itemId',task.task_id,(item->>'itemIndex')::integer,item->>'contentHash',(item->'candidate'),(item->'validation'),(item->'mediaManifest'),item->'validation'->>'status'",
  'FROM advanced_task task CROSS JOIN input_items',
  'RETURNING item_id',
  '), input_media AS (',
  "SELECT (item->>'itemIndex')::integer AS item_index,media FROM input_items CROSS JOIN LATERAL jsonb_array_elements(item->'mediaManifest') AS media",
  '), inserted_storage_tasks AS (',
  'INSERT INTO business.storage_object_tasks (task_id,object_id,object_version,expected_sha256,expected_bytes,media_type,state)',
  "SELECT media->>'storageTaskId',media->>'objectId',(media->>'objectVersion')::integer,media->>'sha256',(media->>'bytes')::bigint,media->>'mimeType','queued' FROM advanced_task task CROSS JOIN input_media",
  'RETURNING task_id',
  '), inserted_media AS (',
  'INSERT INTO business.question_import_media_objects (media_id,import_task_id,item_index,asset_index,object_id,object_version,storage_task_id,expected_sha256,expected_bytes,mime_type,storage_state)',
  "SELECT media->>'mediaId',$1,item_index,(media->>'assetIndex')::integer,media->>'objectId',(media->>'objectVersion')::integer,media->>'storageTaskId',media->>'sha256',(media->>'bytes')::bigint,media->>'mimeType','queued'",
  "FROM input_media JOIN inserted_storage_tasks storage ON storage.task_id=media->>'storageTaskId'",
  'RETURNING media_id AS "mediaId",item_index AS "itemIndex",asset_index AS "assetIndex",object_id AS "objectId",object_version AS "objectVersion",storage_task_id AS "storageTaskId",expected_sha256 AS sha256,expected_bytes AS bytes,mime_type AS "mimeType"',
  '), deleted_import_source_relay AS (',
  'DELETE FROM business.encrypted_import_source_relays relay USING completed',
  'WHERE relay.storage_task_id=completed.task_id',
  ') SELECT task_id AS "taskId",status,phase,"requestHash","createdAt","updatedAt",',
  "COALESCE((SELECT jsonb_agg(jsonb_build_object('mediaId',media.\"mediaId\",'itemIndex',media.\"itemIndex\",'assetIndex',media.\"assetIndex\",'objectId',media.\"objectId\",'objectVersion',media.\"objectVersion\",'storageTaskId',media.\"storageTaskId\",'sha256',media.sha256,'bytes',media.bytes,'mimeType',media.\"mimeType\") ORDER BY media.\"itemIndex\",media.\"assetIndex\") FROM inserted_media media),'[]'::jsonb) AS \"mediaTargets\"",
  'FROM advanced_task',
].join(' ');

const prepareDraftsSql = [
  'WITH eligible_items AS (',
  "SELECT item_id FROM business.question_import_items WHERE import_task_id=$1 AND status IN ('accepted','warning')",
  '), owned_task AS (',
  "UPDATE business.question_import_tasks SET status='drafts_prepared',phase='drafts_prepared',updated_at=transaction_timestamp()",
  "WHERE task_id=$1 AND tenant_id=$2 AND account_id=$3 AND (status='candidates_ready' OR (processing_location='desktop' AND status='awaiting_source_storage')) AND EXISTS (SELECT 1 FROM eligible_items)",
  "AND EXISTS (SELECT 1 FROM business.import_source_objects source WHERE source.import_task_id=$1 AND source.storage_state='verified')",
  "AND NOT EXISTS (SELECT 1 FROM business.question_import_media_objects media WHERE media.import_task_id=$1 AND media.storage_state<>'verified')",
  'RETURNING task_id,status,phase,request_hash AS "requestHash",created_at AS "createdAt",updated_at AS "updatedAt"',
  '), marked_items AS (',
  "UPDATE business.question_import_items item SET status='draft_prepared',updated_at=transaction_timestamp()",
  "FROM owned_task task WHERE item.import_task_id=task.task_id AND item.status IN ('accepted','warning')",
  'RETURNING item.item_id AS "itemId",item.item_index AS "itemIndex",item.content_hash AS "contentHash",item.candidate_json AS candidate,item.validation_json AS validation,item.media_manifest_json AS "mediaManifest"',
  ') SELECT task.task_id AS "taskId",task.status,task.phase,task."requestHash",task."createdAt",task."updatedAt",',
  "COALESCE((SELECT jsonb_agg(jsonb_build_object('itemId',item.\"itemId\",'itemIndex',item.\"itemIndex\",'contentHash',item.\"contentHash\",'candidate',item.candidate,'validation',item.validation,'mediaManifest',item.\"mediaManifest\") ORDER BY item.\"itemIndex\") FROM marked_items item),'[]'::jsonb) AS items",
  'FROM owned_task task',
].join(' ');

const readSql = [
  // Recover readiness after a receipt commit followed by a worker crash. Ownership is checked
  // on both the derived-state update and the read; quarantined imports are never resurrected.
  'WITH reconciled AS (',
  "UPDATE business.question_import_tasks task SET status='candidates_ready',phase='candidates_ready',updated_at=transaction_timestamp()",
  "WHERE task.tenant_id=$1 AND task.account_id=$2 AND task.task_id=$3 AND task.processing_location='desktop' AND task.status='awaiting_source_storage'",
  "AND EXISTS (SELECT 1 FROM business.import_source_objects source WHERE source.import_task_id=task.task_id AND source.storage_state='verified')",
  "AND NOT EXISTS (SELECT 1 FROM business.question_import_media_objects media WHERE media.import_task_id=task.task_id AND media.storage_state<>'verified')",
  'RETURNING task_id,status,phase,updated_at',
  ') SELECT task.task_id AS "taskId",COALESCE(reconciled.status,task.status) AS status,COALESCE(reconciled.phase,task.phase) AS phase,task.request_hash AS "requestHash",task.created_at AS "createdAt",COALESCE(reconciled.updated_at,task.updated_at) AS "updatedAt",',
  'source.storage_state AS "sourceStorageState",',
  'task.source_file_name AS "sourceFileName",task.source_type AS "sourceType",task.metadata_json AS metadata,',
  'task.processing_location AS "processingLocation",',
  "CASE WHEN EXISTS (SELECT 1 FROM business.question_import_media_objects media WHERE media.import_task_id=task.task_id AND media.storage_state<>'verified') THEN 'queued' ELSE 'verified' END AS \"mediaStorageState\",",
  "COALESCE((SELECT jsonb_agg(jsonb_build_object('mediaId',media.media_id,'itemIndex',media.item_index,'assetIndex',media.asset_index,'objectId',media.object_id,'objectVersion',media.object_version,'storageTaskId',media.storage_task_id,'sha256',media.expected_sha256,'bytes',media.expected_bytes,'mimeType',media.mime_type,'storageState',media.storage_state) ORDER BY media.item_index,media.asset_index) FROM business.question_import_media_objects media WHERE media.import_task_id=task.task_id),'[]'::jsonb) AS \"mediaTargets\",",
  "COALESCE((SELECT jsonb_agg(jsonb_build_object('itemId',item.item_id,'itemIndex',item.item_index,'contentHash',item.content_hash,'candidate',item.candidate_json,'validation',item.validation_json,'mediaManifest',item.media_manifest_json,'status',item.status) ORDER BY item.item_index) FROM business.question_import_items item WHERE item.import_task_id=task.task_id),'[]'::jsonb) AS items",
  'FROM business.question_import_tasks task',
  'LEFT JOIN reconciled ON reconciled.task_id=task.task_id',
  'LEFT JOIN business.import_source_objects source ON source.import_task_id=task.task_id',
  'WHERE task.tenant_id=$1 AND task.account_id=$2 AND task.task_id=$3',
].join(' ');

function itemRows(value, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length < 1) || value.some(item => !plainObject(item)
    || typeof item.itemId !== 'string' || !/^question_import_item_[A-Za-z0-9_-]{1,128}$/.test(item.itemId)
    || !Number.isSafeInteger(item.itemIndex) || item.itemIndex < 0 || !/^[0-9a-f]{64}$/.test(item.contentHash)
    || !plainObject(item.candidate) || !plainObject(item.validation) || !Array.isArray(item.mediaManifest))) {
    throw failure('CLOUD_QUESTION_IMPORT_UNAVAILABLE');
  }
  return value.map(item => ({
    itemId: item.itemId, itemIndex: item.itemIndex, contentHash: item.contentHash,
    candidate: item.candidate, validation: item.validation, mediaManifest: item.mediaManifest,
    ...(typeof item.status === 'string' ? { status: item.status } : {}),
  }));
}

function preparedTaskRow(row) {
  const task = taskRow(row, false);
  return { ...task, items: itemRows(row.items) };
}

function readTaskRow(row) {
  const task = taskRow(row, false);
  if (!['queued', 'verified', 'quarantined'].includes(row.sourceStorageState)) throw failure('CLOUD_QUESTION_IMPORT_UNAVAILABLE');
  return { ...task, sourceStorageState: row.sourceStorageState, items: itemRows(row.items, { allowEmpty: true }),
    ...(row.sourceFileName ? { sourceFileName: row.sourceFileName, sourceType: row.sourceType, metadata: row.metadata } : {}),
    ...(row.processingLocation ? { processingLocation: row.processingLocation, mediaStorageState: row.mediaStorageState, mediaTargets: row.mediaTargets } : {}) };
}

function candidateRows(value, randomId) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 500) throw failure('CLOUD_QUESTION_IMPORT_INPUT_INVALID');
  return value.map((entry, itemIndex) => {
    const item = exact(entry, ['contentHash', 'candidate', 'validation', 'mediaManifest']);
    if (!/^[0-9a-f]{64}$/.test(item.contentHash) || !plainObject(item.candidate) || !plainObject(item.validation)
      || !['accepted', 'warning', 'rejected'].includes(item.validation.status) || !Array.isArray(item.mediaManifest)) {
      throw failure('CLOUD_QUESTION_IMPORT_INPUT_INVALID');
    }
    const choiceStructure = validateChoiceQuestionStructure({
      type: item.candidate.question_types ?? item.candidate.type,
      options: item.candidate.options,
      answer: item.candidate.answer,
    });
    const validation = choiceStructure.valid ? item.validation : {
      ...item.validation,
      status: 'rejected',
      codes: [...new Set([
        ...(Array.isArray(item.validation.codes) ? item.validation.codes.filter(code => typeof code === 'string') : []),
        INVALID_CHOICE_STRUCTURE,
      ])],
    };
    const candidateJson = stableJson(item.candidate);
    const validationJson = stableJson(validation);
    const mediaManifest = item.mediaManifest.map((asset, assetIndex) => {
      const current = exact(asset, ['sha256', 'bytes', 'mimeType']);
      if (!/^[0-9a-f]{64}$/.test(current.sha256) || !Number.isSafeInteger(current.bytes) || current.bytes < 1 || current.bytes > (64 * 1024 * 1024)
        || typeof current.mimeType !== 'string' || current.mimeType !== current.mimeType.trim() || !current.mimeType || current.mimeType.length > 255) {
        throw failure('CLOUD_QUESTION_IMPORT_INPUT_INVALID');
      }
      const suffix = String(randomId()).replace(/[^A-Za-z0-9_-]/g, '') + '_' + itemIndex + '_' + assetIndex;
      const mediaId = 'question_import_media_' + suffix;
      const objectId = 'obj_import_media_' + suffix;
      const storageTaskId = 'task_import_media_' + suffix;
      if (!/^question_import_media_[A-Za-z0-9_-]{1,128}$/.test(mediaId) || !/^obj_[A-Za-z0-9_-]{1,128}$/.test(objectId)
        || !/^task_[A-Za-z0-9_-]{8,128}$/.test(storageTaskId)) throw failure('CLOUD_QUESTION_IMPORT_UNAVAILABLE');
      return { mediaId, assetIndex, objectId, objectVersion: 1, storageTaskId, sha256: current.sha256, bytes: current.bytes, mimeType: current.mimeType };
    });
    const mediaManifestJson = stableJson(mediaManifest);
    if (candidateJson.length > (1024 * 1024) || validationJson.length > (64 * 1024) || mediaManifestJson.length > (256 * 1024)
      || /data:[^,]*;base64|"(?:ciphertext|plaintext)"\s*:/iu.test(candidateJson + validationJson + mediaManifestJson)) {
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

// Client parser revisions are audit data. All candidate identity and validation are decided here.
function bindDesktopRichMedia(richContent, assets) {
  const aliases = new Map();
  const addAlias = (alias, hash) => {
    if (!aliases.has(alias)) aliases.set(alias, new Set());
    aliases.get(alias).add(hash);
  };
  for (const asset of assets) {
    addAlias(asset.contentHash, asset.contentHash);
    // Only an exact retained basename is an alias. Arbitrary source paths never allocate media.
    if (/^[A-Za-z0-9][A-Za-z0-9._-]{0,507}$/.test(asset.fileName) && !asset.fileName.includes('..')) {
      addAlias(asset.fileName, asset.contentHash);
      addAlias('word/media/' + asset.fileName, asset.contentHash);
      if (asset.assetType === 'formula_preview' && asset.mimeType === 'image/png' && /\.png$/i.test(asset.fileName)) {
        for (const extension of ['wmf', 'emf']) {
          const originalName = asset.fileName.replace(/\.png$/i, '.' + extension);
          addAlias(originalName, asset.contentHash);
          addAlias('word/media/' + originalName, asset.contentHash);
        }
      }
    }
  }
  const resolve = reference => {
    if (typeof reference !== 'string') throw failure('CLOUD_QUESTION_IMPORT_INPUT_INVALID');
    const key = reference.startsWith('question-asset://') ? reference.slice('question-asset://'.length) : reference;
    const matches = aliases.get(key);
    if (!matches || matches.size !== 1) throw failure('CLOUD_QUESTION_IMPORT_INPUT_INVALID');
    return [...matches][0];
  };
  const visit = node => {
    if (!plainObject(node)) return;
    if (node.type === 'image') {
      const hash = resolve(node.attrs.assetKey);
      node.attrs.assetKey = hash;
      node.attrs.src = 'question-asset://' + hash;
    }
    if (['formula', 'formulaBlock'].includes(node.type) && node.attrs.previewRef != null) {
      node.attrs.previewRef = 'question-asset://' + resolve(node.attrs.previewRef);
    }
    Object.values(node).forEach(child => Array.isArray(child) ? child.forEach(visit) : visit(child));
  };
  visit(richContent);
}

function desktopCandidateRows(value, randomId) {
  if (!Array.isArray(value)) throw failure('CLOUD_QUESTION_IMPORT_INPUT_INVALID');
  const normalized = value.map(entry => {
    const item = exact(entry, ['contentHash', 'candidate', 'validation', 'mediaManifest']);
    if (!plainObject(item.candidate) || !Array.isArray(item.mediaManifest) || !plainObject(item.validation)) throw failure('CLOUD_QUESTION_IMPORT_INPUT_INVALID');
    let candidate = item.candidate;
    if (candidate.rich_content !== undefined && candidate.rich_content !== null) {
      try {
        const richContent = normalizeQuestionRichContent(candidate.rich_content);
        const projection = projectQuestionRichContent(richContent);
        candidate = { ...candidate, rich_content: richContent, stem: projection.stem, content: projection.stem,
          answer: projection.answer, analysis: projection.explanation, explanation: projection.explanation,
          options: projection.options.map(option => ({ label: option.label, content: option.content, is_correct: option.isCorrect })),
          sub_questions: projection.subQuestions, has_formula: projection.hasFormula, has_image: projection.hasImage };
      } catch (_) { throw failure('CLOUD_QUESTION_IMPORT_INPUT_INVALID'); }
    }
    if ((candidate.stem !== undefined && typeof candidate.stem !== 'string')
      || (candidate.answer != null && typeof candidate.answer !== 'string')
      || (candidate.analysis != null && typeof candidate.analysis !== 'string')
      || (candidate.options !== undefined && (!Array.isArray(candidate.options) || candidate.options.some(option =>
        typeof option !== 'string' && (!plainObject(option) || typeof option.label !== 'string' || typeof option.content !== 'string'))))) {
      throw failure('CLOUD_QUESTION_IMPORT_INPUT_INVALID');
    }
    candidate = { ...candidate, type: inferImportedQuestionType(candidate), question_types: [inferImportedQuestionType(candidate)] };
    const assets = candidate.assets ?? [];
    if (!Array.isArray(assets) || assets.length !== item.mediaManifest.length || assets.some((asset, index) => {
      const manifest = item.mediaManifest[index];
      return !plainObject(asset) || !plainObject(manifest) || asset.assetIndex !== index
        || typeof asset.assetType !== 'string' || !asset.assetType || asset.assetType.length > 64
        || typeof asset.fileName !== 'string' || !asset.fileName || asset.fileName.length > 512
        || asset.contentHash !== manifest.sha256 || asset.sizeBytes !== manifest.bytes || asset.mimeType !== manifest.mimeType;
    })) throw failure('CLOUD_QUESTION_IMPORT_INPUT_INVALID');
    if (candidate.rich_content) bindDesktopRichMedia(candidate.rich_content, assets);
    const codes = [];
    if (typeof candidate.stem !== 'string' || !candidate.stem.trim()) codes.push('missing_stem');
    if (typeof candidate.answer !== 'string' || !candidate.answer.trim()) codes.push('missing_answer');
    if (Array.isArray(candidate.formulas) && candidate.formulas.some(formula => plainObject(formula)
      && ['approximate', 'preview_only', 'failed'].includes(formula.conversion_status))) codes.push('formula_needs_review');
    const needsRichFormulaReview = value => plainObject(value) && (
      (['formula', 'formulaBlock'].includes(value.type) && ['approximate', 'preview_only', 'failed'].includes(value.attrs?.conversionStatus))
      || Object.values(value).some(child => Array.isArray(child) ? child.some(needsRichFormulaReview) : needsRichFormulaReview(child))
    );
    if (candidate.rich_content && needsRichFormulaReview(candidate.rich_content) && !codes.includes('formula_needs_review')) codes.push('formula_needs_review');
    return { contentHash: requestHash(candidate), candidate, mediaManifest: item.mediaManifest,
      validation: { status: codes.includes('missing_stem') ? 'rejected' : codes.length ? 'warning' : 'accepted', codes } };
  });
  return candidateRows(normalized, randomId);
}

const mediaTargetsSql = `SELECT media_id AS "mediaId",item_index AS "itemIndex",asset_index AS "assetIndex",
  object_id AS "objectId",object_version AS "objectVersion",storage_task_id AS "storageTaskId",
  expected_sha256 AS sha256,expected_bytes::float8 AS bytes,mime_type AS "mimeType"
  FROM business.question_import_media_objects WHERE import_task_id=$1 ORDER BY item_index,asset_index`;

const insertParsedSql = `WITH inserted_task AS (
  INSERT INTO business.question_import_tasks
    (task_id,tenant_id,account_id,idempotency_key,source_type,source_file_name,source_mime_type,source_sha256,source_size_bytes,metadata_json,request_hash,
      processing_location,local_parser_sha256,parser_contract_version,status,phase)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,'desktop',$20,0,'awaiting_source_storage','awaiting_source_storage')
  ON CONFLICT (tenant_id,account_id,idempotency_key) DO NOTHING
  RETURNING task_id,status,phase,request_hash AS "requestHash",created_at AS "createdAt",updated_at AS "updatedAt"
), inserted_storage_task AS (
  INSERT INTO business.storage_object_tasks (task_id,object_id,object_version,expected_sha256,expected_bytes,media_type,state)
  SELECT $12,$13,$14,$8,$9,$7,'queued' FROM inserted_task RETURNING task_id
), inserted_source AS (
  INSERT INTO business.import_source_objects
    (import_task_id,tenant_id,object_id,object_version,storage_task_id,expected_sha256,expected_bytes,mime_type,storage_state)
  SELECT task.task_id,$2,$13,$14,storage.task_id,$8,$9,$7,'queued' FROM inserted_task task CROSS JOIN inserted_storage_task storage RETURNING import_task_id,storage_task_id
), inserted_relay AS (
  INSERT INTO business.encrypted_import_source_relays (storage_task_id,import_task_id,tenant_id,actor_account_id,agent_key_fingerprint,envelope_json,ciphertext,ciphertext_sha256,expires_at)
  SELECT source.storage_task_id,source.import_task_id,$2,$3,$15,$16::jsonb,$17,$18,$19::timestamptz FROM inserted_source source RETURNING storage_task_id
), input_items AS (
  SELECT value AS item FROM jsonb_array_elements($21::jsonb)
), inserted_items AS (
  INSERT INTO business.question_import_items (item_id,import_task_id,item_index,content_hash,candidate_json,validation_json,media_manifest_json,status)
  SELECT item->>'itemId',task.task_id,(item->>'itemIndex')::integer,item->>'contentHash',item->'candidate',item->'validation',item->'mediaManifest',item->'validation'->>'status'
  FROM inserted_task task CROSS JOIN input_items RETURNING import_task_id,item_index
), input_media AS (
  SELECT (item->>'itemIndex')::integer AS item_index,media FROM input_items CROSS JOIN LATERAL jsonb_array_elements(item->'mediaManifest') media
), inserted_media_storage AS (
  INSERT INTO business.storage_object_tasks (task_id,object_id,object_version,expected_sha256,expected_bytes,media_type,state)
  SELECT media->>'storageTaskId',media->>'objectId',(media->>'objectVersion')::integer,media->>'sha256',(media->>'bytes')::bigint,media->>'mimeType','queued'
  FROM inserted_items item JOIN input_media input ON item.item_index=input.item_index RETURNING task_id
), inserted_media AS (
  INSERT INTO business.question_import_media_objects (media_id,import_task_id,item_index,asset_index,object_id,object_version,storage_task_id,expected_sha256,expected_bytes,mime_type,storage_state)
  SELECT media->>'mediaId',$1,item_index,(media->>'assetIndex')::integer,media->>'objectId',(media->>'objectVersion')::integer,media->>'storageTaskId',media->>'sha256',(media->>'bytes')::bigint,media->>'mimeType','queued'
  FROM input_media JOIN inserted_media_storage storage ON storage.task_id=media->>'storageTaskId' RETURNING media_id
) SELECT task_id AS "taskId",status,phase,"requestHash","createdAt","updatedAt" FROM inserted_task CROSS JOIN inserted_relay`;

function createQuestionImportTaskRepository({
  query, storageAgentId = null, runtimeReceiptMaxAgeSeconds = 900,
  randomId = () => crypto.randomUUID(), now = () => new Date(),
} = {}) {
  if (typeof query !== 'function' || typeof randomId !== 'function' || typeof now !== 'function'
    || (storageAgentId !== null && (typeof storageAgentId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(storageAgentId)))
    || !Number.isSafeInteger(runtimeReceiptMaxAgeSeconds) || runtimeReceiptMaxAgeSeconds < 600 || runtimeReceiptMaxAgeSeconds > 3600) {
    throw failure('CLOUD_QUESTION_IMPORT_INPUT_INVALID');
  }
  return Object.freeze({
    async createParsed(input) {
      const request = exact(input, ['tenantId', 'actor', 'idempotencyKey', 'request']);
      const tenantId = text(request.tenantId, 128);
      const currentActor = actor(request.actor);
      const idempotencyKey = text(request.idempotencyKey, 256);
      const body = exact(request.request, ['sourceType', 'sourceFileName', 'sourceMimeType', 'sourceSha256', 'sourceBytes', 'metadata', 'storage', 'relay', 'parsed']);
      const { parsed, ...sourceBody } = body;
      exact(parsed, ['parserSha256', 'candidates']);
      if (typeof parsed.parserSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(parsed.parserSha256)) throw failure('CLOUD_QUESTION_IMPORT_INPUT_INVALID');
      const source = sourceRequest(sourceBody, now());
      if (!Array.isArray(parsed.candidates)) throw failure('CLOUD_QUESTION_IMPORT_INPUT_INVALID');
      const candidates = desktopCandidateRows(parsed.candidates.map(item => ({ ...item,
        candidate: applyImportLabels(item.candidate, source.metadata, source.sourceType) })), randomId);
      const hash = requestHash({ ...sourceBody, relay: { agentKeyFingerprint: source.relay.agentKeyFingerprint,
        envelope: source.relay.envelope, expiresAt: source.relay.expiresAt }, parsed: { parserSha256: parsed.parserSha256,
        candidates: candidates.map(item => ({ candidate: item.candidate, validation: item.validation,
          mediaManifest: item.mediaManifest.map(asset => ({ sha256: asset.sha256, bytes: asset.bytes, mimeType: asset.mimeType })) })) } });
      async function replay() {
        const existing = await query(existingSql, [tenantId, currentActor.accountId, idempotencyKey]);
        if (!existing || !Array.isArray(existing.rows) || existing.rows.length > 1) throw failure('CLOUD_QUESTION_IMPORT_UNAVAILABLE');
        if (!existing.rows.length) return null;
        if (existing.rows[0].requestHash !== hash) throw failure('CLOUD_QUESTION_IMPORT_CONFLICT');
        const targets = await query(mediaTargetsSql, [existing.rows[0].taskId]);
        return { ...taskRow(existing.rows[0], true), mediaTargets: targets.rows };
      }
      const prior = await replay();
      if (prior) return prior;
      const taskId = 'question_import_task_' + String(randomId()).replace(/[^A-Za-z0-9_-]/g, '');
      const result = await query(insertParsedSql, [taskId, tenantId, currentActor.accountId, idempotencyKey, source.sourceType, source.sourceFileName,
        source.sourceMimeType, source.sourceSha256, source.sourceBytes, stableJson(source.metadata), hash,
        source.storage.taskId, source.storage.objectId, source.storage.objectVersion, source.relay.agentKeyFingerprint,
        stableJson(source.relay.envelope), source.relay.ciphertext, source.relay.envelope.ciphertextSha256, source.relay.expiresAt,
        parsed.parserSha256, stableJson(candidates)]);
      if (!result || !Array.isArray(result.rows)) throw failure('CLOUD_QUESTION_IMPORT_UNAVAILABLE');
      if (!result.rows.length) {
        const concurrent = await replay();
        if (concurrent) return concurrent;
        throw failure('CLOUD_QUESTION_IMPORT_UNAVAILABLE');
      }
      const targets = await query(mediaTargetsSql, [taskId]);
      return { ...taskRow(result.rows[0]), mediaTargets: targets.rows };
    },
    async stageMediaRelay(input) {
      const request = exact(input, ['tenantId', 'actor', 'taskId', 'mediaId', 'relay']);
      const tenantId = text(request.tenantId, 128);
      const currentActor = actor(request.actor);
      const taskId = text(request.taskId, 160);
      const mediaId = text(request.mediaId, 160);
      if (!/^question_import_task_[A-Za-z0-9_-]{1,128}$/.test(taskId) || !/^question_import_media_[A-Za-z0-9_-]{1,128}$/.test(mediaId)) throw failure('CLOUD_QUESTION_IMPORT_INPUT_INVALID');
      const target = await query(`SELECT media.storage_task_id AS "storageTaskId",media.expected_sha256 AS sha256,media.expected_bytes::float8 AS bytes,media.storage_state AS state
        FROM business.question_import_media_objects media JOIN business.question_import_tasks task ON task.task_id=media.import_task_id
        WHERE task.task_id=$1 AND task.tenant_id=$2 AND task.account_id=$3 AND task.processing_location='desktop' AND media.media_id=$4`,
      [taskId, tenantId, currentActor.accountId, mediaId]);
      if (!target || !Array.isArray(target.rows) || target.rows.length !== 1) throw failure('CLOUD_QUESTION_IMPORT_NOT_FOUND');
      const allocated = target.rows[0];
      // Reuse the complete encrypted-envelope validation with the allocated plaintext identity.
      const validated = sourceRequest({ sourceType: 'exam', sourceFileName: 'media.docx', sourceMimeType: 'application/msword',
        sourceSha256: allocated.sha256, sourceBytes: allocated.bytes, metadata: {},
        storage: { taskId: allocated.storageTaskId, objectId: 'obj_media_validation', objectVersion: 1 }, relay: request.relay }, now()).relay;
      if (allocated.state === 'verified') return { mediaId, storageTaskId: allocated.storageTaskId, state: 'verified', replayed: true };
      if (allocated.state !== 'queued') throw failure('CLOUD_QUESTION_IMPORT_CONFLICT');
      const result = await query(`WITH locked_storage AS (
        SELECT task_id,state FROM business.storage_object_tasks WHERE task_id=$1 FOR UPDATE
      ) INSERT INTO business.encrypted_import_media_relays
        (storage_task_id,media_id,import_task_id,tenant_id,actor_account_id,agent_key_fingerprint,envelope_json,ciphertext,ciphertext_sha256,expires_at)
        SELECT $1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10::timestamptz FROM locked_storage WHERE state='queued'
        ON CONFLICT (storage_task_id) DO UPDATE SET envelope_json=EXCLUDED.envelope_json,ciphertext=EXCLUDED.ciphertext,
          ciphertext_sha256=EXCLUDED.ciphertext_sha256,expires_at=EXCLUDED.expires_at
        WHERE encrypted_import_media_relays.agent_key_fingerprint=EXCLUDED.agent_key_fingerprint
          AND encrypted_import_media_relays.tenant_id=EXCLUDED.tenant_id AND encrypted_import_media_relays.actor_account_id=EXCLUDED.actor_account_id
        RETURNING storage_task_id,(xmax<>0) AS replayed`,
      [allocated.storageTaskId, mediaId, taskId, tenantId, currentActor.accountId, validated.agentKeyFingerprint,
        stableJson(validated.envelope), validated.ciphertext, validated.envelope.ciphertextSha256, validated.expiresAt]);
      if (result.rows.length) return { mediaId, storageTaskId: allocated.storageTaskId, state: 'queued', replayed: result.rows[0].replayed === true };
      const existing = await query(`SELECT agent_key_fingerprint AS fingerprint,envelope_json AS envelope,ciphertext_sha256 AS sha256,expires_at AS "expiresAt"
        FROM business.encrypted_import_media_relays WHERE storage_task_id=$1 AND tenant_id=$2 AND actor_account_id=$3`, [allocated.storageTaskId, tenantId, currentActor.accountId]);
      const row = existing.rows[0];
      if (!row || row.fingerprint !== validated.agentKeyFingerprint || stableJson(row.envelope) !== stableJson(validated.envelope)
        || row.sha256 !== validated.envelope.ciphertextSha256 || row.expiresAt.toISOString() !== validated.expiresAt) throw failure('CLOUD_QUESTION_IMPORT_CONFLICT');
      return { mediaId, storageTaskId: allocated.storageTaskId, state: 'queued', replayed: true };
    },
    async create(input) {
      const request = exact(input, ['tenantId', 'actor', 'idempotencyKey', 'request']);
      const tenantId = text(request.tenantId, 128);
      const currentActor = actor(request.actor);
      const idempotencyKey = text(request.idempotencyKey, 256);
      const source = sourceRequest(request.request, now());
      const hash = requestHash({
        sourceType: source.sourceType, sourceFileName: source.sourceFileName, sourceMimeType: source.sourceMimeType,
        sourceSha256: source.sourceSha256, sourceBytes: source.sourceBytes, metadata: source.metadata, storage: source.storage,
        relay: { agentKeyFingerprint: source.relay.agentKeyFingerprint, envelope: source.relay.envelope, expiresAt: source.relay.expiresAt },
      });
      const existing = await query(existingSql, [tenantId, currentActor.accountId, idempotencyKey]);
      if (!existing || !Array.isArray(existing.rows) || existing.rows.length > 1) throw failure('CLOUD_QUESTION_IMPORT_UNAVAILABLE');
      if (existing.rows.length === 1) {
        const row = existing.rows[0];
        if (row.requestHash !== hash) throw failure('CLOUD_QUESTION_IMPORT_CONFLICT');
        return taskRow(row, true);
      }
      if (storageAgentId === null) throw failure('CLOUD_QUESTION_IMPORT_PARSER_UNAVAILABLE');
      const taskId = 'question_import_task_' + String(randomId()).replace(/[^A-Za-z0-9_-]/g, '');
      if (!/^question_import_task_[A-Za-z0-9_-]{1,128}$/.test(taskId)) throw failure('CLOUD_QUESTION_IMPORT_UNAVAILABLE');
      const result = await query(insertSql, [
        taskId, tenantId, currentActor.accountId, idempotencyKey, source.sourceType, source.sourceFileName,
        source.sourceMimeType, source.sourceSha256, source.sourceBytes, stableJson(source.metadata), hash,
        source.storage.taskId, source.storage.objectId, source.storage.objectVersion,
        source.relay.agentKeyFingerprint, stableJson(source.relay.envelope), source.relay.ciphertext,
        source.relay.envelope.ciphertextSha256, source.relay.expiresAt, storageAgentId, runtimeReceiptMaxAgeSeconds,
      ]);
      if (!result || !Array.isArray(result.rows)) throw failure('CLOUD_QUESTION_IMPORT_UNAVAILABLE');
      if (result.rows.length !== 1) throw failure('CLOUD_QUESTION_IMPORT_PARSER_UNAVAILABLE');
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
    async read(input) {
      const request = exact(input, ['tenantId', 'actor', 'taskId']);
      const tenantId = text(request.tenantId, 128);
      const currentActor = actor(request.actor);
      const taskId = text(request.taskId, 160);
      if (!/^question_import_task_[A-Za-z0-9_-]{1,128}$/.test(taskId)) throw failure('CLOUD_QUESTION_IMPORT_INPUT_INVALID');
      const result = await query(readSql, [tenantId, currentActor.accountId, taskId]);
      if (!result || !Array.isArray(result.rows)) throw failure('CLOUD_QUESTION_IMPORT_UNAVAILABLE');
      if (result.rows.length !== 1) throw failure('CLOUD_QUESTION_IMPORT_NOT_FOUND');
      return readTaskRow(result.rows[0]);
    },
    async list(input) {
      const request = exact(input, ['tenantId', 'actor', 'limit']);
      const tenantId = text(request.tenantId, 128), currentActor = actor(request.actor);
      if (!Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > 100) throw failure('CLOUD_QUESTION_IMPORT_INPUT_INVALID');
      const result = await query(`SELECT task.task_id AS "taskId",task.status,task.phase,task.request_hash AS "requestHash",
        task.created_at AS "createdAt",task.updated_at AS "updatedAt",task.source_file_name AS "sourceFileName",
        task.source_type AS "sourceType",task.metadata_json AS metadata,task.processing_location AS "processingLocation",
        count(item.item_id)::integer AS "totalItems",
        count(item.item_id) FILTER (WHERE item.status='submitted')::integer AS "submittedItems",
        count(item.item_id) FILTER (WHERE item.validation_json->>'status'='warning')::integer AS "warningItems",
        count(item.item_id) FILTER (WHERE item.status='rejected')::integer AS "failedItems"
        FROM business.question_import_tasks task LEFT JOIN business.question_import_items item ON item.import_task_id=task.task_id
        WHERE task.tenant_id=$1 AND task.account_id=$2 AND task.status<>'cancelled' GROUP BY task.task_id
        ORDER BY task.created_at DESC,task.task_id DESC LIMIT $3`, [tenantId, currentActor.accountId, request.limit]);
      if (!Array.isArray(result?.rows)) throw failure('CLOUD_QUESTION_IMPORT_UNAVAILABLE');
      return result.rows.map(row => ({ ...taskRow(row), sourceFileName: row.sourceFileName, sourceType: row.sourceType,
        metadata: row.metadata, processingLocation: row.processingLocation, totalItems: row.totalItems,
        submittedItems: row.submittedItems, warningItems: row.warningItems, failedItems: row.failedItems }));
    },
    async completeSourceAndStoreCandidates(input) {
      const request = plainObject(input) && Object.hasOwn(input, 'parserSha256')
        ? exact(input, ['taskId', 'agentId', 'leaseToken', 'observedSha256', 'observedBytes', 'parserSha256', 'candidates'])
        : exact(input, ['taskId', 'agentId', 'leaseToken', 'observedSha256', 'observedBytes', 'candidates']);
      const taskId = text(request.taskId, 160);
      const currentAgentId = text(request.agentId, 64);
      const parserSha256 = Object.hasOwn(request, 'parserSha256') ? request.parserSha256 : null;
      if (!/^question_import_task_[A-Za-z0-9_-]{1,128}$/.test(taskId) || !/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(currentAgentId)
        || typeof request.leaseToken !== 'string' || request.leaseToken.length < 16 || !/^[0-9a-f]{64}$/.test(request.observedSha256)
        || !Number.isSafeInteger(request.observedBytes) || request.observedBytes < 1
        || (parserSha256 !== null && (typeof parserSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(parserSha256)))) {
        throw failure('CLOUD_QUESTION_IMPORT_INPUT_INVALID');
      }
      const receiptId = 'storage_receipt_' + String(randomId()).replace(/[^A-Za-z0-9_-]/g, '');
      if (!/^storage_receipt_[A-Za-z0-9_-]{1,128}$/.test(receiptId)) throw failure('CLOUD_QUESTION_IMPORT_UNAVAILABLE');
      const candidates = candidateRows(request.candidates, randomId);
      const leaseHash = crypto.createHash('sha256').update(request.leaseToken, 'utf8').digest('hex');
      const result = await query(completeSourceAndStoreCandidatesSql, [
        taskId, currentAgentId, leaseHash, request.observedSha256, request.observedBytes, receiptId, stableJson(candidates), parserSha256,
      ]);
      if (!result || !Array.isArray(result.rows) || result.rows.length !== 1) throw failure('CLOUD_QUESTION_IMPORT_SOURCE_UNVERIFIED');
      const task = taskRow(result.rows[0], false);
      if (!Array.isArray(result.rows[0].mediaTargets)) throw failure('CLOUD_QUESTION_IMPORT_UNAVAILABLE');
      return { ...task, mediaTargets: result.rows[0].mediaTargets };
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
