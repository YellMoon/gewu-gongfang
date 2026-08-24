const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const rootPackage = require('../package.json');
const matrix = require('./release-matrix');

const currentCommit = spawnSync('git', ['rev-parse', 'HEAD'], {
  cwd: path.resolve(__dirname, '..'),
  encoding: 'utf8',
});
assert.strictEqual(currentCommit.status, 0, currentCommit.stderr || 'current commit must be readable');
const commit = currentCommit.stdout.trim();

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-release-matrix-python-'));
const manifestPath = path.join(fixtureRoot, 'active.json');
try {
  matrix.writeManifest(manifestPath, matrix.createReleaseManifest({
    version: rootPackage.version,
    commit,
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

  matrix.writeManifest(manifestPath, matrix.createReleaseManifest({
    version: rootPackage.version,
    commit: '0'.repeat(40),
  }));
  const staleProbe = spawnSync('python', ['-c', [
    'import scripts.deploy as deploy',
    "deploy.require_release_manifest('cloud_business')",
  ].join('\n')], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, GEWU_RELEASE_MANIFEST_PATH: manifestPath },
    encoding: 'utf8',
  });
  assert.notStrictEqual(staleProbe.status, 0, 'a manifest from another source commit must fail closed');
  assert.match(`${staleProbe.stderr}\n${staleProbe.stdout}`, /does not match the checked-out source commit/i);
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}

console.log('release matrix python checks passed');
