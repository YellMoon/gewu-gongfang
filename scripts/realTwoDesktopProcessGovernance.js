'use strict';

const fs = require('fs');

function codedError(code, details = '') {
  const error = new Error(details ? `${code} ${details}` : code);
  error.code = code;
  return error;
}

function defaultIsPidAlive(pid) {
  if (!Number.isInteger(Number(pid)) || Number(pid) < 1) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function acquireRunLease({
  lockPath,
  pid = process.pid,
  isPidAlive = defaultIsPidAlive,
  fsImpl = fs,
} = {}) {
  if (!lockPath) throw codedError('REAL_TWO_DESKTOP_E2E_LOCK_PATH_REQUIRED');
  const ownerPid = Number(pid);
  const writeLease = () => {
    const fd = fsImpl.openSync(lockPath, 'wx');
    try {
      fsImpl.writeFileSync(fd, JSON.stringify({
        pid: ownerPid,
        createdAt: new Date().toISOString(),
      }), 'utf8');
    } finally {
      fsImpl.closeSync(fd);
    }
  };

  try {
    writeLease();
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    let previousPid = 0;
    try {
      previousPid = Number(JSON.parse(fsImpl.readFileSync(lockPath, 'utf8'))?.pid || 0);
    } catch (_invalidLease) {
      previousPid = 0;
    }
    if (previousPid > 0 && isPidAlive(previousPid)) {
      throw codedError('REAL_TWO_DESKTOP_E2E_ALREADY_RUNNING', `pid=${previousPid}`);
    }
    fsImpl.unlinkSync(lockPath);
    writeLease();
  }

  let released = false;
  return Object.freeze({
    lockPath,
    pid: ownerPid,
    release() {
      if (released) return;
      released = true;
      try {
        const current = JSON.parse(fsImpl.readFileSync(lockPath, 'utf8'));
        if (Number(current?.pid) === ownerPid) fsImpl.unlinkSync(lockPath);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    },
  });
}

function assertPackagedDesktopProcessBudget(rows, {
  activeRoot = '',
  maxProcesses = 12,
} = {}) {
  const processes = Array.isArray(rows) ? rows : [];
  const foreign = processes.filter(row => !activeRoot || String(row?.root || '') !== String(activeRoot));
  if (foreign.length > 0) {
    throw codedError(
      'STALE_REAL_TWO_DESKTOP_PROCESSES_REQUIRED_CLEANUP',
      `pids=${foreign.map(row => row.pid).filter(Boolean).join(',')}`,
    );
  }
  if (processes.length > maxProcesses) {
    throw codedError(
      'REAL_TWO_DESKTOP_PROCESS_BUDGET_EXCEEDED',
      `count=${processes.length} max=${maxProcesses}`,
    );
  }
  return true;
}

async function waitForProcessesExit(pids, {
  timeoutMs = 15_000,
  pollMs = 250,
  isPidAlive = defaultIsPidAlive,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  now = Date.now,
} = {}) {
  const targets = [...new Set((pids || []).map(Number).filter(pid => Number.isInteger(pid) && pid > 0))];
  const deadline = now() + timeoutMs;
  while (true) {
    const remaining = targets.filter(isPidAlive);
    if (remaining.length === 0) return true;
    if (now() >= deadline) {
      throw codedError('REAL_TWO_DESKTOP_PROCESS_EXIT_TIMEOUT', `pids=${remaining.join(',')}`);
    }
    await sleep(pollMs);
  }
}

module.exports = {
  acquireRunLease,
  assertPackagedDesktopProcessBudget,
  defaultIsPidAlive,
  waitForProcessesExit,
};
