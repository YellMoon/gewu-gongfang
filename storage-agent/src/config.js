'use strict';

const fs = require('fs');
const path = require('path');

function failure() {
  const error = new Error('STORAGE_AGENT_CONFIG_INVALID');
  error.code = 'STORAGE_AGENT_CONFIG_INVALID';
  return error;
}

function required(value) {
  if (typeof value !== 'string' || !value.trim()) throw failure();
  return value.trim();
}

function parseCloudBaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(required(value));
  } catch {
    throw failure();
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) throw failure();
  return parsed.toString().replace(/\/$/, '');
}

function parseAgentId(value) {
  const agentId = required(value);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(agentId)) throw failure();
  return agentId;
}

function parseNasRoot(value) {
  const configuredRoot = required(value);
  if (!path.isAbsolute(configuredRoot)) throw failure();
  const nasRoot = path.resolve(configuredRoot);
  if (!fs.existsSync(nasRoot) || !fs.statSync(nasRoot).isDirectory()) throw failure();
  return nasRoot;
}

function parsePollSeconds(value) {
  if (value === undefined || value === '') return 10;
  if (!/^\d+$/.test(String(value))) throw failure();
  const pollSeconds = Number(value);
  if (!Number.isSafeInteger(pollSeconds) || pollSeconds < 5 || pollSeconds > 300) throw failure();
  return pollSeconds;
}

function loadStorageAgentConfig(env = process.env) {
  return Object.freeze({
    cloudBaseUrl: parseCloudBaseUrl(env.CLOUD_BUSINESS_BASE_URL),
    agentId: parseAgentId(env.STORAGE_AGENT_ID),
    nasRoot: parseNasRoot(env.NAS_STORAGE_ROOT),
    pollSeconds: parsePollSeconds(env.STORAGE_AGENT_POLL_SECONDS),
  });
}

module.exports = {
  loadStorageAgentConfig,
};
