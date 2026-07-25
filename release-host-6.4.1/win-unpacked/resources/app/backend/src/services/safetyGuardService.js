const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const maintenanceTokens = new Map();
const pendingChallenges = new Map();

const ALLOWED_DANGEROUS_ACTIONS = new Set([
  'format-question-bank-disk',
  'clear-question-bank-data',
  'clear-question-bank-cache',
  'delete-question-bank-backup',
  'reset-local-sync-queue',
]);

function createId(prefix) {
  return `${prefix}_${crypto.randomBytes(16).toString('hex')}`;
}

function createMaintenanceToken(options = {}) {
  const nowMs = options.nowMs ?? Date.now();
  const ttlMs = options.ttlMs ?? 10 * 60 * 1000;
  const token = createId('maintenanceToken');
  const record = {
    token,
    actor: options.actor || 'system',
    expiresAt: new Date(nowMs + ttlMs).toISOString(),
    expiresAtMs: nowMs + ttlMs,
  };
  maintenanceTokens.set(token, record);
  return {
    token,
    actor: record.actor,
    expiresAt: record.expiresAt,
  };
}

function requireMaintenanceToken(token, nowMs = Date.now()) {
  const record = maintenanceTokens.get(token);
  if (!record) throw new Error('A valid maintenance token is required');
  if (record.expiresAtMs <= nowMs) {
    maintenanceTokens.delete(token);
    throw new Error('The maintenance token has expired');
  }
  return record;
}

function prepareDangerousAction(options = {}) {
  const nowMs = options.nowMs ?? Date.now();
  const tokenRecord = requireMaintenanceToken(options.token, nowMs);
  const action = String(options.action || '').trim();
  if (!ALLOWED_DANGEROUS_ACTIONS.has(action)) {
    throw new Error(`Dangerous action is not allowed: ${action}`);
  }
  const target = options.target || {};
  const targetLabel = String(target.label || target.rootPath || target.path || '').trim();
  if (!targetLabel) throw new Error('Dangerous action target label is required');

  const ttlMs = options.ttlMs ?? 5 * 60 * 1000;
  const challengeId = createId('challenge');
  const challenge = `CONFIRM ${action} ON ${targetLabel}`;
  const record = {
    challengeId,
    challenge,
    action,
    target,
    actor: tokenRecord.actor,
    token: options.token,
    expiresAtMs: nowMs + ttlMs,
    expiresAt: new Date(nowMs + ttlMs).toISOString(),
    used: false,
  };
  pendingChallenges.set(challengeId, record);
  return {
    challengeId,
    challenge,
    action,
    target,
    expiresAt: record.expiresAt,
  };
}

function commitDangerousAction(options = {}) {
  const nowMs = options.nowMs ?? Date.now();
  requireMaintenanceToken(options.token, nowMs);
  const record = pendingChallenges.get(options.challengeId);
  if (!record) throw new Error('Dangerous action challenge does not exist');
  if (record.token !== options.token) throw new Error('Dangerous action challenge belongs to another maintenance token');
  if (record.used) throw new Error('Dangerous action challenge was already used');
  if (record.expiresAtMs <= nowMs) {
    pendingChallenges.delete(options.challengeId);
    throw new Error('Dangerous action challenge has expired');
  }
  if (options.response !== record.challenge) throw new Error('Dangerous action challenge response does not match');
  record.used = true;
  return {
    ok: true,
    action: record.action,
    target: record.target,
    actor: record.actor,
  };
}

function assertSafeDiskTarget(target = {}, expected = {}) {
  const diskNumber = Number(target.diskNumber);
  const driveLetter = String(target.driveLetter || '').replace(':', '').toUpperCase();
  const busType = String(target.busType || '').toUpperCase();
  const friendlyName = String(target.friendlyName || '');
  const rootPath = String(target.rootPath || target.path || '');

  if (diskNumber === 0) throw new Error('Refusing to operate on the system disk');
  if (driveLetter === 'C' || driveLetter === 'D') throw new Error(`Refusing to operate on system drive ${driveLetter}:`);
  if (busType !== 'USB') throw new Error(`Refusing non-USB disk target: ${busType || 'unknown'}`);

  if (expected.expectedFriendlyNameIncludes && !friendlyName.includes(expected.expectedFriendlyNameIncludes)) {
    throw new Error(`Disk friendly name does not match expected device: ${expected.expectedFriendlyNameIncludes}`);
  }
  if (expected.expectedRootName && !rootPath.replace(/\\/g, '/').includes(`/${expected.expectedRootName}`)) {
    throw new Error(`Disk root path must include ${expected.expectedRootName}`);
  }
  return true;
}

function defaultAuditLogPath() {
  return path.join(os.homedir(), 'AppData', 'Roaming', 'gewu-gongfang', 'logs', 'safety-audit.log');
}

function auditSafetyEvent(event = {}, options = {}) {
  const logPath = options.logPath || defaultAuditLogPath();
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const sanitized = { ...event };
  delete sanitized.token;
  delete sanitized.maintenanceToken;
  delete sanitized.response;
  const record = {
    at: new Date(options.nowMs ?? Date.now()).toISOString(),
    ...sanitized,
  };
  fs.appendFileSync(logPath, `${JSON.stringify(record)}\n`, 'utf-8');
  return record;
}

module.exports = {
  createMaintenanceToken,
  prepareDangerousAction,
  commitDangerousAction,
  assertSafeDiskTarget,
  auditSafetyEvent,
};
