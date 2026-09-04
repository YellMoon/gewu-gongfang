const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const matrix = require('./release-matrix');

const runtimeParserSha256 = 'f'.repeat(64);
const runtimeReceiptEvidence = Object.freeze({
  receiptId: 'storage_runtime_receipt_abcdefgh',
  agentId: 'storage-agent-1',
  agentVersion: '8.8.2',
  contracts: { questionPaperExport: 3, storageAgentTransport: 3, questionImportParserProof: 1 },
  parserSha256: runtimeParserSha256,
  observedAt: '2026-09-05T00:00:00.000Z',
});

const targets = matrix.DEFAULT_TARGETS;
const versions = {
  desktop: '7.2.0',
  cloud_business: '7.1.9',
  storage_proxy: '7.0.4',
  miniapp: '7.3.1',
};
const manifest = matrix.createReleaseManifest({ componentVersions: versions, commit: 'abc123' });
const reviewedCompatibility = matrix.readCompatibilityDeclaration();

assert.deepStrictEqual(
  reviewedCompatibility.contracts.desktopCloudSession,
  {
    version: '1',
    participants: ['desktop', 'cloud_business'],
    rule: 'desktop login verifies the cloud account before silently registering the device and installation; restart challenges and role switching are cloud-authoritative',
  },
  'desktop session and silent device registration compatibility must be reviewed independently of component versions',
);
assert.deepStrictEqual(
  reviewedCompatibility.contracts.questionBankBrowse,
  {
    version: '1',
    participants: ['desktop', 'cloud_business', 'miniapp'],
    rule: 'desktop and miniapp render the same cloud-authoritative question structure, option semantics, filters, basket identities, answers, explanations, and source metadata',
  },
  'cross-end question browsing and basket semantics must be part of the reviewed compatibility declaration',
);
assert.deepStrictEqual(
  reviewedCompatibility.contracts.identityRoleModel,
  {
    version: '2',
    participants: ['desktop', 'cloud_business', 'miniapp'],
    rule: 'formal grants are exactly super_admin, teacher, student, and family_member; visitor has no formal grant; family_member keeps guardian-scoped linked-student data access',
  },
  'the family-member grant and visitor no-grant model must be reviewed across every identity consumer',
);

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
const missingStorageRuntimeManifest = matrix.createReleaseManifest({ componentVersions: versions, commit: 'runtime-version-required' });
assert.throws(
  () => matrix.recordReceipt(missingStorageRuntimeManifest, {
    target: 'storage_proxy',
    version: versions.storage_proxy,
    runtimeContracts: { questionPaperExport: '3', storageAgentTransport: '3', questionImportParserProof: '1' },
    evidence: 'component receipt without live runtime version',
  }),
  /runtime version is required/i,
  'a declared runtime-receipt target must include the live runtime version',
);
const persistedMissingStorageRuntimeManifest = matrix.createReleaseManifest({ componentVersions: versions, commit: 'persisted-runtime-version-required' });
persistedMissingStorageRuntimeManifest.targets.storage_proxy = {
  status: 'verified',
  receipt: {
    version: versions.storage_proxy,
    verifiedAt: new Date().toISOString(),
    evidence: 'persisted component receipt without live runtime version',
    compatibility: persistedMissingStorageRuntimeManifest.compatibility.schema,
  },
};
assert.match(
  matrix.validateManifest(persistedMissingStorageRuntimeManifest).issues.join('; '),
  /runtime version is required/i,
  'persisted receipts must be rejected when the declared runtime target lacks a live runtime version',
);
const matchingStorageVersionManifest = matrix.createReleaseManifest({
  componentVersions: { ...versions, storage_proxy: '8.8.2' },
  commit: 'matching-runtime-still-requires-contracts',
});
assert.throws(
  () => matrix.recordReceipt(matchingStorageVersionManifest, {
    target: 'storage_proxy',
    version: '8.8.2',
    runtimeVersion: '8.8.2',
    evidence: 'matching component and runtime version without contracts',
  }),
  /runtime contract receipt is incompatible/i,
  'matching component and runtime versions must not bypass exact runtime contracts',
);
assert.throws(
  () => matrix.recordReceipt(matrix.createReleaseManifest({
    componentVersions: { ...versions, storage_proxy: '8.8.2' },
    commit: 'matching-runtime-extra-contract',
  }), {
    target: 'storage_proxy',
    version: '8.8.2',
    runtimeVersion: '8.8.2',
    runtimeContracts: { questionPaperExport: '3', storageAgentTransport: '3', questionImportParserProof: '1', unreviewedContract: '1' },
    evidence: 'matching component and runtime version with an extra contract',
  }),
  /runtime contract receipt is incompatible/i,
  'declared runtime contracts must match exactly even when component and runtime versions are equal',
);
const compatibleRuntimeManifest = matrix.createReleaseManifest({ componentVersions: versions, commit: 'runtime-compatibility' });
matrix.recordReceipt(compatibleRuntimeManifest, {
  target: 'storage_proxy',
  version: versions.storage_proxy,
  runtimeVersion: '8.8.2',
  runtimeContracts: { questionPaperExport: '3', storageAgentTransport: '3', questionImportParserProof: '1' },
  parserSha256: runtimeParserSha256,
  runtimeReceipt: runtimeReceiptEvidence,
  evidence: 'storage runtime health and live import acceptance',
});
assert.strictEqual(compatibleRuntimeManifest.targets.storage_proxy.receipt.version, versions.storage_proxy,
  'the receipt keeps the source release version distinct from the running storage runtime');
