const assert = require('assert');

let service = {};
try {
  service = require('./legacyArchitectureGate');
} catch (_error) {
  // The assertions define the gate contract before implementation.
}

assert.strictEqual(typeof service.createLegacyArchitectureGate, 'function');

function invoke(gate, method) {
  const response = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
  let next = false;
  gate({ method }, response, () => { next = true; });
  return { response, next };
}

const preMarker = service.createLegacyArchitectureGate({
  db: { prepare: () => ({ get: () => undefined }) },
});
assert.strictEqual(invoke(preMarker, 'GET').next, true);
assert.strictEqual(invoke(preMarker, 'POST').response.statusCode, 409);

const postMarker = service.createLegacyArchitectureGate({
  db: { prepare: () => ({ get: () => ({ ok: 1 }) }) },
});
const retired = invoke(postMarker, 'GET');
assert.strictEqual(retired.response.statusCode, 410);
assert.strictEqual(retired.response.body.error.code, 'LEGACY_ARCHITECTURE_RETIRED');

const hardRetired = service.createLegacyArchitectureGate({
  db: { prepare: () => ({ get: () => undefined }) },
  hardRetire: true,
});
assert.strictEqual(invoke(hardRetired, 'GET').response.statusCode, 410);

console.log('gateway legacyArchitectureGate tests passed');
