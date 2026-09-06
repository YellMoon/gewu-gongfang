'use strict';
require('./repair-question-formula-identities.test');

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');

const {
  BAD_QUESTION_IDS,
  CANONICAL_QUESTION_IDS,
  EXPECTED_QUESTION_IDENTITIES,
  EXPECTED_SNAPSHOT_SET_SHA256,
  buildDeleteCommand,
  validateInventory,
  questionIdentitySetSha256,
  repairQuestions,
  loadProductionInventory,
  validateRepairReceipts,
} = require('./repair-production-question-duplicates');

function row(id, { optionCount, version, deleted = false, contentDeleted = false, snapshotRefs = 0, assetCount = 0 } = {}) {
  const identity = EXPECTED_QUESTION_IDENTITIES[id] || {
    source: 'unexpected.docx', version: 2, contentHash: 'f'.repeat(64),
  };
  return {
    id,
    source: identity.source,
    contentHash: identity.contentHash,
    status: 'published',
    deleted,
    contentDeleted,
    optionCount,
    version: version ?? identity.version,
    snapshotRefs,
    assetCount,
    snapshotTaskCount: 2,
    snapshotSetSha256: EXPECTED_SNAPSHOT_SET_SHA256,
    activePublishedCount: 16,
    activePublishedOptionCount: 29,
    activePublishedSourceCount: 2,
  };
}

function withPublishedTotals(rows) {
  const active = rows.filter(item => !item.deleted && !item.contentDeleted && item.status === 'published');
  const activePublishedCount = active.length;
  const activePublishedOptionCount = active.reduce((total, item) => total + item.optionCount, 0);
  return rows.map(item => ({ ...item, activePublishedCount, activePublishedOptionCount, activePublishedSourceCount: 2 }));
}

function storedReceiptFor(repairedRow) {
  const command = buildDeleteCommand(repairedRow.id, repairedRow.version - 1);
  const result = { id: repairedRow.id, status: repairedRow.status, version: repairedRow.version, contentHash: repairedRow.contentHash };
  return {
    commandId: command.commandId,
    payloadHash: command.payloadHash,
    status: 'committed',
    result,
    resultHash: crypto.createHash('sha256').update(JSON.stringify({
      contentHash: result.contentHash, id: result.id, status: result.status, version: result.version,
    }), 'utf8').digest('hex'),
  };
}

const malformedRows = BAD_QUESTION_IDS.map((id, index) => row(id, {
  optionCount: index < 7 ? 1 : 2,
  snapshotRefs: [BAD_QUESTION_IDS[4], BAD_QUESTION_IDS[11]].includes(id) ? 2 : 0,
}));
const canonicalRows = CANONICAL_QUESTION_IDS.map(id => row(id, { optionCount: 4, snapshotRefs: 2 }));

assert.strictEqual(BAD_QUESTION_IDS.length, 14);
assert.strictEqual(new Set(BAD_QUESTION_IDS).size, 14);
assert.strictEqual(CANONICAL_QUESTION_IDS.length, 2);
assert.strictEqual(new Set([...BAD_QUESTION_IDS, ...CANONICAL_QUESTION_IDS]).size, 16);
const repairSource = fs.readFileSync(require.resolve('./repair-production-question-duplicates'), 'utf8');
assert.ok(repairSource.includes('const client = await appPool.connect()'),
  'the repair transaction must use the deployed cloud question authority database role');
assert.ok(repairSource.includes('pg_advisory_xact_lock') && repairSource.includes("client.query('ROLLBACK')"),
  'all question deletions and command receipts must share one serialized rollback-capable transaction');
assert.ok(!repairSource.includes('runOnlineRegistrationAcceptance') && !repairSource.includes('SET LOCAL ROLE'),
  'the maintenance path must not create fake devices or rely on temporary owner membership');

const beforeRows = withPublishedTotals([...malformedRows, ...canonicalRows]);
const targetIdentitySetSha256 = questionIdentitySetSha256(beforeRows);
const inventory = validateInventory(beforeRows, { repaired: false });
assert.deepStrictEqual(inventory, {
  malformedActiveCount: 14,
  canonicalActiveCount: 2,
  snapshotReferenceCount: 4,
  snapshotTaskCount: 2,
  snapshotSetSha256: EXPECTED_SNAPSHOT_SET_SHA256,
  targetIdentitySetSha256,
  activePublishedCount: 16,
  activePublishedOptionCount: 29,
  activePublishedSourceCount: 2,
});

assert.throws(
  () => validateInventory(withPublishedTotals([...malformedRows.slice(1), ...canonicalRows]), { repaired: false }),
  error => error?.code === 'PRODUCTION_QUESTION_REPAIR_INVENTORY_MISMATCH',
);
assert.throws(
  () => validateInventory(withPublishedTotals([
    { ...malformedRows[0], contentHash: '0'.repeat(64) }, ...malformedRows.slice(1), ...canonicalRows,
  ]), { repaired: false }),
  error => error?.code === 'PRODUCTION_QUESTION_REPAIR_INVENTORY_MISMATCH',
  'an edited question with the same id and option count must never be deleted by the repair',
);
assert.throws(
  () => validateInventory(withPublishedTotals([...malformedRows, row('unexpected-question', { optionCount: 1 }), ...canonicalRows]), { repaired: false }),
  error => error?.code === 'PRODUCTION_QUESTION_REPAIR_INVENTORY_MISMATCH',
);
assert.throws(
  () => validateInventory(withPublishedTotals([...malformedRows, row(CANONICAL_QUESTION_IDS[0], { optionCount: 3 }), canonicalRows[1]]), { repaired: false }),
  error => error?.code === 'PRODUCTION_QUESTION_REPAIR_INVENTORY_MISMATCH',
);

