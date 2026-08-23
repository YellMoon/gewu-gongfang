'use strict';

const crypto = require('crypto');

function failure(code) {
  return Object.assign(new Error(code), { code });
}

function text(value, pattern, code = 'MINIAPP_ARTIFACT_DELIVERY_INPUT_INVALID') {
  if (typeof value !== 'string' || !pattern.test(value)) throw failure(code);
  return value;
}

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function output(row, { leaseToken = null, bytes = false } = {}) {
  if (!row || typeof row.deliveryId !== 'string' || !/^delivery_[A-Za-z0-9_-]{8,128}$/.test(row.deliveryId)
    || typeof row.status !== 'string' || typeof row.fileName !== 'string' || !row.fileName || row.fileName.length > 512
    || typeof row.mimeType !== 'string' || !row.mimeType || !(row.expiresAt instanceof Date)) {
    throw failure('MINIAPP_ARTIFACT_DELIVERY_UNAVAILABLE');
  }
  const value = { deliveryId: row.deliveryId, status: row.status, fileName: row.fileName, mimeType: row.mimeType, expiresAt: row.expiresAt.toISOString() };
  if (typeof row.artifactId === 'string' && /^paper_artifact_[A-Za-z0-9_-]{8,128}$/.test(row.artifactId)) value.artifactId = row.artifactId;
  if (leaseToken !== null) {
    if (typeof row.objectId !== 'string' || !/^obj_[A-Za-z0-9_-]{1,128}$/.test(row.objectId)
      || !Number.isSafeInteger(Number(row.objectVersion)) || Number(row.objectVersion) < 1
      || typeof row.expectedSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(row.expectedSha256)
      || !Number.isSafeInteger(Number(row.expectedBytes)) || Number(row.expectedBytes) < 1
      || !(row.leaseExpiresAt instanceof Date)) throw failure('MINIAPP_ARTIFACT_DELIVERY_UNAVAILABLE');
    value.objectId = row.objectId;
    value.objectVersion = Number(row.objectVersion);
    value.expectedSha256 = row.expectedSha256;
    value.expectedBytes = Number(row.expectedBytes);
    value.leaseExpiresAt = row.leaseExpiresAt.toISOString();
    value.leaseToken = leaseToken;
  }
  if (bytes) {
    if (!Buffer.isBuffer(row.bytes) || row.bytes.length < 1 || row.bytes.length > (64 * 1024 * 1024)) throw failure('MINIAPP_ARTIFACT_DELIVERY_UNAVAILABLE');
    return { deliveryId: value.deliveryId, fileName: value.fileName, mimeType: value.mimeType, bytes: Buffer.from(row.bytes) };
  }
  return value;
}

