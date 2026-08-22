'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { loadStorageAgentConfig } = require('./config');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-storage-agent-config-'));
try {
  const validEnv = {
    CLOUD_BUSINESS_BASE_URL: 'https://example.invalid/cloud-business',
    STORAGE_AGENT_ID: 'storage-agent-1',
    STORAGE_AGENT_TOKEN: 'storage-agent-test-token-with-sufficient-length',
    NAS_STORAGE_ROOT: root,
  };
  assert.deepStrictEqual(loadStorageAgentConfig(validEnv), {
    cloudBaseUrl: 'https://example.invalid/cloud-business',
    agentId: 'storage-agent-1',
    token: 'storage-agent-test-token-with-sufficient-length',
    nasRoot: path.resolve(root),
    pollSeconds: 10,
  });
  assert.throws(
    () => loadStorageAgentConfig({ ...validEnv, STORAGE_AGENT_TOKEN: '' }),
    /STORAGE_AGENT_CONFIG_INVALID/,
    'the agent must require its dedicated cloud token'
  );
  assert.throws(
    () => loadStorageAgentConfig({ ...validEnv, NAS_STORAGE_ROOT: path.join(root, 'missing') }),
    /STORAGE_AGENT_CONFIG_INVALID/,
    'the agent must reject a missing NAS root before it can start'
  );
  assert.throws(
    () => loadStorageAgentConfig({ ...validEnv, CLOUD_BUSINESS_BASE_URL: 'http://example.invalid' }),
    /STORAGE_AGENT_CONFIG_INVALID/,
    'the agent must require HTTPS cloud communication'
  );
  assert.throws(
    () => loadStorageAgentConfig({ ...validEnv, STORAGE_AGENT_ID: '../escape' }),
    /STORAGE_AGENT_CONFIG_INVALID/,
    'the agent identifier must not be usable as a path'
  );
  assert.throws(
    () => loadStorageAgentConfig({ ...validEnv, STORAGE_AGENT_POLL_SECONDS: '4' }),
    /STORAGE_AGENT_CONFIG_INVALID/,
    'the polling interval must remain bounded'
  );
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('storage agent config checks passed');
