'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function failure() {
  return Object.assign(new Error('STORAGE_AGENT_PROVISION_INVALID'), { code: 'STORAGE_AGENT_PROVISION_INVALID' });
}

function plain(value) {
  return typeof value === 'string' && value.trim() && !/[\r\n\0]/u.test(value) ? value.trim() : null;
}

function createProvision({ cloudBaseUrl, agentId, nasRoot, parserPath, randomBytes = crypto.randomBytes } = {}) {
  const base = plain(cloudBaseUrl);
  const id = plain(agentId);
  const root = plain(nasRoot);
  const parser = plain(parserPath);
  if (!base || !/^https:\/\/[^/?#]+(?:\/[^?#]*)?$/u.test(base) || !id || !/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/u.test(id)
    || !root || !path.isAbsolute(root) || !parser || !path.isAbsolute(parser) || !fs.existsSync(root) || !fs.statSync(root).isDirectory()
    || !fs.existsSync(parser) || !fs.statSync(parser).isFile() || path.extname(parser).toLowerCase() !== '.py' || typeof randomBytes !== 'function') throw failure();
  const pair = crypto.generateKeyPairSync('x25519');
  const privateKey = pair.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64url');
  const publicKey = pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url');
  const token = Buffer.from(randomBytes(36)).toString('base64url');
  if (!/^[A-Za-z0-9_-]{48}$/u.test(token)) throw failure();
  return Object.freeze({ cloudBaseUrl: base.replace(/\/$/u, ''), agentId: id, nasRoot: path.resolve(root), parserPath: path.resolve(parser), privateKey, publicKey, token });
}

function writeProvision({ configPath, provision } = {}) {
  const target = plain(configPath);
  if (!target || !path.isAbsolute(target) || !provision || typeof provision !== 'object') throw failure();
  const fields = {
    CLOUD_BUSINESS_BASE_URL: provision.cloudBaseUrl,
    STORAGE_AGENT_ID: provision.agentId,
    STORAGE_AGENT_TOKEN: provision.token,
    STORAGE_AGENT_PRIVATE_KEY: provision.privateKey,
    NAS_STORAGE_ROOT: provision.nasRoot,
    QUESTION_IMPORT_PARSER_PATH: provision.parserPath,
    STORAGE_AGENT_POLL_SECONDS: '10',
  };
  if (Object.values(fields).some(value => !plain(value))) throw failure();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, Object.entries(fields).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { encoding: 'utf8', mode: 0o600 });
  return target;
}

function writeCloudProvision({ configPath, provision } = {}) {
  const target = plain(configPath);
  if (!target || !path.isAbsolute(target) || !provision || typeof provision !== 'object') throw failure();
  const fields = {
    CLOUD_STORAGE_AGENT_ID: provision.agentId,
    CLOUD_STORAGE_AGENT_TOKEN: provision.token,
    CLOUD_STORAGE_AGENT_PUBLIC_KEY: provision.publicKey,
  };
  if (Object.values(fields).some(value => !plain(value))) throw failure();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, Object.entries(fields).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { encoding: 'utf8', mode: 0o600 });
  return target;
}

module.exports = { createProvision, writeProvision, writeCloudProvision };