function createMiniappArtifactDeliveryRepository({ query, randomId = () => crypto.randomUUID(), randomToken = () => crypto.randomBytes(32).toString('base64url'), now = () => new Date(), ttlSeconds = 900, leaseSeconds = 300 } = {}) {
  if (typeof query !== 'function' || typeof randomId !== 'function' || typeof randomToken !== 'function' || typeof now !== 'function'
    || !Number.isSafeInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 3600
    || !Number.isSafeInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > ttlSeconds) throw failure('MINIAPP_ARTIFACT_DELIVERY_INPUT_INVALID');
  const tenant = value => text(value, /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
  const account = value => text(value, /^.{1,512}$/);
  const paperTask = value => text(value, /^paper_task_[A-Za-z0-9_-]{8,128}$/);
  const delivery = value => text(value, /^delivery_[A-Za-z0-9_-]{8,128}$/);
  const agent = value => text(value, /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/);
  function future(seconds) {
    const current = now();
    if (!(current instanceof Date) || !Number.isFinite(current.getTime())) throw failure('MINIAPP_ARTIFACT_DELIVERY_UNAVAILABLE');
    return new Date(current.getTime() + (seconds * 1000));
  }
  return Object.freeze({
    async request(input) {
      if (!input || typeof input !== 'object' || Array.isArray(input) || Reflect.ownKeys(input).length !== 3) throw failure('MINIAPP_ARTIFACT_DELIVERY_INPUT_INVALID');
      const expiresAt = future(ttlSeconds);
      const deliveryId = `delivery_${String(randomId()).replace(/[^A-Za-z0-9_-]/g, '')}`;
      if (!/^delivery_[A-Za-z0-9_-]{8,128}$/.test(deliveryId)) throw failure('MINIAPP_ARTIFACT_DELIVERY_UNAVAILABLE');
      const result = await query([
        'WITH purged AS (DELETE FROM business.miniapp_artifact_deliveries WHERE expires_at<=transaction_timestamp()),',
        'artifact AS (SELECT artifact.artifact_id AS "artifactId",artifact.object_id AS "objectId",artifact.content_sha256 AS "expectedSha256",artifact.size_bytes AS "expectedBytes",artifact.file_name AS "fileName",artifact.mime_type AS "mimeType" FROM business.paper_export_tasks task JOIN business.paper_export_artifacts artifact ON artifact.paper_task_id=task.task_id AND artifact.tenant_id=task.tenant_id WHERE task.tenant_id=$1 AND task.account_id=$2 AND task.task_id=$3 AND task.status=\'completed\' AND artifact.storage_state=\'verified\' ORDER BY artifact.verified_at DESC NULLS LAST,artifact.artifact_id DESC LIMIT 1),',
        'existing AS (SELECT delivery_id AS "deliveryId",status,artifact_id AS "artifactId",file_name AS "fileName",mime_type AS "mimeType",expires_at AS "expiresAt" FROM business.miniapp_artifact_deliveries WHERE tenant_id=$1 AND account_id=$2 AND paper_task_id=$3 AND expires_at>transaction_timestamp() AND status IN (\'queued\',\'leased\',\'ready\') ORDER BY created_at DESC LIMIT 1),',
        'created AS (INSERT INTO business.miniapp_artifact_deliveries(delivery_id,artifact_id,paper_task_id,tenant_id,account_id,object_id,expected_sha256,expected_bytes,file_name,mime_type,status,expires_at) SELECT $4,artifact."artifactId",$3,$1,$2,artifact."objectId",artifact."expectedSha256",artifact."expectedBytes",artifact."fileName",artifact."mimeType",\'queued\',$5::timestamptz FROM artifact WHERE NOT EXISTS (SELECT 1 FROM existing) RETURNING delivery_id AS "deliveryId",status,artifact_id AS "artifactId",file_name AS "fileName",mime_type AS "mimeType",expires_at AS "expiresAt")',
        'SELECT * FROM existing UNION ALL SELECT * FROM created',
      ].join(' '), [tenant(input.tenantId), account(input.accountId), paperTask(input.taskId), deliveryId, expiresAt.toISOString()]);
      if (!result || !Array.isArray(result.rows) || result.rows.length !== 1) throw failure('MINIAPP_ARTIFACT_DELIVERY_NOT_FOUND');
      return output(result.rows[0]);
    },
    async lease(input) {
      if (!input || typeof input !== 'object' || Array.isArray(input) || Reflect.ownKeys(input).length !== 1) throw failure('MINIAPP_ARTIFACT_DELIVERY_INPUT_INVALID');
      const leaseToken = String(randomToken());
      if (leaseToken.length < 16 || leaseToken.length > 512) throw failure('MINIAPP_ARTIFACT_DELIVERY_UNAVAILABLE');
      const leaseExpiresAt = future(leaseSeconds);
      const result = await query([
        'WITH purged AS (DELETE FROM business.miniapp_artifact_deliveries WHERE expires_at<=transaction_timestamp()),',
        'candidate AS (SELECT delivery_id FROM business.miniapp_artifact_deliveries WHERE expires_at>transaction_timestamp() AND (status=\'queued\' OR (status=\'leased\' AND lease_expires_at<=transaction_timestamp())) ORDER BY created_at ASC,delivery_id ASC FOR UPDATE SKIP LOCKED LIMIT 1),',
        'leased AS (UPDATE business.miniapp_artifact_deliveries delivery SET status=\'leased\',lease_agent_id=$1,lease_token_sha256=$2,lease_expires_at=$3::timestamptz,attempts=attempts+1,updated_at=transaction_timestamp() FROM candidate WHERE delivery.delivery_id=candidate.delivery_id RETURNING delivery.delivery_id AS "deliveryId",delivery.status,delivery.artifact_id AS "artifactId",delivery.object_id AS "objectId",1 AS "objectVersion",delivery.expected_sha256 AS "expectedSha256",delivery.expected_bytes AS "expectedBytes",delivery.file_name AS "fileName",delivery.mime_type AS "mimeType",delivery.expires_at AS "expiresAt",delivery.lease_expires_at AS "leaseExpiresAt") SELECT * FROM leased',
      ].join(' '), [agent(input.agentId), hash(leaseToken), leaseExpiresAt.toISOString()]);
      if (!result || !Array.isArray(result.rows)) throw failure('MINIAPP_ARTIFACT_DELIVERY_UNAVAILABLE');
      if (result.rows.length === 0) return null;
      if (result.rows.length !== 1) throw failure('MINIAPP_ARTIFACT_DELIVERY_UNAVAILABLE');
      return output(result.rows[0], { leaseToken });
    },
    async upload(input) {
      if (!input || typeof input !== 'object' || Array.isArray(input) || Reflect.ownKeys(input).length !== 4 || !Buffer.isBuffer(input.bytes) || input.bytes.length < 1 || input.bytes.length > (64 * 1024 * 1024)) throw failure('MINIAPP_ARTIFACT_DELIVERY_INPUT_INVALID');
      const currentBytes = Buffer.from(input.bytes);
      const result = await query([
        'UPDATE business.miniapp_artifact_deliveries SET status=\'ready\',artifact_bytes=$4,lease_agent_id=NULL,lease_token_sha256=NULL,lease_expires_at=NULL,updated_at=transaction_timestamp()',
        'WHERE delivery_id=$1 AND status=\'leased\' AND lease_agent_id=$2 AND lease_token_sha256=$3 AND lease_expires_at>transaction_timestamp() AND expires_at>transaction_timestamp() AND expected_sha256=$5 AND expected_bytes=$6',
        'RETURNING delivery_id AS "deliveryId",status,file_name AS "fileName",mime_type AS "mimeType",expires_at AS "expiresAt"',
      ].join(' '), [delivery(input.deliveryId), agent(input.agentId), hash(text(input.leaseToken, /^.{16,512}$/)), currentBytes, crypto.createHash('sha256').update(currentBytes).digest('hex'), currentBytes.length]);
      if (!result || !Array.isArray(result.rows) || result.rows.length !== 1) throw failure('MINIAPP_ARTIFACT_DELIVERY_UPLOAD_REJECTED');
      return output(result.rows[0]);
    },
    async status(input) {
      if (!input || typeof input !== 'object' || Array.isArray(input) || Reflect.ownKeys(input).length !== 3) throw failure('MINIAPP_ARTIFACT_DELIVERY_INPUT_INVALID');
      const result = await query([
        'SELECT delivery_id AS "deliveryId",status,artifact_id AS "artifactId",file_name AS "fileName",mime_type AS "mimeType",expires_at AS "expiresAt"',
        'FROM business.miniapp_artifact_deliveries WHERE tenant_id=$1 AND account_id=$2 AND delivery_id=$3 AND expires_at>transaction_timestamp()',
      ].join(' '), [tenant(input.tenantId), account(input.accountId), delivery(input.deliveryId)]);
      if (!result || !Array.isArray(result.rows) || result.rows.length !== 1) throw failure('MINIAPP_ARTIFACT_DELIVERY_NOT_FOUND');
      return output(result.rows[0]);
    },
    async download(input) {
      if (!input || typeof input !== 'object' || Array.isArray(input) || Reflect.ownKeys(input).length !== 3) throw failure('MINIAPP_ARTIFACT_DELIVERY_INPUT_INVALID');
      const result = await query([
        'WITH selected AS (SELECT delivery_id AS "deliveryId",file_name AS "fileName",mime_type AS "mimeType",artifact_bytes AS bytes,expires_at AS "expiresAt" FROM business.miniapp_artifact_deliveries WHERE tenant_id=$1 AND account_id=$2 AND delivery_id=$3 AND status=\'ready\' AND expires_at>transaction_timestamp()),',
        'touched AS (UPDATE business.miniapp_artifact_deliveries delivery SET downloaded_at=transaction_timestamp(),updated_at=transaction_timestamp() FROM selected WHERE delivery.delivery_id=selected."deliveryId") SELECT * FROM selected',
      ].join(' '), [tenant(input.tenantId), account(input.accountId), delivery(input.deliveryId)]);
      if (!result || !Array.isArray(result.rows) || result.rows.length !== 1) throw failure('MINIAPP_ARTIFACT_DELIVERY_NOT_READY');
      return output({ ...result.rows[0], status: 'ready' }, { bytes: true });
    },
  });
}

module.exports = Object.freeze({ createMiniappArtifactDeliveryRepository });
