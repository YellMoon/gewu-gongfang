'use strict';

const { types } = require('node:util');

const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

function boundaryError(code) {
  return Object.assign(new Error(code), { code });
}

function exactSessionResult(value) {
  if (!value || typeof value !== 'object' || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 1 || keys[0] !== 'sessionId') return null;
  const descriptor = Object.getOwnPropertyDescriptor(value, 'sessionId');
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'string' || !SESSION_ID.test(descriptor.value)) return null;
  return descriptor.value;
}

function createVNextTrustedSessionVerifierBoundary(config) {
  const verifyPresentation = config && typeof config === 'object' && !Array.isArray(config) ? config.verifyPresentation : undefined;
  if (typeof verifyPresentation !== 'function') throw boundaryError('VNEXT_TRUSTED_VERIFIER_INVALID');
  const assertions = new WeakMap();

  return Object.freeze({
    async verify(presentation) {
      let result;
      try {
        result = verifyPresentation(presentation);
        if (types.isPromise(result)) result = await result;
        const sessionId = exactSessionResult(result);
        if (!sessionId) throw boundaryError('VNEXT_SESSION_PRESENTATION_REJECTED');
        const assertion = Object.freeze({});
        assertions.set(assertion, Object.freeze({ sessionId }));
        return assertion;
      } catch {
        throw boundaryError('VNEXT_SESSION_PRESENTATION_REJECTED');
      }
    },
    unwrap(assertion) {
      const trustedSession = assertions.get(assertion);
      if (!trustedSession) throw boundaryError('VNEXT_TRUSTED_SESSION_ASSERTION_INVALID');
      return trustedSession;
    },
  });
}

module.exports = Object.freeze({ createVNextTrustedSessionVerifierBoundary });
