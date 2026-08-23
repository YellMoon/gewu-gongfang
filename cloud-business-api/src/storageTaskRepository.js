'use strict';

const crypto = require('crypto');
const { types } = require('util');

function failure(code) {
  return Object.assign(new Error(code), { code });
}

function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) throw failure('STORAGE_TASK_INPUT_INVALID');
  if (Reflect.ownKeys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw failure('STORAGE_TASK_INPUT_INVALID');
  return value;
}

function agentId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(value)) throw failure('STORAGE_TASK_INPUT_INVALID');
  return value;
}

function taskId(value) {
  if (typeof value !== 'string' || !/^task_[A-Za-z0-9_-]{8,128}$/.test(value)) throw failure('STORAGE_TASK_INPUT_INVALID');
  return value;
}

function hash(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function outputRow(row, leaseToken = null) {
  if (!row || typeof row.taskId !== 'string' || typeof row.objectId !== 'string' || !Number.isSafeInteger(Number(row.objectVersion))
    || typeof row.expectedSha256 !== 'string' || !/^\d+$/.test(String(row.expectedBytes)) || typeof row.mediaType !== 'string'
    || !(row.leaseExpiresAt instanceof Date)
    || !['relay', 'question_import_source', 'question_import_media'].includes(row.kind)) throw failure('STORAGE_TASK_REPOSITORY_INVALID');
  const value = {
    taskId: row.taskId,
    objectId: row.objectId,
    objectVersion: Number(row.objectVersion),
    expectedSha256: row.expectedSha256,
    expectedBytes: Number(row.expectedBytes),
    mediaType: row.mediaType,
    kind: row.kind,
    leaseExpiresAt: row.leaseExpiresAt.toISOString(),
  };
  if (row.kind === 'question_import_source') {
    if (typeof row.importTaskId !== 'string' || !/^question_import_task_[A-Za-z0-9_-]{1,128}$/.test(row.importTaskId)
      || !['lecture', 'exam'].includes(row.sourceType) || typeof row.sourceFileName !== 'string' || !/\.(?:doc|docx)$/iu.test(row.sourceFileName)) throw failure('STORAGE_TASK_REPOSITORY_INVALID');
    value.importTaskId = row.importTaskId;
    value.sourceType = row.sourceType;
    value.sourceFileName = row.sourceFileName;
  }
  if (row.kind === 'question_import_media') {
    if (!Number.isSafeInteger(Number(row.itemIndex)) || Number(row.itemIndex) < 0 || !Number.isSafeInteger(Number(row.assetIndex)) || Number(row.assetIndex) < 0
      || !row.source || typeof row.source !== 'object' || Array.isArray(row.source)) throw failure('STORAGE_TASK_REPOSITORY_INVALID');
    const source = row.source;
    if (typeof source.objectId !== 'string' || !/^obj_[A-Za-z0-9_-]{1,128}$/.test(source.objectId)
      || !Number.isSafeInteger(Number(source.objectVersion)) || Number(source.objectVersion) < 1
      || typeof source.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(source.sha256)
      || !Number.isSafeInteger(Number(source.bytes)) || Number(source.bytes) < 1
      || typeof source.mimeType !== 'string' || !source.mimeType
      || !['lecture', 'exam'].includes(source.sourceType) || typeof source.sourceFileName !== 'string' || !/\.(?:doc|docx)$/iu.test(source.sourceFileName)) throw failure('STORAGE_TASK_REPOSITORY_INVALID');
    value.itemIndex = Number(row.itemIndex);
    value.assetIndex = Number(row.assetIndex);
    value.source = {
      objectId: source.objectId, objectVersion: Number(source.objectVersion), sha256: source.sha256,
      bytes: Number(source.bytes), mimeType: source.mimeType, sourceType: source.sourceType, sourceFileName: source.sourceFileName,
    };
  }
  return leaseToken === null ? value : { ...value, leaseToken };
}

function createStorageTaskRepository({ query, randomToken = () => crypto.randomBytes(32).toString('base64url'), randomId = () => crypto.randomUUID(), now = () => new Date(), leaseSeconds = 300 } = {}) {
  if (typeof query !== 'function' || typeof randomToken !== 'function' || typeof randomId !== 'function' || typeof now !== 'function'
    || !Number.isSafeInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 3600) throw failure('STORAGE_TASK_INPUT_INVALID');
  async function cleanupExpired() {
    const result = await query(
      `WITH deleted_question_relays AS (
         DELETE FROM business.encrypted_storage_relays
          WHERE expires_at <= transaction_timestamp()
          RETURNING task_id
       ), deleted_artifact_relays AS (
         DELETE FROM business.encrypted_paper_export_artifact_relays
          WHERE expires_at <= transaction_timestamp()
          RETURNING storage_task_id AS task_id
       ), deleted_import_source_relays AS (
         DELETE FROM business.encrypted_import_source_relays
          WHERE expires_at <= transaction_timestamp()
          RETURNING storage_task_id AS task_id
       ), deleted_expired AS (
         SELECT task_id FROM deleted_question_relays
         UNION ALL SELECT task_id FROM deleted_artifact_relays
         UNION ALL SELECT task_id FROM deleted_import_source_relays
       ), quarantined AS (
         UPDATE business.storage_object_tasks task
            SET state='quarantined',last_error_code='ENCRYPTED_RELAY_EXPIRED',updated_at=transaction_timestamp()
           FROM deleted_expired expired
          WHERE task.task_id=expired.task_id AND task.state<>'verified'
          RETURNING task.task_id
       ) SELECT count(*)::integer AS count FROM deleted_expired`,
      [],
    );
    if (!result || !Array.isArray(result.rows) || result.rows.length !== 1 || !Number.isSafeInteger(Number(result.rows[0].count)) || Number(result.rows[0].count) < 0) {
      throw failure('STORAGE_TASK_REPOSITORY_INVALID');
    }
    return Number(result.rows[0].count);
  }
  return Object.freeze({
    cleanupExpired,
    async leaseNext(input) {
      await cleanupExpired();
      const request = exact(input, ['agentId']);
      const currentAgentId = agentId(request.agentId);
      const leaseToken = String(randomToken());
      if (leaseToken.length < 16) throw failure('STORAGE_TASK_REPOSITORY_INVALID');
      const currentTime = now();
      if (!(currentTime instanceof Date) || !Number.isFinite(currentTime.getTime())) throw failure('STORAGE_TASK_REPOSITORY_INVALID');
      const leaseExpiresAt = new Date(currentTime.getTime() + (leaseSeconds * 1000));
      const result = await query(
        `WITH candidate AS (
           SELECT task.task_id
             FROM business.storage_object_tasks task
             LEFT JOIN business.encrypted_storage_relays question_relay ON question_relay.task_id=task.task_id
             LEFT JOIN business.encrypted_paper_export_artifact_relays artifact_relay ON artifact_relay.storage_task_id=task.task_id
             LEFT JOIN business.encrypted_import_source_relays import_relay ON import_relay.storage_task_id=task.task_id
             LEFT JOIN business.import_source_objects import_source ON import_source.storage_task_id=task.task_id
             LEFT JOIN business.question_import_tasks source_import_task ON source_import_task.task_id=import_source.import_task_id
             LEFT JOIN business.question_import_media_objects import_media ON import_media.storage_task_id=task.task_id AND import_media.storage_state='queued'
             LEFT JOIN business.import_source_objects media_source ON media_source.import_task_id=import_media.import_task_id AND media_source.storage_state='verified'
             LEFT JOIN business.question_import_tasks media_import_task ON media_import_task.task_id=import_media.import_task_id
            WHERE (task.state='queued' OR (task.state='leased' AND task.lease_expires_at <= transaction_timestamp()))
              AND ((question_relay.expires_at > transaction_timestamp()) OR (artifact_relay.expires_at > transaction_timestamp()) OR (import_relay.expires_at > transaction_timestamp())
                OR (import_media.media_id IS NOT NULL AND media_source.import_task_id IS NOT NULL))
            ORDER BY task.created_at ASC,task.task_id ASC
            FOR UPDATE OF task SKIP LOCKED
            LIMIT 1
         ), leased AS (
           UPDATE business.storage_object_tasks task
              SET state='leased',lease_agent_id=$1,lease_token_sha256=$2,lease_expires_at=$3::timestamptz,attempts=attempts+1,updated_at=transaction_timestamp()
             FROM candidate
            WHERE task.task_id=candidate.task_id
           RETURNING task.task_id AS "taskId",task.object_id AS "objectId",task.object_version AS "objectVersion",task.expected_sha256 AS "expectedSha256",task.expected_bytes AS "expectedBytes",task.media_type AS "mediaType",task.lease_expires_at AS "leaseExpiresAt"
         ) SELECT leased.*,
             CASE WHEN import_media.media_id IS NOT NULL THEN 'question_import_media'
                  WHEN import_source.import_task_id IS NOT NULL THEN 'question_import_source'
                  ELSE 'relay' END AS kind,
             source_import_task.task_id AS "importTaskId",source_import_task.source_type AS "sourceType",source_import_task.source_file_name AS "sourceFileName",
             import_media.item_index AS "itemIndex",import_media.asset_index AS "assetIndex",
             CASE WHEN import_media.media_id IS NOT NULL THEN jsonb_build_object(
               'objectId',media_source.object_id,'objectVersion',media_source.object_version,'sha256',media_source.expected_sha256,
               'bytes',media_source.expected_bytes,'mimeType',media_source.mime_type,'sourceType',media_import_task.source_type,'sourceFileName',media_import_task.source_file_name
             ) ELSE NULL END AS source
           FROM leased
           LEFT JOIN business.import_source_objects import_source ON import_source.storage_task_id=leased."taskId"
           LEFT JOIN business.question_import_tasks source_import_task ON source_import_task.task_id=import_source.import_task_id
           LEFT JOIN business.question_import_media_objects import_media ON import_media.storage_task_id=leased."taskId"
           LEFT JOIN business.import_source_objects media_source ON media_source.import_task_id=import_media.import_task_id AND media_source.storage_state='verified'
           LEFT JOIN business.question_import_tasks media_import_task ON media_import_task.task_id=import_media.import_task_id`,
        [currentAgentId, hash(leaseToken), leaseExpiresAt.toISOString()],
      );
      if (!result || !Array.isArray(result.rows) || result.rows.length === 0) return null;
      if (result.rows.length !== 1) throw failure('STORAGE_TASK_REPOSITORY_INVALID');
      return outputRow(result.rows[0], leaseToken);
    },
    async downloadRelay(input) {
      const request = exact(input, ['agentId', 'taskId', 'leaseToken']);
      const currentAgentId = agentId(request.agentId);
      const currentTaskId = taskId(request.taskId);
      if (typeof request.leaseToken !== 'string' || request.leaseToken.length < 16) throw failure('STORAGE_TASK_INPUT_INVALID');
      const result = await query(
        `WITH relay AS (
           SELECT envelope_json,ciphertext,expires_at FROM business.encrypted_storage_relays WHERE task_id=$1
           UNION ALL
           SELECT envelope_json,ciphertext,expires_at FROM business.encrypted_paper_export_artifact_relays WHERE storage_task_id=$1
           UNION ALL
           SELECT envelope_json,ciphertext,expires_at FROM business.encrypted_import_source_relays WHERE storage_task_id=$1
         ) SELECT relay.envelope_json AS envelope,relay.ciphertext AS ciphertext
           FROM business.storage_object_tasks task JOIN relay ON true
          WHERE task.task_id=$1 AND task.state='leased' AND task.lease_agent_id=$2 AND task.lease_token_sha256=$3
            AND task.lease_expires_at > transaction_timestamp() AND relay.expires_at > transaction_timestamp()`,
        [currentTaskId, currentAgentId, hash(request.leaseToken)],
      );
      if (!result || !Array.isArray(result.rows) || result.rows.length !== 1) throw failure('STORAGE_TASK_RELAY_UNAVAILABLE');
      const row = result.rows[0];
      if (!row || typeof row !== 'object' || Array.isArray(row) || types.isProxy(row)
        || !row.envelope || typeof row.envelope !== 'object' || Array.isArray(row.envelope)
        || !Buffer.isBuffer(row.ciphertext) || row.ciphertext.length < 1 || row.ciphertext.length > (64 * 1024 * 1024)) {
        throw failure('STORAGE_TASK_RELAY_UNAVAILABLE');
      }
      return { envelope: row.envelope, ciphertext: Buffer.from(row.ciphertext) };
    },
    async complete(input) {
      const request = exact(input, ['agentId', 'taskId', 'leaseToken', 'observedSha256', 'observedBytes']);
      const currentAgentId = agentId(request.agentId);
      const currentTaskId = taskId(request.taskId);
      if (typeof request.leaseToken !== 'string' || request.leaseToken.length < 16 || !/^[0-9a-f]{64}$/.test(request.observedSha256)
        || !Number.isSafeInteger(request.observedBytes) || request.observedBytes < 0) throw failure('STORAGE_TASK_INPUT_INVALID');
      const receiptId = `storage_receipt_${String(randomId()).replace(/[^A-Za-z0-9_-]/g, '')}`;
      const result = await query(
        `WITH completed AS (
           UPDATE business.storage_object_tasks task
              SET state='verified',updated_at=transaction_timestamp()
            WHERE task.task_id=$1 AND task.state='leased' AND task.lease_agent_id=$2 AND task.lease_token_sha256=$3
              AND task.lease_expires_at > transaction_timestamp() AND task.expected_sha256=$4 AND task.expected_bytes=$5
           RETURNING task.task_id,task.object_id,task.object_version
         ), receipt AS (
           INSERT INTO business.storage_task_receipts (receipt_id,task_id,agent_id,observed_sha256,observed_bytes)
           SELECT $6,task_id,$2,$4,$5 FROM completed
           RETURNING task_id AS "taskId",verified_at AS "verifiedAt"
         ), verified_artifact AS (
           UPDATE business.paper_export_artifacts artifact
              SET storage_state='verified',verified_at=transaction_timestamp()
             FROM completed WHERE artifact.storage_task_id=completed.task_id AND artifact.storage_state='queued'
           RETURNING artifact.artifact_id
         ), completed_paper_task AS (
           UPDATE business.paper_export_tasks paper
              SET status='completed',phase='completed',progress=100,updated_at=transaction_timestamp()
             FROM verified_artifact artifact
            WHERE paper.result_artifact_id=artifact.artifact_id AND paper.status='processing'
         ), verified_import_source AS (
           UPDATE business.import_source_objects source
              SET storage_state='verified',verified_at=transaction_timestamp(),updated_at=transaction_timestamp()
             FROM completed
           WHERE source.storage_task_id=completed.task_id AND source.storage_state='queued'
           RETURNING source.import_task_id
         ), verified_import_media AS (
           UPDATE business.question_import_media_objects media
              SET storage_state='verified',verified_at=transaction_timestamp(),updated_at=transaction_timestamp()
             FROM completed
            WHERE media.storage_task_id=completed.task_id AND media.storage_state='queued'
           RETURNING media.media_id
         ), verified_question_asset AS (
           UPDATE business.question_assets asset
              SET state='verified',updated_at=transaction_timestamp()
             FROM completed
            WHERE asset.storage_object_id=completed.object_id AND asset.storage_object_version=completed.object_version
              AND asset.state='queued' AND asset.deleted=false
           RETURNING asset.id
         ), queued_import_task AS (
           UPDATE business.question_import_tasks import_task
              SET status='queued_for_parse',phase='queued_for_parse',updated_at=transaction_timestamp()
             FROM verified_import_source source
            WHERE import_task.task_id=source.import_task_id AND import_task.status='awaiting_source_storage'
           RETURNING import_task.task_id
         ), deleted_question_relay AS (
           DELETE FROM business.encrypted_storage_relays relay
            USING completed
            WHERE relay.task_id=completed.task_id
         ), deleted_artifact_relay AS (
           DELETE FROM business.encrypted_paper_export_artifact_relays relay
            USING completed
            WHERE relay.storage_task_id=completed.task_id
         ), deleted_import_source_relay AS (
           DELETE FROM business.encrypted_import_source_relays relay
            USING completed
            WHERE relay.storage_task_id=completed.task_id
         ) SELECT "taskId",'verified'::text AS state,"verifiedAt" FROM receipt`,
        [currentTaskId, currentAgentId, hash(request.leaseToken), request.observedSha256, request.observedBytes, receiptId],
      );
      if (!result || !Array.isArray(result.rows) || result.rows.length !== 1 || typeof result.rows[0].taskId !== 'string' || !(result.rows[0].verifiedAt instanceof Date)) {
        throw failure('STORAGE_TASK_RECEIPT_MISMATCH');
      }
      return { taskId: result.rows[0].taskId, state: 'verified', verifiedAt: result.rows[0].verifiedAt.toISOString() };
    },
  });
}

module.exports = Object.freeze({ createStorageTaskRepository });
