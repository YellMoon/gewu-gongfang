'use strict';

const { types } = require('util');

function failure(code) {
  return Object.assign(new Error(code), { code });
}

function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) throw failure('STORAGE_CLOUD_RESPONSE_INVALID');
  if (Reflect.ownKeys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw failure('STORAGE_CLOUD_RESPONSE_INVALID');
  return value;
}

function validTask(task) {
  if (!task || typeof task !== 'object' || Array.isArray(task) || Object.getPrototypeOf(task) !== Object.prototype) return false;
  return typeof task.taskId === 'string' && /^task_[A-Za-z0-9_-]{8,128}$/.test(task.taskId)
    && typeof task.objectId === 'string' && /^obj_[A-Za-z0-9_-]{1,128}$/.test(task.objectId)
    && Number.isSafeInteger(task.objectVersion) && task.objectVersion > 0
    && typeof task.expectedSha256 === 'string' && /^[0-9a-f]{64}$/.test(task.expectedSha256)
    && Number.isSafeInteger(task.expectedBytes) && task.expectedBytes >= 0
    && typeof task.mediaType === 'string' && task.mediaType.length > 0 && task.mediaType.length <= 255
    && typeof task.leaseToken === 'string' && task.leaseToken.length >= 16
    && typeof task.leaseExpiresAt === 'string' && Number.isFinite(Date.parse(task.leaseExpiresAt))
    && ['relay', 'question_import_source', 'question_import_media'].includes(task.kind)
    && (task.kind !== 'question_import_source' || (typeof task.importTaskId === 'string' && /^question_import_task_[A-Za-z0-9_-]{1,128}$/.test(task.importTaskId)
      && ['lecture', 'exam'].includes(task.sourceType) && typeof task.sourceFileName === 'string' && /\.(?:doc|docx)$/iu.test(task.sourceFileName)))
    && (task.kind !== 'question_import_media' || (Number.isSafeInteger(task.itemIndex) && task.itemIndex >= 0
      && Number.isSafeInteger(task.assetIndex) && task.assetIndex >= 0 && validSource(task.source)));
}

function validArtifactDelivery(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
    && /^delivery_[A-Za-z0-9_-]{8,128}$/.test(value.deliveryId || '') && value.status === 'leased'
    && /^paper_artifact_[A-Za-z0-9_-]{8,128}$/.test(value.artifactId || '')
    && /^obj_[A-Za-z0-9_-]{1,128}$/.test(value.objectId || '') && Number.isSafeInteger(value.objectVersion) && value.objectVersion > 0
    && /^[0-9a-f]{64}$/.test(value.expectedSha256 || '') && Number.isSafeInteger(value.expectedBytes) && value.expectedBytes > 0 && value.expectedBytes <= (64 * 1024 * 1024)
    && typeof value.fileName === 'string' && value.fileName.length > 0 && value.fileName.length <= 512
    && typeof value.mimeType === 'string' && value.mimeType.length > 0 && value.mimeType.length <= 255
    && typeof value.expiresAt === 'string' && Number.isFinite(Date.parse(value.expiresAt))
    && typeof value.leaseToken === 'string' && value.leaseToken.length >= 16 && typeof value.leaseExpiresAt === 'string' && Number.isFinite(Date.parse(value.leaseExpiresAt));
}

function validSource(source) {
  return Boolean(source) && typeof source === 'object' && !Array.isArray(source) && Object.getPrototypeOf(source) === Object.prototype
    && typeof source.objectId === 'string' && /^obj_[A-Za-z0-9_-]{1,128}$/.test(source.objectId)
    && Number.isSafeInteger(source.objectVersion) && source.objectVersion > 0
    && typeof source.sha256 === 'string' && /^[0-9a-f]{64}$/.test(source.sha256)
    && Number.isSafeInteger(source.bytes) && source.bytes > 0
    && typeof source.mimeType === 'string' && source.mimeType.length > 0 && source.mimeType.length <= 255
    && ['lecture', 'exam'].includes(source.sourceType) && typeof source.sourceFileName === 'string' && /\.(?:doc|docx)$/iu.test(source.sourceFileName);
}

