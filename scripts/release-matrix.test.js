const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const matrix = require('./release-matrix');

const targets = matrix.DEFAULT_TARGETS;
const versions = {
  desktop: '7.2.0',
  cloud_business: '7.1.9',
  storage_proxy: '7.0.4',
  miniapp: '7.3.1',
};
const manifest = matrix.createReleaseManifest({ componentVersions: versions, commit: 'abc123' });

assert.strictEqual(manifest.schema, matrix.MANIFEST_SCHEMA);
assert.deepStrictEqual(Object.keys(manifest.targets), targets, 'every deployed component must have a receipt state');
assert.deepStrictEqual(manifest.componentVersions, versions, 'versions are independent by component');
assert.deepStrictEqual(matrix.validateManifest(manifest).issues, [], 'a reviewed compatibility declaration is mandatory and valid');
assert.strictEqual(matrix.isReleaseComplete(manifest), false, 'a planned matrix is not complete');

assert.throws(
  () => matrix.recordReceipt(manifest, { target: 'cloud_business', version: versions.desktop, evidence: 'wrong version' }),
  /cloud_business release version mismatch/i,
  'a target cannot receive another component’s version',
);
for (const target of targets) {
  matrix.recordReceipt(manifest, {
    target,
    version: versions[target],
    evidence: `${target} receipt`,
    ...(target === 'miniapp' ? { releaseLevel: 'development' } : {}),
  });
}
assert.strictEqual(matrix.isReleaseComplete(manifest), false, 'a development miniapp upload is not a formal completion');
matrix.recordReceipt(manifest, {
  target: 'miniapp', version: versions.miniapp, evidence: 'WeChat production release', releaseLevel: 'production',
});
assert.strictEqual(matrix.isReleaseComplete(manifest), true, 'a production receipt completes the compatible component matrix');
assert.strictEqual(matrix.isCompletedHistoricalManifest(manifest), true,
  'historical archival must check every target against its own component version');

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-release-matrix-'));
try {
  for (const target of targets) {
    const relativePath = {
      desktop: 'package.json',
      cloud_business: 'cloud-business-api/package.json',
      storage_proxy: 'storage-agent/package.json',
      miniapp: 'miniapp/package.json',
    }[target];
    const absolutePath = path.join(fixtureRoot, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, JSON.stringify({ version: versions[target] }), 'utf8');
  }
  const localMatrix = matrix.assertSourceVersionMatrix(matrix.readSourceVersionMatrix({ rootDir: fixtureRoot }));
  assert.deepStrictEqual(localMatrix, versions, 'source packages may intentionally have different component versions');
  const manifestPath = matrix.defaultManifestPath(fixtureRoot);
  assert.match(manifestPath, /desktop-7\.2\.0__cloud-business-7\.1\.9__storage-proxy-7\.0\.4__miniapp-7\.3\.1/,
    'the default ledger path is isolated by the entire component version matrix');
  matrix.writeManifest(manifestPath, matrix.createReleaseManifest({ componentVersions: versions, commit: 'abc123' }));
  assert.strictEqual(
    matrix.assertReleaseTarget({ rootDir: fixtureRoot, manifestPath, target: 'cloud_business' }).version,
    versions.cloud_business,
    'a cloud deployment is gated against the cloud component version only',
  );
  assert.throws(
    () => matrix.assertReleaseTarget({ rootDir: fixtureRoot, manifestPath, target: 'cloud_business', requestedVersion: versions.desktop }),
    /release version mismatch/i,
    'a requested source version that is not declared in the matrix must fail',
  );

  const pending = matrix.readManifest(manifestPath);
  for (const target of ['cloud_business', 'storage_proxy', 'miniapp']) {
    matrix.recordReceipt(pending, { target, version: versions[target], evidence: `${target} compatible` });
  }
  matrix.writeManifest(manifestPath, pending);
  assert.strictEqual(
    matrix.assertDesktopReleasePrerequisites({ rootDir: fixtureRoot, manifestPath }).version,
    versions.desktop,
    'OSS publication depends on verified compatible component receipts, not equal version strings',
  );

  const incompatible = matrix.readManifest(manifestPath);
  incompatible.compatibility.contracts.cloudBusinessRest.version = '999';
  assert.match(matrix.validateManifest(incompatible).issues.join('; '), /compatibility/i,
    'the ledger rejects a protocol or data compatibility declaration that was not reviewed');
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}

console.log('release matrix checks passed');
