'use strict';

const path = require('path');
const fs = require('fs');

function createPrimaryHostRelaunchReadiness({
  userDataPath,
  fsImpl = fs,
  now = () => new Date().toISOString(),
  randomId = () => `${process.pid}-${Date.now()}`,
} = {}) {
  const profilePath = path.resolve(String(userDataPath || ''));
  if (!profilePath || profilePath === path.parse(profilePath).root) throw new Error('PRIMARY_HOST_PROFILE_PATH_REQUIRED');
  const filePath = path.join(profilePath, 'primary-host-runtime-ready.json');
  let launchId = null;

  function read() {
    if (!fsImpl.existsSync(filePath)) return null;
    try { return JSON.parse(String(fsImpl.readFileSync(filePath, 'utf8'))); } catch (_error) { return null; }
  }

  function write(state, details = {}) {
    const target = path.resolve(filePath);
    if (path.dirname(target) !== profilePath) throw new Error('PRIMARY_HOST_READINESS_PATH_UNSAFE');
    const record = Object.freeze({
      contractVersion: 1,
      state,
      launchId: launchId || String(randomId()),
      updatedAt: now(),
      ...details,
    });
    const tempPath = `${filePath}.${record.launchId}.tmp`;
    fsImpl.writeFileSync(tempPath, JSON.stringify(record), 'utf8');
    fsImpl.renameSync(tempPath, filePath);
    return record;
  }

  return Object.freeze({
    filePath,
    read,
    beginLaunch() {
      const previous = read();
      launchId = String(randomId());
      return write('starting', { startedAt: now(), previousState: previous?.state || null, previousLaunchId: previous?.launchId || null });
    },
    requestRelaunch() {
      return write('relaunch-requested', { requestedAt: now() });
    },
    markReady({ host = null, port = null } = {}) {
      return write('ready', { readyAt: now(), host: host ? String(host) : null, port: Number(port) || null });
    },
    markFailed(error) {
      return write('failed', { failedAt: now(), error: error?.code || error?.message || 'PRIMARY_HOST_START_FAILED' });
    },
  });
}

module.exports = { createPrimaryHostRelaunchReadiness };