function validImportTask(task) {
  if (!task || typeof task !== 'object' || Array.isArray(task) || Object.getPrototypeOf(task) !== Object.prototype
    || Reflect.ownKeys(task).length !== 7 || !/^question_import_task_[A-Za-z0-9_-]{1,128}$/.test(task.taskId || '')
    || task.status !== 'candidates_ready' || task.phase !== 'candidates_ready' || !/^[0-9a-f]{64}$/.test(task.requestHash || '')
    || !Number.isFinite(Date.parse(task.createdAt)) || !Number.isFinite(Date.parse(task.updatedAt)) || !Array.isArray(task.mediaTargets)) return false;
  return task.mediaTargets.every(target => target && typeof target === 'object' && !Array.isArray(target) && Object.getPrototypeOf(target) === Object.prototype
    && Reflect.ownKeys(target).length === 9 && /^question_import_media_[A-Za-z0-9_-]{1,128}$/.test(target.mediaId || '')
    && Number.isSafeInteger(target.itemIndex) && target.itemIndex >= 0 && Number.isSafeInteger(target.assetIndex) && target.assetIndex >= 0
    && /^obj_[A-Za-z0-9_-]{1,128}$/.test(target.objectId || '') && Number.isSafeInteger(target.objectVersion) && target.objectVersion > 0
    && /^task_[A-Za-z0-9_-]{8,128}$/.test(target.storageTaskId || '') && /^[0-9a-f]{64}$/.test(target.sha256 || '')
    && Number.isSafeInteger(target.bytes) && target.bytes > 0 && typeof target.mimeType === 'string' && target.mimeType.length > 0 && target.mimeType.length <= 255);
}

function relayBytes(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value) || value.length > (90 * 1024 * 1024)) {
    throw failure('STORAGE_CLOUD_RESPONSE_INVALID');
  }
  const bytes = Buffer.from(value, 'base64url');
  if (!bytes.length || bytes.length > (64 * 1024 * 1024) || bytes.toString('base64url') !== value) {
    throw failure('STORAGE_CLOUD_RESPONSE_INVALID');
  }
  return bytes;
}