assert.strictEqual(compatibleRuntimeManifest.targets.storage_proxy.receipt.runtimeVersion, '8.8.2',
  'the receipt records the independently deployed storage runtime version');
assert.strictEqual(compatibleRuntimeManifest.targets.storage_proxy.receipt.parserSha256, runtimeParserSha256,
  'the release receipt must retain the exact parser digest reported by the running storage agent');
assert.deepStrictEqual(compatibleRuntimeManifest.targets.storage_proxy.receipt.runtimeReceipt, runtimeReceiptEvidence,
  'the release receipt must retain the cloud-issued receipt identity, agent identity, and observation time');
assert.deepStrictEqual(matrix.validateManifest(compatibleRuntimeManifest).issues, [],
  'an approved storage runtime receipt keeps the release manifest valid');
assert.throws(
  () => matrix.recordReceipt(matrix.createReleaseManifest({ componentVersions: versions, commit: 'spliced-runtime-version' }), {
    target: 'storage_proxy', version: versions.storage_proxy, runtimeVersion: '8.8.2',
    runtimeContracts: { questionPaperExport: '3', storageAgentTransport: '3', questionImportParserProof: '1' },
    parserSha256: runtimeParserSha256,
    runtimeReceipt: { ...runtimeReceiptEvidence, agentVersion: '8.8.1' },
    evidence: 'spliced runtime version',
  }),
  /runtime receipt does not match/i,
  'a receipt id from another runtime version must not be combined with hand-supplied v3 fields',
);
assert.throws(
  () => matrix.recordReceipt(matrix.createReleaseManifest({ componentVersions: versions, commit: 'spliced-runtime-contracts' }), {
    target: 'storage_proxy', version: versions.storage_proxy, runtimeVersion: '8.8.2',
    runtimeContracts: { questionPaperExport: '3', storageAgentTransport: '3', questionImportParserProof: '1' },
    parserSha256: runtimeParserSha256,
    runtimeReceipt: { ...runtimeReceiptEvidence, contracts: { questionPaperExport: 3, storageAgentTransport: 2 } },
    evidence: 'spliced runtime contracts',
  }),
  /runtime receipt does not match/i,
  'a v2 receipt must not be combined with hand-supplied v3 contracts',
);
assert.throws(
  () => matrix.recordReceipt(matrix.createReleaseManifest({ componentVersions: versions, commit: 'spliced-parser-proof' }), {
    target: 'storage_proxy', version: versions.storage_proxy, runtimeVersion: '8.8.2',
    runtimeContracts: { questionPaperExport: '3', storageAgentTransport: '3', questionImportParserProof: '1' },
    parserSha256: runtimeParserSha256,
    runtimeReceipt: { ...runtimeReceiptEvidence, parserSha256: 'e'.repeat(64) },
    evidence: 'spliced parser proof',
  }),
  /runtime receipt does not match/i,
  'a runtime receipt must carry the same parser digest recorded at the release boundary',
);
const currentStorageRuntimeManifest = matrix.createReleaseManifest({ componentVersions: versions, commit: 'current-storage-runtime' });
matrix.recordReceipt(currentStorageRuntimeManifest, {
  target: 'storage_proxy',
  version: versions.storage_proxy,
  runtimeVersion: '8.8.2',
  runtimeContracts: { questionPaperExport: '3', storageAgentTransport: '3', questionImportParserProof: '1' },
  parserSha256: runtimeParserSha256,
  runtimeReceipt: runtimeReceiptEvidence,
  evidence: 'storage runtime health and live import acceptance for the current NAS candidate',
});
assert.deepStrictEqual(matrix.validateManifest(currentStorageRuntimeManifest).issues, [],
  'the current NAS storage runtime must be explicitly approved for a release receipt');
