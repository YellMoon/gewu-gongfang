const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const script = path.join(__dirname, 'authority-user-lifecycle-e2e.js');
assert.ok(fs.existsSync(script), 'isolated authority user lifecycle E2E script must exist');

const result = childProcess.spawnSync(process.execPath, [script], {
  cwd: path.resolve(__dirname, '..'),
  encoding: 'utf8',
  timeout: 120_000,
  env: {
    ...process.env,
    E2E_RUN_ISOLATED_AUTHORITY_USER_LIFECYCLE: '1',
  },
});
assert.strictEqual(result.status, 0, result.stderr || result.stdout);
const summaryLine = result.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
const summary = JSON.parse(summaryLine);
assert.deepStrictEqual({
  success: summary.success,
  manualPhoneBound: summary.manualPhoneBound,
  miniappReadBeforeReview: summary.miniappReadBeforeReview,
  roleApplicationSubmitted: summary.roleApplicationSubmitted,
  hostReviewedThroughDesktopFacade: summary.hostReviewedThroughDesktopFacade,
  canonicalGrantActive: summary.canonicalGrantActive,
  miniappFormalRoleAfterReview: summary.miniappFormalRoleAfterReview,
  miniappReadAfterReview: summary.miniappReadAfterReview,
  desktopProjectionRead: summary.desktopProjectionRead,
  isolatedDataRemoved: summary.isolatedDataRemoved,
}, {
  success: true,
  manualPhoneBound: true,
  miniappReadBeforeReview: true,
  roleApplicationSubmitted: true,
  hostReviewedThroughDesktopFacade: true,
  canonicalGrantActive: true,
  miniappFormalRoleAfterReview: true,
  miniappReadAfterReview: true,
  desktopProjectionRead: true,
  isolatedDataRemoved: true,
});
assert.match(path.basename(summary.isolatedRoot), /^gewu-authority-user-lifecycle-[A-Za-z0-9]+$/);
assert.strictEqual(fs.existsSync(summary.isolatedRoot), false,
  'successful lifecycle E2E must remove only its exact disposable root');

console.log('authority user lifecycle E2E contract checks passed');
