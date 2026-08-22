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
    && typeof task.leaseExpiresAt === 'string' && Number.isFinite(Date.parse(task.leaseExpiresAt));
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
  return Object.freeze({
    async lease() {
      const response = exact(await post('/api/storage-agent/lease', { agentId }), ['ok', 'task']);
      if (response.ok !== true || (response.task !== null && !validTask(response.task))) throw failure('STORAGE_CLOUD_RESPONSE_INVALID');
      return response.task;
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
  });
}

module.exports = Object.freeze({ createStorageCloudClient });
