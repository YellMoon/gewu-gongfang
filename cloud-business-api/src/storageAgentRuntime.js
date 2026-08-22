'use strict';

const { createStorageAgentService } = require('./storageAgentService');
const { createStorageTaskRepository } = require('./storageTaskRepository');

function createStorageAgentRuntimeFromEnvironment({ env = process.env, query, randomToken, randomId, now } = {}) {
  if (!env || typeof env !== 'object' || typeof query !== 'function') return null;
  const agentId = env.CLOUD_STORAGE_AGENT_ID;
  const token = env.CLOUD_STORAGE_AGENT_TOKEN;
  if (typeof agentId !== 'string' || typeof token !== 'string') return null;
  try {
    return createStorageAgentService({
      agentId,
      token,
      repository: createStorageTaskRepository({ query, randomToken, randomId, now }),
    });
  } catch (_) {
    return null;
  }
}

module.exports = Object.freeze({ createStorageAgentRuntimeFromEnvironment });