compatibleRuntimeManifest.targets.storage_proxy.receipt.runtimeContracts.questionPaperExport = '2';
assert.match(matrix.validateManifest(compatibleRuntimeManifest).issues.join('; '), /runtime contract receipt is incompatible/i,
  'a persisted runtime receipt is revalidated instead of being trusted after record time');
compatibleRuntimeManifest.targets.storage_proxy.receipt.runtimeContracts.questionPaperExport = '3';
compatibleRuntimeManifest.targets.storage_proxy.receipt.parserSha256 = 'invalid';
assert.match(matrix.validateManifest(compatibleRuntimeManifest).issues.join('; '), /parser sha-256 is invalid/i,
  'a persisted runtime receipt with a malformed parser digest must be rejected');
compatibleRuntimeManifest.targets.storage_proxy.receipt.parserSha256 = runtimeParserSha256;
compatibleRuntimeManifest.targets.storage_proxy.receipt.runtimeReceipt = { ...runtimeReceiptEvidence, receiptId: '' };
assert.match(matrix.validateManifest(compatibleRuntimeManifest).issues.join('; '), /runtime receipt identity is invalid/i,
  'a persisted release receipt must revalidate the cloud-issued runtime receipt id');
compatibleRuntimeManifest.targets.storage_proxy.receipt.runtimeReceipt = { ...runtimeReceiptEvidence };
compatibleRuntimeManifest.targets.storage_proxy.receipt.runtimeReceipt.observedAt = 'not-an-instant';
assert.match(matrix.validateManifest(compatibleRuntimeManifest).issues.join('; '), /runtime receipt identity is invalid/i,
  'a persisted release receipt must revalidate the runtime observation timestamp');
