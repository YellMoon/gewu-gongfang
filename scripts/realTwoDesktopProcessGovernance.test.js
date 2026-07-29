'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  acquireRunLease,
  assertPackagedDesktopProcessBudget,
  waitForProcessesExit,
} = require('./realTwoDesktopProcessGovernance');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-e2e-governance-test-'));
  const lockPath = path.join(root, 'real-two-desktop.lock');

  try {
  const first = acquireRunLease({ lockPath, pid: 101, isPidAlive: pid => pid === 101 });
  assert.strictEqual(JSON.parse(fs.readFileSync(lockPath, 'utf8')).pid, 101);
  assert.throws(
    () => acquireRunLease({ lockPath, pid: 202, isPidAlive: pid => pid === 101 }),
    error => error?.code === 'REAL_TWO_DESKTOP_E2E_ALREADY_RUNNING',
  );
  first.release();
  assert.strictEqual(fs.existsSync(lockPath), false);

  fs.writeFileSync(lockPath, JSON.stringify({ pid: 303 }), 'utf8');
  const reclaimed = acquireRunLease({ lockPath, pid: 404, isPidAlive: () => false });
  assert.strictEqual(JSON.parse(fs.readFileSync(lockPath, 'utf8')).pid, 404);
  reclaimed.release();

  assert.doesNotThrow(() => assertPackagedDesktopProcessBudget([], {
    activeRoot: '',
    maxProcesses: 12,
  }));
  assert.throws(
    () => assertPackagedDesktopProcessBudget([
      { pid: 1, root: 'tmp-real-desktop-two-app-old' },
    ], { activeRoot: '', maxProcesses: 12 }),
    error => error?.code === 'STALE_REAL_TWO_DESKTOP_PROCESSES_REQUIRED_CLEANUP',
  );
  assert.throws(
    () => assertPackagedDesktopProcessBudget(
      Array.from({ length: 13 }, (_value, index) => ({
        pid: index + 1,
        root: 'tmp-real-desktop-two-app-current',
      })),
      { activeRoot: 'tmp-real-desktop-two-app-current', maxProcesses: 12 },
    ),
    error => error?.code === 'REAL_TWO_DESKTOP_PROCESS_BUDGET_EXCEEDED',
  );

  const aliveChecks = new Map([[11, 2], [12, 1]]);
  let sleeps = 0;
  await waitForProcessesExit([11, 12], {
    timeoutMs: 500,
    pollMs: 1,
    isPidAlive(pid) {
      const remaining = aliveChecks.get(pid) || 0;
      aliveChecks.set(pid, Math.max(0, remaining - 1));
      return remaining > 0;
    },
    sleep: async () => { sleeps += 1; },
  });
  assert.ok(sleeps >= 1);

  await assert.rejects(
    waitForProcessesExit([99], {
      timeoutMs: 2,
      pollMs: 1,
      isPidAlive: () => true,
      sleep: async () => {},
      now: (() => {
        let value = 0;
        return () => (value += 2);
      })(),
    }),
    error => error?.code === 'REAL_TWO_DESKTOP_PROCESS_EXIT_TIMEOUT',
  );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  console.log('real two-desktop process governance checks passed');
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
