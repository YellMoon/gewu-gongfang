const assert = require('assert');
const matrix = require('./release-matrix');

const componentVersions = {
  desktop: '8.7.21',
  cloud_business: '8.8.0',
  storage_proxy: '8.7.4',
  miniapp: '8.7.9',
};

const manifest = matrix.createReleaseManifest({
  componentVersions,
  commit: 'independent-component-version-test',
  createdAt: '2026-08-28T00:00:00.000Z',
});

assert.strictEqual(manifest.schema, 'gewu.release-compatibility.v2');
assert.deepStrictEqual(manifest.componentVersions, componentVersions,
  'the release ledger must retain each deployed component version independently');
assert.deepStrictEqual(matrix.validateManifest(manifest).issues, [],
  'different component versions are valid when their protocol/data contract is declared');

for (const target of matrix.DEFAULT_TARGETS) {
  matrix.recordReceipt(manifest, {
    target,
    version: componentVersions[target],
    evidence: `${target} compatible receipt`,
    ...(target === 'storage_proxy' ? {
      runtimeVersion: '8.8.2',
      runtimeContracts: { questionPaperExport: '3', storageAgentTransport: '3', questionImportParserProof: '1' },
      parserSha256: 'f'.repeat(64),
      runtimeReceipt: {
        receiptId: 'storage_runtime_receipt_abcdefgh', agentId: 'storage-agent-1', agentVersion: '8.8.2',
        contracts: { questionPaperExport: 3, storageAgentTransport: 3, questionImportParserProof: 1 },
        parserSha256: 'f'.repeat(64), observedAt: '2026-09-05T00:00:00.000Z',
      },
    } : {}),
    ...(target === 'miniapp' ? { releaseLevel: 'production' } : {}),
  });
}
assert.strictEqual(matrix.isReleaseComplete(manifest), true,
  'completion requires a receipt for each component’s own version, not equal versions');

const wrongReceiptManifest = matrix.createReleaseManifest({
  componentVersions,
  commit: 'wrong-component-receipt-test',
});
assert.throws(
  () => matrix.recordReceipt(wrongReceiptManifest, {
    target: 'cloud_business',
    version: componentVersions.desktop,
    evidence: 'incorrectly used desktop version',
  }),
  /cloud_business.*version mismatch/i,
  'a cloud receipt must not be accepted under the desktop version',
);

const incompatible = structuredClone(manifest);
incompatible.compatibility.contracts.cloudBusinessRest.version = '999';
assert.match(matrix.validateManifest(incompatible).issues.join('; '), /compatibility/i,
  'the release ledger must reject an undeclared protocol/data compatibility revision');

console.log('independent release version checks passed');
