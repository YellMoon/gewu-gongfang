'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  assertDisposableRoot,
  listProfilePids,
  releaseOwnedLease,
} = require('./realTwoDesktopProcessGuardian');

(async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-guardian-test-'));
  const disposableRoot = path.join(tempRoot, 'tmp-real-desktop-two-app-Ab12');
  const lockPath = path.join(tempRoot, 'runner.lock');

  try {
  fs.mkdirSync(disposableRoot);
  assert.strictEqual(assertDisposableRoot(disposableRoot, { tempDir: tempRoot }), path.resolve(disposableRoot));
  assert.throws(
    () => assertDisposableRoot(path.join(tempRoot, 'not-an-e2e-root'), { tempDir: tempRoot }),
    error => error?.code === 'REAL_TWO_DESKTOP_GUARDIAN_ROOT_REJECTED',
  );
  assert.throws(
    () => assertDisposableRoot(path.join(tempRoot, '..', 'tmp-real-desktop-two-app-Ab12'), { tempDir: tempRoot }),
    error => error?.code === 'REAL_TWO_DESKTOP_GUARDIAN_ROOT_REJECTED',
  );

  fs.writeFileSync(lockPath, JSON.stringify({ pid: 700 }), 'utf8');
  assert.strictEqual(releaseOwnedLease({ lockPath, runnerPid: 701 }), false);
  assert.strictEqual(fs.existsSync(lockPath), true);
  assert.strictEqual(releaseOwnedLease({ lockPath, runnerPid: 700 }), true);
  assert.strictEqual(fs.existsSync(lockPath), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  const integrationRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tmp-real-desktop-two-app-'));
  const integrationLock = path.join(os.tmpdir(), `gewu-guardian-integration-${process.pid}.lock`);
  let dummy = null;
  let guardian = null;
  try {
    fs.writeFileSync(integrationLock, JSON.stringify({ pid: process.pid }), 'utf8');
    dummy = childProcess.spawn(process.execPath, [
      '-e',
      'setInterval(() => {}, 1000)',
      '--',
      `--user-data-dir=${path.join(integrationRoot, 'dummy-profile')}`,
    ], { stdio: 'ignore', windowsHide: true });
    guardian = childProcess.spawn(process.execPath, [
      path.join(__dirname, 'realTwoDesktopProcessGuardian.js'),
      integrationRoot,
      integrationLock,
      String(process.pid),
    ], { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true });
    await new Promise(resolve => setTimeout(resolve, 500));
    const discovered = listProfilePids(integrationRoot);
    assert.ok(discovered.includes(dummy.pid), `DUMMY_PROFILE_PROCESS_NOT_DISCOVERED discovered=${discovered.join(',')} expected=${dummy.pid}`);
    guardian.stdin.end();
    await Promise.race([
      new Promise((resolve, reject) => guardian.once('exit', code => code === 0 ? resolve() : reject(new Error(`GUARDIAN_EXIT_${code}`)))),
      new Promise((_resolve, reject) => setTimeout(() => reject(new Error('GUARDIAN_EXIT_TIMEOUT')), 20_000)),
    ]);
    if (dummy.exitCode === null) {
      await Promise.race([
        new Promise(resolve => dummy.once('exit', resolve)),
        new Promise((_resolve, reject) => setTimeout(() => reject(new Error('DUMMY_PROFILE_PROCESS_NOT_CLEANED')), 5_000)),
      ]);
    }
    assert.notStrictEqual(dummy.exitCode, null);
    assert.strictEqual(fs.existsSync(integrationLock), false);
  } finally {
    for (const child of [dummy, guardian]) {
      if (child?.pid && child.exitCode === null) {
        try { childProcess.execFileSync('taskkill', ['/PID', String(child.pid), '/F'], { stdio: 'ignore' }); } catch (_error) {}
      }
    }
    if (fs.existsSync(integrationLock)) fs.rmSync(integrationLock, { force: true });
    fs.rmSync(integrationRoot, { recursive: true, force: true });
  }

  console.log('real two-desktop process guardian checks passed');
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
