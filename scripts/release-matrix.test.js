const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const matrix = require('./release-matrix');

const targets = matrix.DEFAULT_TARGETS;
const manifest = matrix.createReleaseManifest({
  version: '7.2.0',
  commit: 'abc123',
  createdAt: '2026-07-30T00:00:00.000Z',
});

assert.strictEqual(manifest.version, '7.2.0');
assert.deepStrictEqual(Object.keys(manifest.targets), targets, 'every formal release target must be planned');
assert.ok(Object.values(manifest.targets).every(target => target.status === 'pending'));
assert.deepStrictEqual(matrix.validateManifest(manifest).issues, []);
assert.strictEqual(matrix.isReleaseComplete(manifest), false, 'a planned release is never complete before receipts');


assert.throws(
  () => matrix.recordReceipt(manifest, { target: 'miniapp', version: '7.2.1', verifiedAt: '2026-07-30T01:00:00.000Z' }),
  /version mismatch/i,
  'a receipt from another version must fail closed'
);
assert.throws(
  () => matrix.recordReceipt(manifest, { target: 'unknown', version: '7.2.0', verifiedAt: '2026-07-30T01:00:00.000Z' }),
  /unknown release target/i,
  'only the prescribed endpoints can satisfy a release'
);

for (const target of targets) {
  matrix.recordReceipt(manifest, {
    target,
    version: '7.2.0',
    verifiedAt: '2026-07-30T01:00:00.000Z',
    evidence: `${target}-receipt`,
  });
}
assert.strictEqual(matrix.isReleaseComplete(manifest), true, 'all exact-version receipts must be required');

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-release-matrix-'));
try {
  for (const relativePath of ['package.json', 'backend/package.json', 'gateway/package.json', 'miniapp/package.json']) {
    const absolutePath = path.join(fixtureRoot, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, JSON.stringify({ version: relativePath === 'gateway/package.json' ? '7.1.9' : '7.2.0' }), 'utf8');
  }
  const localMatrix = matrix.readSourceVersionMatrix({ rootDir: fixtureRoot });
  assert.strictEqual(
    localMatrix.miniapp,
    '7.2.0',
    'the miniapp source package must participate in the unified version matrix'
  );
  assert.throws(
    () => matrix.assertSourceVersionMatrix(localMatrix, '7.2.0'),
    /gateway.*7\.1\.9/i,
    'a source version mismatch must name the stale component'
  );

  const manifestPath = matrix.defaultManifestPath(fixtureRoot);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  matrix.writeManifest(manifestPath, matrix.createReleaseManifest({ version: '7.2.0', commit: 'abc123' }));
  assert.throws(
    () => matrix.assertReleaseTarget({ rootDir: fixtureRoot, target: 'desktop' }),
    /gateway.*7\.1\.9/i,
    'every release entrypoint must reject a stale source component'
  );

  for (const relativePath of ['gateway/package.json']) {
    const absolutePath = path.join(fixtureRoot, relativePath);
    fs.writeFileSync(absolutePath, JSON.stringify({ version: '7.2.0' }), 'utf8');
  }
  const cloudAcceptanceManifest = matrix.createReleaseManifest({ version: '7.2.0', commit: 'abc123' });
  assert.throws(
    () => matrix.assertDesktopReleasePrerequisites({ rootDir: fixtureRoot, manifest: cloudAcceptanceManifest }),
    /backend.*verified/i,
    'OSS publication must fail closed until the cloud API and miniapp pairing endpoints are exact-version ready'
  );
  for (const target of ['backend', 'gateway', 'miniapp']) {
    matrix.recordReceipt(cloudAcceptanceManifest, {
      target, version: '7.2.0', evidence: `${target}-ready`,
    });
  }
  assert.strictEqual(
    matrix.assertDesktopReleasePrerequisites({ rootDir: fixtureRoot, manifest: cloudAcceptanceManifest }).version,
    '7.2.0',
    'one unified desktop update may publish only after its cloud prerequisites are verified'
  );
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}

assert.throws(
  () => matrix.resolveManifestVersion({ manifest: matrix.createReleaseManifest({ version: '7.2.0', commit: 'abc123' }), requestedVersion: '7.2.1' }),
  /version mismatch/i,
  'manual endpoint versions must not override the release manifest'
);

console.log('release matrix checks passed');
