'use strict';

const crypto = require('crypto');
const { types } = require('util');

function rejected() {
  return Object.assign(new Error('STORAGE_AGENT_REJECTED'), { code: 'STORAGE_AGENT_REJECTED' });
}

function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) throw rejected();
  if (Reflect.ownKeys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw rejected();
  return value;
}

function sameToken(expected, actual) {
  if (typeof actual !== 'string') return false;
  const expectedBytes = Buffer.from(expected, 'utf8');
  const actualBytes = Buffer.from(actual, 'utf8');
  return expectedBytes.length === actualBytes.length && crypto.timingSafeEqual(expectedBytes, actualBytes);
}

function createStorageAgentService({ repository, agentId, token } = {}) {
  if (!repository || typeof repository.leaseNext !== 'function' || typeof repository.downloadRelay !== 'function' || typeof repository.complete !== 'function'
    || typeof agentId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(agentId)
    || typeof token !== 'string' || token.length < 24) throw rejected();
  function authenticate(input) {
    const request = exact(input, ['agentId', 'token']);
    if (request.agentId !== agentId || !sameToken(token, request.token)) throw rejected();
  }
  return Object.freeze({
    async lease(input) {
      authenticate(input);
      return repository.leaseNext({ agentId });
    },
    async download(input) {
      const request = exact(input, ['agentId', 'token', 'taskId', 'leaseToken']);
      if (request.agentId !== agentId || !sameToken(token, request.token)) throw rejected();
      return repository.downloadRelay({ agentId, taskId: request.taskId, leaseToken: request.leaseToken });
    },
    async complete(input) {
      const request = exact(input, ['agentId', 'token', 'taskId', 'leaseToken', 'observedSha256', 'observedBytes']);
      if (request.agentId !== agentId || !sameToken(token, request.token)) throw rejected();
      return repository.complete({
        agentId,
        taskId: request.taskId,
        leaseToken: request.leaseToken,
        observedSha256: request.observedSha256,
        observedBytes: request.observedBytes,
      });
    },
  });
}

module.exports = Object.freeze({ createStorageAgentService });
