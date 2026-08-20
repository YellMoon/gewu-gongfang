'use strict';

const assert = require('assert');
const { createHash } = require('crypto');
const {
  validateBusinessFoundationAdmissionBatchRequest,
} = require('./businessFoundationAdmissionBatchRequest');

const HASH = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function batchRequest(overrides = {}) {
  const request = {
    batchId: 'synthetic-batch-1',
    sourceSnapshotSha256: HASH,
    sourceInventoryBeforeSha256: HASH_B,
    sourceInventoryAfterSha256: HASH_B,
    sourceCatalogSha256: HASH,
    sourceContractSha256: HASH,
    sourceSchemaSha256: HASH,
    businessManifestSha256: HASH,
    mapperSetSha256: HASH,
    consentSha256: HASH,
    shadowTargetIdentitySha256: HASH_C,
    createdAt: '2026-08-21T00:00:00.000Z',
    ...overrides,
  };
  const canonical = JSON.stringify({
    batchId: request.batchId,
    sourceSnapshotSha256: request.sourceSnapshotSha256,
    sourceInventoryBeforeSha256: request.sourceInventoryBeforeSha256,
    sourceInventoryAfterSha256: request.sourceInventoryAfterSha256,
    sourceCatalogSha256: request.sourceCatalogSha256,
    sourceContractSha256: request.sourceContractSha256,
    sourceSchemaSha256: request.sourceSchemaSha256,
    businessManifestSha256: request.businessManifestSha256,
    mapperSetSha256: request.mapperSetSha256,
    consentSha256: request.consentSha256,
    shadowTargetIdentitySha256: request.shadowTargetIdentitySha256,
    createdAt: request.createdAt,
  });
  return { ...request, batchRequestSha256: sha256(canonical) };
}

function expectInvalid(value, code = 'VNEXT_PG17_ADMISSION_INPUT_INVALID') {
  assert.throws(
    () => validateBusinessFoundationAdmissionBatchRequest(value),
    error => error && error.code === code,
  );
}

function runBusinessFoundationAdmissionBatchRequestCases() {
  const valid = batchRequest();
  const result = validateBusinessFoundationAdmissionBatchRequest(valid);
  assert.ok(Object.isFrozen(result));
  assert.deepStrictEqual(result, valid);

  expectInvalid({ ...valid, mapperSetSha256: HASH_B });
  expectInvalid(batchRequest({ sourceInventoryAfterSha256: HASH_C }), 'VNEXT_PG17_ADMISSION_SOURCE_SNAPSHOT_CHANGED');
  expectInvalid({ ...valid, unexpected: true });

  let getterReads = 0;
  const accessor = Object.defineProperty({ ...valid }, 'sourceCatalogSha256', {
    enumerable: true,
    get() {
      getterReads += 1;
      throw new Error('must not read accessor');
    },
  });
  expectInvalid(accessor);
  assert.strictEqual(getterReads, 0);
  expectInvalid(new Proxy(valid, {}));
  class ForeignEnvelope {
    constructor(fields) {
      Object.assign(this, fields);
    }
  }
  expectInvalid(new ForeignEnvelope(valid));
}

if (require.main === module) {
  try {
    runBusinessFoundationAdmissionBatchRequestCases();
    process.stdout.write('vNext business foundation admission batch-request checks passed\n');
  } catch (error) {
    process.stderr.write(`${error.name}: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { runBusinessFoundationAdmissionBatchRequestCases };
