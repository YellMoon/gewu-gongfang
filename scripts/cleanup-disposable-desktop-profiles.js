'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DISPOSABLE_ROOT = /^(?:tmp-real-desktop-two-app|tmp-real-desktop-client|tmp-packaged-single-instance|gewu-real-profile-migration|tmp-real-desktop-identity-cloud)-[A-Za-z0-9]+$/;

function cleanupError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function assertDisposableRoot(value) {
  const resolved = path.resolve(String(value || ''));
  const temporaryRoot = path.resolve(os.tmpdir());
  if (path.dirname(resolved).toLowerCase() !== temporaryRoot.toLowerCase()
    || !DISPOSABLE_ROOT.test(path.basename(resolved))) {
    throw cleanupError('DISPOSABLE_PROFILE_ROOT_REQUIRED');
  }
  return resolved;
}

function listProfileProcesses(root) {
  const resolved = assertDisposableRoot(root);
  const literal = resolved.replace(/'/g, "''");
  const script = [
    `$profile = '${literal}'`,
    `$excluded = @(${process.pid}, ${process.ppid})`,
    'Get-CimInstance Win32_Process | Where-Object {',
    '  $_.ProcessId -ne $PID -and $excluded -notcontains $_.ProcessId -and $_.CommandLine -and $_.CommandLine.IndexOf($profile, [System.StringComparison]::OrdinalIgnoreCase) -ge 0',
    '} | ForEach-Object { $_.ProcessId }',
  ].join('; ');
  const output = childProcess.execFileSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command', script,
  ], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  return String(output).split(/\r?\n/)
    .map(value => Number(value.trim()))
    .filter(pid => Number.isSafeInteger(pid) && pid > 0)
    .map(pid => ({ pid }));
}

function cleanupDisposableRoot(root, { listProcesses = listProfileProcesses } = {}) {
  const resolved = assertDisposableRoot(root);
  if (!fs.existsSync(resolved)) throw cleanupError('DISPOSABLE_PROFILE_NOT_FOUND');
  const processes = listProcesses(resolved);
  if (!Array.isArray(processes) || processes.length) {
    throw cleanupError('DISPOSABLE_PROFILE_PROCESS_STILL_RUNNING');
  }
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 30, retryDelay: 250 });
  if (fs.existsSync(resolved)) throw cleanupError('DISPOSABLE_PROFILE_CLEANUP_FAILED');
  return Object.freeze({ root: resolved, removed: true });
}

function main(argv = process.argv.slice(2)) {
  if (!argv.length) throw cleanupError('DISPOSABLE_PROFILE_ARGUMENT_REQUIRED');
  const results = argv.map(root => cleanupDisposableRoot(root));
  console.log(JSON.stringify({ safeRecursiveDelete: true, results }));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(String(error?.code || error?.message || error));
    process.exitCode = 1;
  }
}

module.exports = { assertDisposableRoot, cleanupDisposableRoot, listProfileProcesses };
