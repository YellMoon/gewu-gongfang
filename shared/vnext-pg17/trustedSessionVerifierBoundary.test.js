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
  const unwrapped = boundary.unwrap(assertion);
  assert.deepStrictEqual(unwrapped, { sessionId: 'session-1' });
  assert.strictEqual(Object.isFrozen(unwrapped), true);
  assert.throws(() => { unwrapped.sessionId = 'forged'; }, TypeError);
  assert.strictEqual(isVNextPg17TrustedSessionVerifierBoundaryForHandle(boundary, handleA), true);
  assert.strictEqual(isVNextPg17TrustedSessionVerifierBoundaryForHandle(boundary, handleB), false);
  await expectCode(async () => boundary.unwrap({}), 'VNEXT_PG17_SESSION_ASSERTION_INVALID');

  const foreignBoundary = createVNextPg17TrustedSessionVerifierBoundary({
    databaseBinding: handleA,
    verifyPresentation: () => ({ sessionId: 'session-foreign' }),
  });
  await expectCode(async () => boundary.unwrap(await foreignBoundary.verify(null)), 'VNEXT_PG17_SESSION_ASSERTION_INVALID');

  let getterReads = 0;
  const accessorResult = { sessionId: 'session-2' };
  Object.defineProperty(accessorResult, 'sessionId', { enumerable: true, get() { getterReads += 1; return 'session-2'; } });
  const rejectingBoundary = createVNextPg17TrustedSessionVerifierBoundary({
    databaseBinding: {},
    verifyPresentation: () => accessorResult,
  });
  await expectCode(() => rejectingBoundary.verify(null), 'VNEXT_PG17_SESSION_PRESENTATION_REJECTED');
  assert.strictEqual(getterReads, 0);

  for (const result of [
    { sessionId: 'session-extra', extra: true },
    Object.assign(Object.create(null), { sessionId: 'session-null-prototype' }),
    Object.assign({ sessionId: 'session-symbol' }, { [Symbol('extra')]: true }),
    { sessionId: 'invalid whitespace' },
  ]) {
    const invalidBoundary = createVNextPg17TrustedSessionVerifierBoundary({ databaseBinding: {}, verifyPresentation: () => result });
    await expectCode(() => invalidBoundary.verify(null), 'VNEXT_PG17_SESSION_PRESENTATION_REJECTED');
  }

  let thenReads = 0;
  const thenable = { sessionId: 'session-thenable' };
  Object.defineProperty(thenable, 'then', { enumerable: true, get() { thenReads += 1; return () => {}; } });
  const thenableBoundary = createVNextPg17TrustedSessionVerifierBoundary({ databaseBinding: {}, verifyPresentation: () => thenable });
  await expectCode(() => thenableBoundary.verify(null), 'VNEXT_PG17_SESSION_PRESENTATION_REJECTED');
  assert.strictEqual(thenReads, 0);

  const throwingBoundary = createVNextPg17TrustedSessionVerifierBoundary({ databaseBinding: {}, verifyPresentation: () => { throw new Error('private verifier failure'); } });
  await expectCode(() => throwingBoundary.verify(null), 'VNEXT_PG17_SESSION_PRESENTATION_REJECTED');

  let configReads = 0;
  const invalidConfig = {
    databaseBinding: {},
    get verifyPresentation() { configReads += 1; return () => ({ sessionId: 'session-unreachable' }); },
  };
  assert.throws(() => createVNextPg17TrustedSessionVerifierBoundary(invalidConfig), error => error?.code === 'VNEXT_PG17_TRUSTED_VERIFIER_INVALID');
  assert.strictEqual(configReads, 0);
  assert.throws(() => createVNextPg17TrustedSessionVerifierBoundary(new Proxy({ databaseBinding: {}, verifyPresentation: () => ({ sessionId: 'session-unreachable' }) }, {})), error => error?.code === 'VNEXT_PG17_TRUSTED_VERIFIER_INVALID');
}

if (require.main === module) {
  runTrustedSessionVerifierBoundaryCases().then(() => process.stdout.write('vNext PG17 trusted session verifier boundary checks passed\n')).catch(error => { process.stderr.write(`${error.code || error.message}\n`); process.exitCode = 1; });
}

module.exports = { runTrustedSessionVerifierBoundaryCases };