compatibleRuntimeManifest.targets.storage_proxy.receipt.runtimeReceipt = { ...runtimeReceiptEvidence };
assert.throws(
  () => matrix.recordReceipt(matrix.createReleaseManifest({ componentVersions: versions, commit: 'runtime-incompatible' }), {
    target: 'storage_proxy', version: versions.storage_proxy, runtimeVersion: '8.7.25',
    runtimeContracts: { questionPaperExport: '3', storageAgentTransport: '1' }, evidence: 'old runtime',
  }),
  /runtime version is not approved/i,
  'an unreviewed storage runtime must not satisfy a desktop release prerequisite',
);
assert.throws(
  () => matrix.recordReceipt(matrix.createReleaseManifest({ componentVersions: versions, commit: 'runtime-contract-missing' }), {
    target: 'storage_proxy', version: versions.storage_proxy, runtimeVersion: '8.8.2',
    runtimeContracts: { questionPaperExport: '2', storageAgentTransport: '3', questionImportParserProof: '1' }, evidence: 'wrong protocol',
  }),
  /runtime contract receipt is incompatible/i,
  'a matching version alone must not bypass the reviewed protocol contract',
);
for (const target of targets) {
  matrix.recordReceipt(manifest, {
    target,
    version: versions[target],
    evidence: `${target} receipt`,
    ...(target === 'storage_proxy' ? {
      runtimeVersion: '8.8.2',
      runtimeContracts: { questionPaperExport: '3', storageAgentTransport: '3', questionImportParserProof: '1' },
      parserSha256: runtimeParserSha256,
      runtimeReceipt: runtimeReceiptEvidence,
    } : {}),
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

function copyManifest(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertForgedReceiptRejected({ target = 'desktop', mutate, issue, message }) {
  const forged = copyManifest(manifest);
  mutate(forged.targets[target].receipt);
  assert.match(matrix.validateManifest(forged).issues.join('; '), issue, message);
  assert.strictEqual(matrix.isReleaseComplete(forged), false, `${message}; it must not complete the release`);
}

assertForgedReceiptRejected({
  mutate: receipt => { delete receipt.evidence; },
  issue: /receipt evidence is required/i,
  message: 'a persisted verified receipt without evidence must be rejected',
});
assertForgedReceiptRejected({
  mutate: receipt => { receipt.evidence = ' \t '; },
  issue: /receipt evidence is required/i,
  message: 'whitespace-only persisted receipt evidence must be rejected',
});
assertForgedReceiptRejected({
  mutate: receipt => { delete receipt.verifiedAt; },
  issue: /verifiedAt must be a valid ISO timestamp/i,
  message: 'a persisted verified receipt without verifiedAt must be rejected',
});
assertForgedReceiptRejected({
  mutate: receipt => { receipt.verifiedAt = '2026-99-99T25:61:61Z'; },
  issue: /verifiedAt must be a valid ISO timestamp/i,
  message: 'a persisted verified receipt with an invalid ISO verifiedAt must be rejected',
});
assertForgedReceiptRejected({
  mutate: receipt => { delete receipt.compatibility; },
  issue: /receipt compatibility must match/i,
  message: 'a persisted verified receipt without compatibility must be rejected',
});
assertForgedReceiptRejected({
  mutate: receipt => { receipt.compatibility = 'gewu.protocol-data-compatibility.v0'; },
  issue: /receipt compatibility must match/i,
  message: 'a persisted verified receipt with mismatched compatibility must be rejected',
});
assertForgedReceiptRejected({
  target: 'miniapp',
  mutate: receipt => { delete receipt.releaseLevel; },
  issue: /miniapp release receipt must declare development or production/i,
  message: 'a persisted verified miniapp receipt without releaseLevel must be rejected',
});
assertForgedReceiptRejected({
  target: 'miniapp',
  mutate: receipt => { receipt.releaseLevel = 'staging'; },
  issue: /miniapp release receipt must declare development or production/i,
  message: 'a persisted verified miniapp receipt with an unknown releaseLevel must be rejected',
});

assert.throws(
  () => matrix.recordReceipt(matrix.createReleaseManifest({ componentVersions: versions, commit: 'blank-evidence' }), {
    target: 'desktop', version: versions.desktop, evidence: ' \r\n ',
  }),
  /receipt evidence is required/i,
  'recording a receipt must reuse the persisted-receipt rule for blank evidence',
);
assert.throws(
  () => matrix.recordReceipt(matrix.createReleaseManifest({ componentVersions: versions, commit: 'invalid-verified-at' }), {
    target: 'desktop', version: versions.desktop, evidence: 'desktop verification', verifiedAt: 'yesterday',
  }),
  /verifiedAt must be a valid ISO timestamp/i,
  'recording a receipt must reuse the persisted-receipt rule for verifiedAt',
);

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
  const writePaths = [];
  const renamePairs = [];
  const originalWriteFileSync = fs.writeFileSync;
  const originalRenameSync = fs.renameSync;
  fs.writeFileSync = (filePath, ...args) => {
    writePaths.push(path.resolve(filePath));
    return originalWriteFileSync(filePath, ...args);
  };
  fs.renameSync = (sourcePath, destinationPath) => {
    renamePairs.push([path.resolve(sourcePath), path.resolve(destinationPath)]);
    return originalRenameSync(sourcePath, destinationPath);
  };
  try {
    matrix.writeManifest(manifestPath, matrix.createReleaseManifest({ componentVersions: versions, commit: 'abc123' }));
  } finally {
    fs.writeFileSync = originalWriteFileSync;
    fs.renameSync = originalRenameSync;
  }
  assert.strictEqual(writePaths.length, 1, 'a manifest write uses one temporary file');
  assert.notStrictEqual(writePaths[0], path.resolve(manifestPath), 'the manifest is not written directly in place');
  assert.strictEqual(path.dirname(writePaths[0]), path.dirname(path.resolve(manifestPath)),
    'the temporary manifest is written in the destination directory');
  assert.deepStrictEqual(renamePairs, [[writePaths[0], path.resolve(manifestPath)]],
    'the same-directory temporary manifest atomically replaces the destination');
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
    matrix.recordReceipt(pending, {
      target,
      version: versions[target],
      evidence: `${target} compatible`,
      ...(target === 'storage_proxy' ? {
        runtimeVersion: '8.8.2',
        runtimeContracts: { questionPaperExport: '3', storageAgentTransport: '3', questionImportParserProof: '1' },
        parserSha256: runtimeParserSha256,
        runtimeReceipt: runtimeReceiptEvidence,
      } : {}),
    });
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