const command = buildDeleteCommand(BAD_QUESTION_IDS[0], 7);
assert.strictEqual(command.type, 'question.delete.v1');
assert.deepStrictEqual(command.payload, { id: BAD_QUESTION_IDS[0], expectedVersion: 7 });
assert.match(command.commandId, /^question-production-repair-delete-[0-9a-f]{40}$/u);
assert.strictEqual(
  command.payloadHash,
  crypto.createHash('sha256').update(`{"payload":{"expectedVersion":7,"id":"${BAD_QUESTION_IDS[0]}"},"type":"question.delete.v1"}`, 'utf8').digest('hex'),
  'the command hash must use the shared recursively sorted canonical JSON contract',
);

(async () => {
  class PgResult {
    constructor(rows) { this.rows = rows; }
  }
  const loadedRows = await loadProductionInventory(async (sql, values) => {
    assert.match(sql, /activePublishedOptionCount/u);
    assert.deepStrictEqual(values[1], [...BAD_QUESTION_IDS, ...CANONICAL_QUESTION_IDS]);
    assert.deepStrictEqual(values[2], BAD_QUESTION_IDS);
    return new PgResult(beforeRows);
  }, 'default');
  assert.strictEqual(loadedRows, beforeRows, 'node-postgres Result instances are valid query results');

  let posted = 0;
  const before = beforeRows;
  const after = withPublishedTotals([
    ...malformedRows.map(item => ({ ...item, deleted: true, contentDeleted: true, version: item.version + 1 })),
    ...canonicalRows,
  ]);
  const afterReceipts = after.filter(item => BAD_QUESTION_IDS.includes(item.id)).map(storedReceiptFor);
  assert.strictEqual(validateRepairReceipts(afterReceipts, after).receiptCount, 14);
  let reads = 0;
  const receipt = await repairQuestions({
    mode: 'apply',
    loadInventory: async () => (reads++ === 0 ? before : after),
    loadReceipts: async () => (reads === 1 ? [] : afterReceipts),
    submitCommands: async commands => {
      for (const submitted of commands) {
        assert.ok(BAD_QUESTION_IDS.includes(submitted.payload.id));
        assert.strictEqual(submitted.payload.expectedVersion, 2);
      }
      posted += commands.length;
      return commands.map(() => ({ status: 'committed' }));
    },
  });
  assert.strictEqual(posted, 14);
  assert.strictEqual(receipt.mode, 'apply');
  assert.strictEqual(receipt.deletedCount, 14);
  assert.strictEqual(receipt.canonicalActiveCount, 2);
  assert.strictEqual(receipt.snapshotReferenceCount, 4);
  assert.strictEqual(receipt.snapshotSetSha256, EXPECTED_SNAPSHOT_SET_SHA256);
  assert.strictEqual(receipt.targetIdentitySetSha256, targetIdentitySetSha256);
  assert.strictEqual(receipt.activePublishedCount, 2);
  assert.strictEqual(receipt.activePublishedOptionCount, 8);
  assert.strictEqual(receipt.commandReceiptCount, 14);
  assert.match(receipt.commandReceiptSetSha256, /^[0-9a-f]{64}$/u);

  let dryRunSubmitted = false;
  const dryRun = await repairQuestions({
    mode: 'dry-run',
    loadInventory: async () => before,
    loadReceipts: async () => [],
    submitCommands: async () => { dryRunSubmitted = true; throw new Error('must not write during dry-run'); },
  });
  assert.strictEqual(dryRunSubmitted, false);
  assert.deepStrictEqual(dryRun, {
    ok: true,
    mode: 'dry-run',
    ready: true,
    malformedActiveCount: 14,
    canonicalActiveCount: 2,
    snapshotReferenceCount: 4,
    snapshotTaskCount: 2,
    snapshotSetSha256: EXPECTED_SNAPSHOT_SET_SHA256,
    targetIdentitySetSha256,
    activePublishedCount: 16,
    activePublishedOptionCount: 29,
    activePublishedSourceCount: 2,
    commandReceiptCount: 0,
    commandReceiptSetSha256: null,
  });

  let resumedPosts = 0;
  let resumeReads = 0;
  const partial = withPublishedTotals([
    { ...malformedRows[0], deleted: true, contentDeleted: true, version: malformedRows[0].version + 1 },
    ...malformedRows.slice(1),
    ...canonicalRows,
  ]);
  const resumed = await repairQuestions({
    mode: 'apply',
    loadInventory: async () => (resumeReads++ === 0 ? partial : after),
    loadReceipts: async () => (resumeReads === 1 ? [storedReceiptFor(partial[0])] : afterReceipts),
    submitCommands: async commands => { resumedPosts += commands.length; return commands.map(() => ({ status: 'committed' })); },
  });
  assert.strictEqual(resumedPosts, 13, 'a guarded retry must resume only the remaining active malformed questions');
  assert.strictEqual(resumed.deletedCount, 14);

  await assert.rejects(
    () => repairQuestions({
      mode: 'apply',
      loadInventory: async () => before,
      loadReceipts: async () => [],
      submitCommands: async () => { throw Object.assign(new Error('failed'), { code: 'ATOMIC_BATCH_FAILED' }); },
    }),
    error => error?.code === 'ATOMIC_BATCH_FAILED',
  );

  console.log('repair-production-question-duplicates tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
