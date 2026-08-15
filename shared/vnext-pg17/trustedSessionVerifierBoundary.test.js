'use strict';

const assert = require('assert');
const {
  createVNextPg17TrustedSessionVerifierBoundary,
  isVNextPg17TrustedSessionVerifierBoundaryForHandle,
} = require('./trustedSessionVerifierBoundary');

async function expectCode(action, code) {
  await assert.rejects(action, error => error && error.code === code);
}

async function runTrustedSessionVerifierBoundaryCases() {
  const handleA = {};
  const handleB = {};
  const boundary = createVNextPg17TrustedSessionVerifierBoundary({
    databaseBinding: handleA,
    verifyPresentation: async () => ({ sessionId: 'session-1' }),
  });
  const assertion = await boundary.verify(null);
  assert.strictEqual(Object.isFrozen(assertion), true);
  assert.deepStrictEqual(Reflect.ownKeys(assertion), []);
  assert.deepStrictEqual(boundary.unwrap(assertion), { sessionId: 'session-1' });
  assert.strictEqual(isVNextPg17TrustedSessionVerifierBoundaryForHandle(boundary, handleA), true);
  assert.strictEqual(isVNextPg17TrustedSessionVerifierBoundaryForHandle(boundary, handleB), false);
  await expectCode(async () => boundary.unwrap({}), 'VNEXT_PG17_SESSION_ASSERTION_INVALID');

  let getterReads = 0;
  const accessorResult = { sessionId: 'session-2' };
  Object.defineProperty(accessorResult, 'sessionId', { enumerable: true, get() { getterReads += 1; return 'session-2'; } });
  const rejectingBoundary = createVNextPg17TrustedSessionVerifierBoundary({
    databaseBinding: {},
    verifyPresentation: () => accessorResult,
  });
  await expectCode(() => rejectingBoundary.verify(null), 'VNEXT_PG17_SESSION_PRESENTATION_REJECTED');
  assert.strictEqual(getterReads, 0);
}

if (require.main === module) {
  runTrustedSessionVerifierBoundaryCases().then(() => process.stdout.write('vNext PG17 trusted session verifier boundary checks passed\n')).catch(error => { process.stderr.write(`${error.code || error.message}\n`); process.exitCode = 1; });
}

module.exports = { runTrustedSessionVerifierBoundaryCases };
