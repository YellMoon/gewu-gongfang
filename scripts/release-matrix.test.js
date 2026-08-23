const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const matrix = require('./release-matrix');

const targets = matrix.DEFAULT_TARGETS;
assert.deepStrictEqual(
  targets,
  ['desktop', 'cloud_business', 'storage_proxy', 'miniapp'],
  'the unified release matrix must model the current cloud-authority architecture, not retired host/gateway services'
);
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
    releaseLevel: target === 'miniapp' ? 'production' : undefined,
  });
}
assert.strictEqual(matrix.isReleaseComplete(manifest), true, 'all exact-version receipts must be required');

const developmentUploadedManifest = matrix.createReleaseManifest({
  version: '7.2.0',
  commit: 'development-upload-commit',
});
for (const target of ['desktop', 'cloud_business', 'storage_proxy']) {
  matrix.recordReceipt(developmentUploadedManifest, {
    target,
    version: '7.2.0',
    evidence: `${target}-receipt`,
  });
}
matrix.recordReceipt(developmentUploadedManifest, {
  target: 'miniapp',
  version: '7.2.0',
  evidence: 'miniprogram-ci development upload confirmed',
  releaseLevel: 'development',
});
assert.strictEqual(
  matrix.isReleaseComplete(developmentUploadedManifest),
  false,
  'a miniapp development upload is not a formal cross-platform release'
);
matrix.recordReceipt(developmentUploadedManifest, {
  target: 'miniapp',
  version: '7.2.0',
  evidence: 'WeChat production release confirmed',
  releaseLevel: 'production',
});
assert.strictEqual(
  matrix.isReleaseComplete(developmentUploadedManifest),
  true,
  'only a WeChat production receipt may complete the unified release'
);

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-release-matrix-'));
try {
  for (const relativePath of ['package.json', 'cloud-business-api/package.json', 'miniapp/package.json']) {
    const absolutePath = path.join(fixtureRoot, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(
      absolutePath,
      JSON.stringify({ version: relativePath === 'cloud-business-api/package.json' ? '7.1.9' : '7.2.0' }),
      'utf8'
    );
  }
  const localMatrix = matrix.readSourceVersionMatrix({ rootDir: fixtureRoot });
  assert.strictEqual(
    localMatrix.miniapp,
    '7.2.0',
    'the miniapp source package must participate in the unified version matrix'
  );
  assert.throws(
    () => matrix.assertSourceVersionMatrix(localMatrix, '7.2.0'),
    /cloud_business.*7\.1\.9/i,
    'a source version mismatch must name the stale component'
  );

  const manifestPath = matrix.defaultManifestPath(fixtureRoot);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  matrix.writeManifest(manifestPath, matrix.createReleaseManifest({ version: '7.2.0', commit: 'abc123' }));
  assert.throws(
    () => matrix.assertReleaseTarget({ rootDir: fixtureRoot, target: 'desktop' }),
    /cloud_business.*7\.1\.9/i,
    'every release entrypoint must reject a stale source component'
  );

  for (const relativePath of ['cloud-business-api/package.json']) {
    const absolutePath = path.join(fixtureRoot, relativePath);
    fs.writeFileSync(absolutePath, JSON.stringify({ version: '7.2.0' }), 'utf8');
  }
  const cloudAcceptanceManifest = matrix.createReleaseManifest({ version: '7.2.0', commit: 'abc123' });
  assert.throws(
    () => matrix.assertDesktopReleasePrerequisites({ rootDir: fixtureRoot, manifest: cloudAcceptanceManifest }),
    /cloud_business.*verified/i,
    'OSS publication must fail closed until cloud business, storage proxy, and miniapp are exact-version ready'
  );
  for (const target of ['cloud_business', 'storage_proxy', 'miniapp']) {
    matrix.recordReceipt(cloudAcceptanceManifest, {
      target, version: '7.2.0', evidence: `${target}-ready`,
    });
  }
  assert.strictEqual(
    matrix.assertDesktopReleasePrerequisites({ rootDir: fixtureRoot, manifest: cloudAcceptanceManifest }).version,
    '7.2.0',
    'one unified desktop update may publish only after its cloud prerequisites are verified'
  );

  const supersededPending = matrix.prepareReleaseManifest({ rootDir: fixtureRoot, commit: 'new-source-commit' });
  assert.strictEqual(supersededPending.action, 'superseded-and-prepared',
    'a fully pending manifest for another source commit must never be reused');
  assert.ok(fs.existsSync(supersededPending.archivedManifestPath),
    'the unstarted manifest must be preserved before its active path is replaced');
  assert.strictEqual(matrix.readManifest(manifestPath).commit, 'new-source-commit',
    'the new active manifest must bind the current source commit');

  const partiallyPublished = matrix.createReleaseManifest({ version: '7.2.0', commit: 'partial-source' });
  matrix.recordReceipt(partiallyPublished, {
    target: 'cloud_business', version: '7.2.0', evidence: 'already-deployed',
  });
  matrix.writeManifest(manifestPath, partiallyPublished);
  assert.throws(
    () => matrix.prepareReleaseManifest({ rootDir: fixtureRoot, commit: 'other-source' }),
    /completed historical release manifest/i,
    'a partially published manifest must require explicit recovery rather than automatic replacement'
  );
  const recoveredPartial = matrix.recoverPartiallyPublishedManifest({
    rootDir: fixtureRoot,
    manifestPath,
    commit: 'recovered-source',
    reason: 'the deployed source commit changed before desktop publication',
  });
  assert.strictEqual(recoveredPartial.action, 'recovered-and-prepared',
    'an explicit recovery must create a fresh active manifest for the new source commit');
  assert.ok(fs.existsSync(recoveredPartial.archivedManifestPath),
    'the partially deployed manifest must be retained as a recovery record');
  const recoveryRecord = JSON.parse(fs.readFileSync(recoveredPartial.archivedManifestPath, 'utf8'));
  assert.strictEqual(recoveryRecord.recovery.reason, 'the deployed source commit changed before desktop publication',
    'the recovery archive must state why previously verified receipts were not reused');
  assert.strictEqual(matrix.readManifest(manifestPath).commit, 'recovered-source',
    'the recovered active manifest must bind the exact source commit being released');
  assert.ok(Object.values(matrix.readManifest(manifestPath).targets).every(target => target.status === 'pending'),
    'a recovered manifest must require fresh target receipts instead of carrying old verification forward');

  const developmentOnlyMiniapp = matrix.createReleaseManifest({ version: '7.2.0', commit: 'development-only-source' });
  for (const target of ['desktop', 'cloud_business', 'storage_proxy', 'miniapp']) {
    matrix.recordReceipt(developmentOnlyMiniapp, {
      target,
      version: '7.2.0',
      evidence: `${target}-deployed`,
      ...(target === 'miniapp' ? { releaseLevel: 'development' } : {}),
    });
  }
  assert.strictEqual(matrix.isReleaseComplete(developmentOnlyMiniapp), false,
    'a development-only miniapp receipt must keep an otherwise deployed release incomplete');
  matrix.writeManifest(manifestPath, developmentOnlyMiniapp);
  const recoveredDevelopmentOnly = matrix.recoverPartiallyPublishedManifest({
    rootDir: fixtureRoot,
    manifestPath,
    commit: 'development-only-recovered-source',
    reason: 'the WeChat production receipt was unavailable for an otherwise deployed release',
  });
  assert.ok(fs.existsSync(recoveredDevelopmentOnly.archivedManifestPath),
    'an incomplete development-only miniapp release must be recoverable without deleting its evidence');
  assert.strictEqual(matrix.readManifest(manifestPath).commit, 'development-only-recovered-source',
    'recovery must prepare a new manifest after preserving the development-only release record');

  const staleVersionPartial = matrix.createReleaseManifest({ version: '7.2.0', commit: 'old-version-partial' });
  matrix.recordReceipt(staleVersionPartial, {
    target: 'cloud_business', version: '7.2.0', evidence: 'old-version-cloud',
  });
  matrix.writeManifest(manifestPath, staleVersionPartial);
  for (const relativePath of ['package.json', 'cloud-business-api/package.json', 'miniapp/package.json']) {
    fs.writeFileSync(path.join(fixtureRoot, relativePath), JSON.stringify({ version: '7.2.1' }), 'utf8');
  }
  const recoveredStaleVersion = matrix.recoverPartiallyPublishedManifest({
    rootDir: fixtureRoot,
    manifestPath,
    commit: 'new-version-source',
    reason: 'the audited patch release supersedes an incomplete older version',
  });
  assert.strictEqual(recoveredStaleVersion.action, 'recovered-and-prepared',
    'an explicit recovery must permit a new source version after preserving the partial old release');
  const staleVersionArchive = JSON.parse(fs.readFileSync(recoveredStaleVersion.archivedManifestPath, 'utf8'));
  assert.strictEqual(staleVersionArchive.version, '7.2.0', 'the archived partial release must retain its original version');
  assert.strictEqual(matrix.readManifest(manifestPath).version, '7.2.1',
    'the active manifest must bind the newer source version rather than reusing old receipts');

  const completedHistoricalManifest = {
    schema: matrix.MANIFEST_SCHEMA,
    version: '7.1.9',
    commit: 'oldcommit',
    createdAt: '2026-07-01T00:00:00.000Z',
    targets: Object.fromEntries(['desktop', 'local_host', 'backend', 'gateway', 'miniapp'].map(target => [target, {
      status: 'verified',
      receipt: {
        version: '7.1.9',
        verifiedAt: '2026-07-01T01:00:00.000Z',
        evidence: `${target}-historical`,
        ...(target === 'miniapp' ? { releaseLevel: 'production' } : {}),
      },
    }])),
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(completedHistoricalManifest, null, 2)}\n`, 'utf8');
  const prepared = matrix.prepareReleaseManifest({ rootDir: fixtureRoot, commit: 'newcommit' });
  assert.strictEqual(prepared.manifest.version, '7.2.1', 'a new source version must create a fresh release manifest');
  assert.ok(fs.existsSync(prepared.archivedManifestPath), 'a completed historical manifest must be preserved before replacement');
  assert.strictEqual(matrix.readManifest(manifestPath).version, '7.2.1', 'the active path must point only to the new release');
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}

assert.throws(
  () => matrix.resolveManifestVersion({ manifest: matrix.createReleaseManifest({ version: '7.2.0', commit: 'abc123' }), requestedVersion: '7.2.1' }),
  /version mismatch/i,
  'manual endpoint versions must not override the release manifest'
);

console.log('release matrix checks passed');