function createStorageCloudClient({ cloudBaseUrl, agentId, token, fetch: fetchImpl = globalThis.fetch } = {}) {
  if (typeof cloudBaseUrl !== 'string' || !/^https:\/\/[A-Za-z0-9.-]+(?:\/[^?#]*)?$/u.test(cloudBaseUrl)
    || typeof agentId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(agentId)
    || typeof token !== 'string' || token.length < 24 || typeof fetchImpl !== 'function') throw failure('STORAGE_CLOUD_CONFIG_INVALID');
  const baseUrl = cloudBaseUrl.replace(/\/$/, '');
  async function post(relativePath, body) {
    let response;
    try {
      response = await fetchImpl(`${baseUrl}${relativePath}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-gewu-storage-agent-token': token },
        body: JSON.stringify(body),
      });
    } catch (_) {
      throw failure('STORAGE_CLOUD_UNAVAILABLE');
    }
    if (!response || response.status !== 200 || response.ok !== true || typeof response.json !== 'function') throw failure('STORAGE_CLOUD_UNAVAILABLE');
    try {
      return await response.json();
    } catch (_) {
      throw failure('STORAGE_CLOUD_RESPONSE_INVALID');
    }
  }
  async function postBytes(relativePath, bytes, headers) {
    let response;
    try {
      response = await fetchImpl(`${baseUrl}${relativePath}`, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream', 'x-gewu-storage-agent-token': token, ...headers },
        body: bytes,
      });
    } catch (_) {
      throw failure('STORAGE_CLOUD_UNAVAILABLE');
    }
    if (!response || response.status !== 200 || response.ok !== true || typeof response.json !== 'function') throw failure('STORAGE_CLOUD_UNAVAILABLE');
    try {
      return await response.json();
    } catch (_) {
      throw failure('STORAGE_CLOUD_RESPONSE_INVALID');
    }
  }
  return Object.freeze({
    async lease() {
      const response = exact(await post('/api/storage-agent/lease', { agentId }), ['ok', 'task']);
      if (response.ok !== true || (response.task !== null && !validTask(response.task))) throw failure('STORAGE_CLOUD_RESPONSE_INVALID');
      return response.task;
    },
    async leaseArtifactDelivery() {
      const response = exact(await post('/api/storage-agent/artifact-deliveries/lease', { agentId }), ['ok', 'delivery']);
      if (response.ok !== true || (response.delivery !== null && !validArtifactDelivery(response.delivery))) throw failure('STORAGE_CLOUD_RESPONSE_INVALID');
      return response.delivery;
    },
    async uploadArtifactDelivery(input) {
      const request = exact(input, ['deliveryId', 'leaseToken', 'bytes']);
      if (!/^delivery_[A-Za-z0-9_-]{8,128}$/.test(request.deliveryId || '') || typeof request.leaseToken !== 'string' || request.leaseToken.length < 16
        || !Buffer.isBuffer(request.bytes) || request.bytes.length < 1 || request.bytes.length > (64 * 1024 * 1024)) throw failure('STORAGE_CLOUD_RESPONSE_INVALID');
      const response = exact(await postBytes(`/api/storage-agent/artifact-deliveries/${encodeURIComponent(request.deliveryId)}/upload`, request.bytes, {
        'x-gewu-storage-agent-id': agentId, 'x-gewu-storage-agent-lease-token': request.leaseToken,
      }), ['ok', 'delivery']);
      if (response.ok !== true || !response.delivery || response.delivery.deliveryId !== request.deliveryId || response.delivery.status !== 'ready') throw failure('STORAGE_CLOUD_RESPONSE_INVALID');
      return response.delivery;
    },
    async download(task) {
      if (!validTask(task)) throw failure('STORAGE_CLOUD_RESPONSE_INVALID');
      const response = exact(await post(`/api/storage-agent/tasks/${encodeURIComponent(task.taskId)}/download`, {
        agentId, leaseToken: task.leaseToken,
      }), ['ok', 'relay']);
      const relay = exact(response.relay, ['envelope', 'ciphertextBase64']);
      if (response.ok !== true || !relay.envelope || typeof relay.envelope !== 'object' || Array.isArray(relay.envelope)
        || Object.getPrototypeOf(relay.envelope) !== Object.prototype) throw failure('STORAGE_CLOUD_RESPONSE_INVALID');
      return { envelope: relay.envelope, ciphertext: relayBytes(relay.ciphertextBase64) };
    },
    async complete(input) {
      const request = exact(input, ['taskId', 'leaseToken', 'observedSha256', 'observedBytes']);
      if (typeof request.taskId !== 'string' || !/^task_[A-Za-z0-9_-]{8,128}$/.test(request.taskId)
        || typeof request.leaseToken !== 'string' || request.leaseToken.length < 16
        || typeof request.observedSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(request.observedSha256)
        || !Number.isSafeInteger(request.observedBytes) || request.observedBytes < 0) throw failure('STORAGE_CLOUD_RESPONSE_INVALID');
      const response = exact(await post(`/api/storage-agent/tasks/${encodeURIComponent(request.taskId)}/complete`, {
        agentId, leaseToken: request.leaseToken, observedSha256: request.observedSha256, observedBytes: request.observedBytes,
      }), ['ok', 'receipt']);
      if (response.ok !== true || !response.receipt || response.receipt.taskId !== request.taskId || response.receipt.state !== 'verified'
        || typeof response.receipt.verifiedAt !== 'string' || !Number.isFinite(Date.parse(response.receipt.verifiedAt))) throw failure('STORAGE_CLOUD_RESPONSE_INVALID');
      return response.receipt;
    },
    async reportSourceCandidates(input) {
      const request = exact(input, ['taskId', 'leaseToken', 'observedSha256', 'observedBytes', 'candidates']);
      if (!/^question_import_task_[A-Za-z0-9_-]{1,128}$/.test(request.taskId) || typeof request.leaseToken !== 'string' || request.leaseToken.length < 16
        || !/^[0-9a-f]{64}$/.test(request.observedSha256) || !Number.isSafeInteger(request.observedBytes) || request.observedBytes < 1
        || !Array.isArray(request.candidates) || request.candidates.length < 1 || request.candidates.length > 500) throw failure('STORAGE_CLOUD_RESPONSE_INVALID');
      const serializedCandidates = JSON.stringify(request.candidates);
      if (serializedCandidates.length > (90 * 1024 * 1024) || /data:[^,]*;base64|"(?:ciphertext|plaintext)"\s*:/iu.test(serializedCandidates)) {
        throw failure('STORAGE_CLOUD_RESPONSE_INVALID');
      }
      const response = exact(await post(`/api/storage-agent/question-imports/${encodeURIComponent(request.taskId)}/candidates`, {
        agentId, leaseToken: request.leaseToken, observedSha256: request.observedSha256, observedBytes: request.observedBytes, candidates: request.candidates,
      }), ['ok', 'task']);
      if (response.ok !== true || !validImportTask(response.task)) throw failure('STORAGE_CLOUD_RESPONSE_INVALID');
      return response.task;
    },
  });
}

module.exports = Object.freeze({ createStorageCloudClient });
