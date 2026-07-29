'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function codedError(code, details = '') {
  const error = new Error(details ? `${code} ${details}` : code);
  error.code = code;
  return error;
}

function assertDisposableRoot(root, { tempDir = os.tmpdir() } = {}) {
  const resolved = path.resolve(String(root || ''));
  const expectedParent = path.resolve(tempDir).toLowerCase();
  if (
    path.dirname(resolved).toLowerCase() !== expectedParent
    || !/^tmp-real-desktop-two-app-[A-Za-z0-9]+$/.test(path.basename(resolved))
  ) {
    throw codedError('REAL_TWO_DESKTOP_GUARDIAN_ROOT_REJECTED', `root=${resolved}`);
  }
  return resolved;
}

function releaseOwnedLease({ lockPath, runnerPid, fsImpl = fs } = {}) {
  try {
    const lease = JSON.parse(fsImpl.readFileSync(lockPath, 'utf8'));
    if (Number(lease?.pid) !== Number(runnerPid)) return false;
    fsImpl.unlinkSync(lockPath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function listProfilePids(root) {
  const escaped = String(root).replace(/'/g, "''");
  const command = [
    '$root =', `'${escaped}';`,
    '$rows = Get-CimInstance Win32_Process | Where-Object {',
    '  $_.ProcessId -ne $PID -and',
    "  [string]$_.CommandLine -match '--user-data-dir=' -and",
    '  [string]$_.CommandLine -like "*$root*"',
    '} | Select-Object -ExpandProperty ProcessId;',
    '@($rows) | ConvertTo-Json -Compress',
  ].join(' ');
  const output = childProcess.execFileSync('powershell.exe', ['-NoProfile', '-Command', command], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15_000,
  }).trim();
  if (!output) return [];
  const parsed = JSON.parse(output);
  return [...new Set((Array.isArray(parsed) ? parsed : [parsed])
    .map(Number)
    .filter(pid => Number.isInteger(pid) && pid > 0))];
}

async function cleanupOwnedProcesses(root) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const pids = listProfilePids(root);
    if (pids.length === 0) return true;
    for (const pid of pids) {
      try {
        childProcess.execFileSync('taskkill', ['/PID', String(pid), '/F'], {
          stdio: 'ignore',
          windowsHide: true,
          timeout: 15_000,
        });
      } catch (_alreadyExited) {}
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  const remaining = listProfilePids(root);
  if (remaining.length > 0) {
    throw codedError('REAL_TWO_DESKTOP_GUARDIAN_CLEANUP_FAILED', `pids=${remaining.join(',')}`);
  }
  return true;
}

async function runGuardian({ root, lockPath, runnerPid }) {
  const safeRoot = assertDisposableRoot(root);
  try {
    await cleanupOwnedProcesses(safeRoot);
  } finally {
    releaseOwnedLease({ lockPath, runnerPid });
  }
}

if (require.main === module) {
  const [root, lockPath, runnerPid] = process.argv.slice(2);
  let started = false;
  const beginCleanup = () => {
    if (started) return;
    started = true;
    runGuardian({ root, lockPath, runnerPid: Number(runnerPid) })
      .catch(error => {
        console.error(error.stack || error.message || error);
        process.exitCode = 1;
      });
  };
  process.stdin.resume();
  process.stdin.once('end', beginCleanup);
  process.stdin.once('error', beginCleanup);
}

module.exports = {
  assertDisposableRoot,
  cleanupOwnedProcesses,
  listProfilePids,
  releaseOwnedLease,
  runGuardian,
};
