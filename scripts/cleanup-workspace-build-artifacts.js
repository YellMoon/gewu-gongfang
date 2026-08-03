'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const WORKSPACE_ARTIFACT = /^tmp-(?:desktop|host|e2e-host|identity-upgrade)-[A-Za-z0-9][A-Za-z0-9._-]*$/;

function cleanupError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function assertWorkspaceArtifactRoot(value) {
  const resolved = path.resolve(String(value || ''));
  if (path.dirname(resolved).toLowerCase() !== projectRoot.toLowerCase()
    || !WORKSPACE_ARTIFACT.test(path.basename(resolved))) {
    throw cleanupError('WORKSPACE_BUILD_ARTIFACT_ROOT_REQUIRED');
  }
  if (fs.existsSync(resolved) && fs.lstatSync(resolved).isSymbolicLink()) {
    throw cleanupError('WORKSPACE_BUILD_ARTIFACT_LINK_FORBIDDEN');
  }
  return resolved;
}

function listArtifactProcesses(root) {
  const resolved = assertWorkspaceArtifactRoot(root);
  const literal = resolved.replace(/'/g, "''");
  const script = [
    `$artifact = '${literal}'`,
    `$excluded = @(${process.pid}, ${process.ppid})`,
    'Get-CimInstance Win32_Process | Where-Object {',
    '  $_.ProcessId -ne $PID -and $excluded -notcontains $_.ProcessId -and $_.CommandLine -and $_.CommandLine.IndexOf($artifact, [System.StringComparison]::OrdinalIgnoreCase) -ge 0',
    '} | ForEach-Object { $_.ProcessId }',
  ].join('; ');
  return String(childProcess.execFileSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command', script,
  ], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }))
    .split(/\r?\n/)
    .map(value => Number(value.trim()))
    .filter(pid => Number.isSafeInteger(pid) && pid > 0)
    .map(pid => ({ pid }));
}

function cleanupWorkspaceArtifact(root, { listProcesses = listArtifactProcesses } = {}) {
  const resolved = assertWorkspaceArtifactRoot(root);
  if (!fs.existsSync(resolved)) throw cleanupError('WORKSPACE_BUILD_ARTIFACT_NOT_FOUND');
  if (listProcesses(resolved).length) throw cleanupError('WORKSPACE_BUILD_ARTIFACT_PROCESS_STILL_RUNNING');
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 30, retryDelay: 250 });
  if (fs.existsSync(resolved)) throw cleanupError('WORKSPACE_BUILD_ARTIFACT_CLEANUP_FAILED');
  return Object.freeze({ root: resolved, removed: true });
}

function main(argv = process.argv.slice(2)) {
  if (!argv.length) throw cleanupError('WORKSPACE_BUILD_ARTIFACT_ARGUMENT_REQUIRED');
  console.log(JSON.stringify({
    safeRecursiveDelete: true,
    results: argv.map(root => cleanupWorkspaceArtifact(root)),
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(String(error?.code || error?.message || error));
    process.exitCode = 1;
  }
}

module.exports = { assertWorkspaceArtifactRoot, cleanupWorkspaceArtifact, listArtifactProcesses };
