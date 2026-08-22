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
    || !(row.leaseExpiresAt instanceof Date)) throw failure('STORAGE_TASK_REPOSITORY_INVALID');
  const value = {
    taskId: row.taskId,
    objectId: row.objectId,
    objectVersion: Number(row.objectVersion),
    expectedSha256: row.expectedSha256,
    expectedBytes: Number(row.expectedBytes),
    mediaType: row.mediaType,
    leaseExpiresAt: row.leaseExpiresAt.toISOString(),
  };
  return leaseToken === null ? value : { ...value, leaseToken };
}

function createStorageTaskRepository({ query, randomToken = () => crypto.randomBytes(32).toString('base64url'), randomId = () => crypto.randomUUID(), now = () => new Date(), leaseSeconds = 300 } = {}) {
  if (typeof query !== 'function' || typeof randomToken !== 'function' || typeof randomId !== 'function' || typeof now !== 'function'
    || !Number.isSafeInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 3600) throw failure('STORAGE_TASK_INPUT_INVALID');
  return Object.freeze({
    async leaseNext(input) {
      const request = exact(input, ['agentId']);
      const currentAgentId = agentId(request.agentId);
      const leaseToken = String(randomToken());
      if (leaseToken.length < 16) throw failure('STORAGE_TASK_REPOSITORY_INVALID');
      const currentTime = now();
      if (!(currentTime instanceof Date) || !Number.isFinite(currentTime.getTime())) throw failure('STORAGE_TASK_REPOSITORY_INVALID');
      const leaseExpiresAt = new Date(currentTime.getTime() + (leaseSeconds * 1000));
      const result = await query(
        `WITH candidate AS (
           SELECT task_id FROM business.storage_object_tasks
            WHERE state='queued' OR (state='leased' AND lease_expires_at <= transaction_timestamp())
            ORDER BY created_at ASC,task_id ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 1
         ), leased AS (
           UPDATE business.storage_object_tasks task
              SET state='leased',lease_agent_id=$1,lease_token_sha256=$2,lease_expires_at=$3::timestamptz,attempts=attempts+1,updated_at=transaction_timestamp()
             FROM candidate
            WHERE task.task_id=candidate.task_id
           RETURNING task.task_id AS "taskId",task.object_id AS "objectId",task.object_version AS "objectVersion",task.expected_sha256 AS "expectedSha256",task.expected_bytes AS "expectedBytes",task.media_type AS "mediaType",task.lease_expires_at AS "leaseExpiresAt"
         ) SELECT * FROM leased`,
        [currentAgentId, hash(leaseToken), leaseExpiresAt.toISOString()],
      );
      if (!result || !Array.isArray(result.rows) || result.rows.length === 0) return null;
      if (result.rows.length !== 1) throw failure('STORAGE_TASK_REPOSITORY_INVALID');
      return outputRow(result.rows[0], leaseToken);
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
           RETURNING task.task_id
         ), receipt AS (
           INSERT INTO business.storage_task_receipts (receipt_id,task_id,agent_id,observed_sha256,observed_bytes)
           SELECT $6,task_id,$2,$4,$5 FROM completed
           RETURNING task_id AS "taskId",verified_at AS "verifiedAt"
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
