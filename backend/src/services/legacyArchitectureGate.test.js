const assert = require('assert');
const { createLegacyArchitectureGate } = require('./legacyArchitectureGate');

function invoke(gate, method, cutover) {
  const response = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
  let next = false;
  gate({ method }, response, () => { next = true; });
  return { response, next };
}

const preMarker = createLegacyArchitectureGate({ db: { prepare: () => ({ get: () => undefined }) } });
assert.strictEqual(invoke(preMarker, 'GET').next, true);
const preWrite = invoke(preMarker, 'POST');
assert.strictEqual(preWrite.response.statusCode, 409);
assert.strictEqual(preWrite.response.body.error.code, 'AUTHORITY_PROTOCOL_MIGRATION_REQUIRED');

const postMarker = createLegacyArchitectureGate({ db: { prepare: () => ({ get: () => ({ ok: 1 }) }) } });
const postRead = invoke(postMarker, 'GET');
assert.strictEqual(postRead.response.statusCode, 410);
assert.strictEqual(postRead.response.body.error.code, 'LEGACY_ARCHITECTURE_RETIRED');

const hardRetired = createLegacyArchitectureGate({
  db: { prepare: () => ({ get: () => undefined }) },
  hardRetire: true,
});
assert.strictEqual(invoke(hardRetired, 'GET').response.statusCode, 410);

console.log('legacyArchitectureGate tests passed');
