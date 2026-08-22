const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const rootPackage = require('../package.json');
const matrix = require('./release-matrix');

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-release-matrix-python-'));
const manifestPath = path.join(fixtureRoot, 'active.json');
try {
  matrix.writeManifest(manifestPath, matrix.createReleaseManifest({
    version: rootPackage.version,
    commit: 'unit-test-commit',
  }));
  const probe = spawnSync('python', ['-c', [
    'import json',
    'import scripts.deploy as deploy',
    "manifest = deploy.require_release_manifest('cloud_business')",
    "deploy.record_release_receipt('cloud_business', 'unit health receipt')",
    'print(manifest["version"])',
  ].join('\n')], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, GEWU_RELEASE_MANIFEST_PATH: manifestPath },
    encoding: 'utf8',
  });
  assert.strictEqual(probe.status, 0, probe.stderr || probe.stdout || 'cloud business release manifest probe must pass');
  assert.strictEqual(probe.stdout.trim(), rootPackage.version, 'cloud business receipt gate should use the exact root version');
  const recorded = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.strictEqual(recorded.targets.cloud_business.status, 'verified');
  assert.strictEqual(recorded.targets.cloud_business.receipt.version, rootPackage.version);
  assert.throws(
    () => matrix.recordReceipt(recorded, { target: 'cloud_business', version: rootPackage.version, evidence: 'duplicate' }),
    /already has a verified receipt/i,
    'a duplicate deployment receipt must fail instead of silently reusing a target'
  );
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}

console.log('release matrix python checks passed');
