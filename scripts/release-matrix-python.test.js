const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const matrix = require('./release-matrix');
const componentVersions = matrix.readSourceVersionMatrix({ rootDir: path.resolve(__dirname, '..') });

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
    componentVersions,
    commit,
  }));
  const probe = spawnSync('python', ['-c', [
    'import json',
    'import scripts.deploy as deploy',
    "manifest = deploy.require_release_manifest('cloud_business')",
    "deploy.record_release_receipt('cloud_business', 'unit health receipt')",
    'print(manifest["componentVersions"]["cloud_business"])',
  ].join('\n')], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, GEWU_RELEASE_MANIFEST_PATH: manifestPath },
    encoding: 'utf8',
  });
  assert.strictEqual(probe.status, 0, probe.stderr || probe.stdout || 'cloud business release manifest probe must pass');
  assert.strictEqual(probe.stdout.trim(), componentVersions.cloud_business, 'cloud business receipt gate should use the cloud component version');
  const recorded = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.strictEqual(recorded.targets.cloud_business.status, 'verified');
  assert.strictEqual(recorded.targets.cloud_business.receipt.version, componentVersions.cloud_business);
  assert.strictEqual(
    recorded.targets.cloud_business.receipt.compatibility,
    recorded.compatibility.schema,
    'Python deployment receipts must attest the exact reviewed compatibility schema',
  );
  assert.strictEqual(
    matrix.validateManifest(recorded).issues.length,
    0,
    'Python deployment receipts must satisfy the same persisted-receipt contract as JavaScript producers',
  );

  const blankEvidenceManifestPath = path.join(fixtureRoot, 'blank-evidence.json');
  matrix.writeManifest(blankEvidenceManifestPath, matrix.createReleaseManifest({
    componentVersions,
    commit,
  }));
  const blankEvidenceProbe = spawnSync('python', ['-c', [
    'import scripts.deploy as deploy',
    "deploy.record_release_receipt('cloud_business', ' \\t ')",
  ].join('\n')], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, GEWU_RELEASE_MANIFEST_PATH: blankEvidenceManifestPath },
    encoding: 'utf8',
  });
  assert.notStrictEqual(blankEvidenceProbe.status, 0, 'blank evidence must never create a verified deployment receipt');
  assert.match(`${blankEvidenceProbe.stderr}\n${blankEvidenceProbe.stdout}`, /evidence/i);
  assert.deepStrictEqual(
    JSON.parse(fs.readFileSync(blankEvidenceManifestPath, 'utf8')).targets.cloud_business,
    { status: 'pending' },
    'a rejected receipt must leave the release target pending',
  );
  const verifiedRecoveryProbe = spawnSync('python', ['-c', [
    'import scripts.deploy as deploy',
    "manifest = deploy.require_release_manifest('cloud_business', allowed_statuses=('pending', 'verified'))",
    'print(manifest["targets"]["cloud_business"]["status"])',
  ].join('\n')], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, GEWU_RELEASE_MANIFEST_PATH: manifestPath },
    encoding: 'utf8',
  });
  assert.strictEqual(verifiedRecoveryProbe.status, 0, verifiedRecoveryProbe.stderr || 'verified recovery gate must pass');
  assert.strictEqual(verifiedRecoveryProbe.stdout.trim(), 'verified');
  for (const [label, mutateReceipt] of [
    ['missing compatibility', receipt => { delete receipt.compatibility; }],
    ['blank evidence', receipt => { receipt.evidence = ' \t '; }],
    ['invalid verifiedAt', receipt => { receipt.verifiedAt = '2026-99-99T25:61:61Z'; }],
  ]) {
    const forgedManifest = JSON.parse(JSON.stringify(recorded));
    mutateReceipt(forgedManifest.targets.cloud_business.receipt);
    const forgedManifestPath = path.join(fixtureRoot, `forged-${label.replace(/\s+/g, '-')}.json`);
    fs.writeFileSync(forgedManifestPath, `${JSON.stringify(forgedManifest, null, 2)}\n`, 'utf8');
    const forgedReceiptProbe = spawnSync('python', ['-c', [
      'import scripts.deploy as deploy',
      "deploy.require_release_manifest('cloud_business', allowed_statuses=('pending', 'verified'))",
    ].join('\n')], {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env, GEWU_RELEASE_MANIFEST_PATH: forgedManifestPath },
      encoding: 'utf8',
    });
    assert.notStrictEqual(forgedReceiptProbe.status, 0, `verified recovery must reject ${label}`);
    assert.match(`${forgedReceiptProbe.stderr}\n${forgedReceiptProbe.stdout}`, /invalid verified receipt/i);
  }
  const duplicatePendingProbe = spawnSync('python', ['-c', [
    'import scripts.deploy as deploy',
    "deploy.require_release_manifest('cloud_business')",
  ].join('\n')], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, GEWU_RELEASE_MANIFEST_PATH: manifestPath },
    encoding: 'utf8',
  });
  assert.notStrictEqual(duplicatePendingProbe.status, 0, 'normal deploy must still reject an already verified target');
  assert.throws(
    () => matrix.recordReceipt(recorded, { target: 'cloud_business', version: componentVersions.cloud_business, evidence: 'duplicate' }),
    /already has a verified receipt/i,
    'a duplicate deployment receipt must fail instead of silently reusing a target'
  );

  matrix.writeManifest(manifestPath, matrix.createReleaseManifest({
    componentVersions,
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
