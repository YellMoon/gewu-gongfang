'use strict';
const assert = require('assert');
const { createVNextTrustedSessionVerifierBoundary } = require('./vNextTrustedSessionVerifierBoundaryReference');

function expectCode(action, code) {
  return assert.rejects(action, error => error && error.code === code && error.message === code);
}

(async () => {
  for (const config of [undefined, null, false, 0, 'invalid', []]) {
    assert.throws(() => createVNextTrustedSessionVerifierBoundary(config), error => error && error.code === 'VNEXT_TRUSTED_VERIFIER_INVALID');
  }

  const presentation = Object.freeze({ clientClaim: 'not-trusted-by-shape' });
  const boundary = createVNextTrustedSessionVerifierBoundary({ verifyPresentation: received => {
    assert.strictEqual(received, presentation);
    return { sessionId: 'session:alpha_1' };
  } });
  const assertion = await boundary.verify(presentation);
  assert.ok(Object.isFrozen(assertion));
  assert.deepStrictEqual(JSON.parse(JSON.stringify(assertion)), {});
  const trustedSession = boundary.unwrap(assertion);
  assert.ok(Object.isFrozen(trustedSession));
  assert.deepStrictEqual(trustedSession, { sessionId: 'session:alpha_1' });
  assert.throws(() => { trustedSession.sessionId = 'changed'; }, TypeError);

  const nativePromiseBoundary = createVNextTrustedSessionVerifierBoundary({ verifyPresentation: () => Promise.resolve({ sessionId: 'session-native-promise' }) });
  assert.deepStrictEqual(nativePromiseBoundary.unwrap(await nativePromiseBoundary.verify(null)), { sessionId: 'session-native-promise' });

  for (const forged of [{}, { ...assertion }, JSON.parse(JSON.stringify(assertion)), Object.freeze(Object.create(null))]) {
    assert.throws(() => boundary.unwrap(forged), error => error && error.code === 'VNEXT_TRUSTED_SESSION_ASSERTION_INVALID');
  }
  assert.throws(() => nativePromiseBoundary.unwrap(assertion), error => error && error.code === 'VNEXT_TRUSTED_SESSION_ASSERTION_INVALID');

  for (const verifyPresentation of [
    () => { throw new Error('internal verifier detail'); },
    () => Promise.reject(new Error('internal verifier detail')),
    () => ({ then() {} }),
    () => null,
    () => ({ verified: true }),
    () => ({ sessionId: 'session-1', authorityId: 'caller-spoof' }),
    () => ({ sessionId: '' }),
    () => ({ sessionId: ' session-1' }),
    () => ({ sessionId: 'session-1 ' }),
    () => ({ sessionId: 'session space' }),
    () => Object.defineProperty({ sessionId: 'session-1' }, 'authorityId', { value: 'hidden-extra' }),
    () => ({ sessionId: 'session-1', [Symbol('hidden-extra')]: 'symbol-extra' }),
    () => Object.defineProperty({}, 'sessionId', { get() { return 'session-1'; } }),
    () => new Proxy({ sessionId: 'session-1' }, { ownKeys() { throw new Error('private ownKeys detail'); } }),
    () => new Proxy({ sessionId: 'session-proxy', authorityId: 'hidden-extra' }, {
      ownKeys() { return ['sessionId']; },
      getOwnPropertyDescriptor(_target, key) { return key === 'sessionId' ? { value: 'session-proxy', enumerable: true, configurable: true } : undefined; },
    }),
    () => {
      const result = { sessionId: 'session-1', authorityId: 'hidden-extra' };
      Object.defineProperty(result, 'then', { enumerable: true, get() { delete result.authorityId; delete result.then; return undefined; } });
      return result;
    },
    () => {
      let reads = 0;
      return Object.defineProperty({}, 'sessionId', { enumerable: true, get() { reads += 1; return reads < 3 ? 'session-1' : 'invalid space'; } });
    },
  ]) {
    const rejectingBoundary = createVNextTrustedSessionVerifierBoundary({ verifyPresentation });
    await expectCode(() => rejectingBoundary.verify({ presentation: 'do-not-echo' }), 'VNEXT_SESSION_PRESENTATION_REJECTED');
  }

  console.log('vNext trusted session verifier boundary checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
