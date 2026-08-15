'use strict';

const { types } = require('node:util');

const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const boundaries = new WeakSet();
const bindings = new WeakMap();

function failure(code) { return Object.assign(new Error(code), { code }); }

function exactConfig(value) {
  if (!value || typeof value !== 'object' || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 2 || !keys.includes('databaseBinding') || !keys.includes('verifyPresentation')) return null;
  const copy = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
    copy[key] = descriptor.value;
  }
  return copy;
}

function exactSessionId(value) {
  if (!value || typeof value !== 'object' || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 1 || keys[0] !== 'sessionId') return null;
  const descriptor = Object.getOwnPropertyDescriptor(value, 'sessionId');
  if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'string' || !SESSION_ID.test(descriptor.value)) return null;
  return descriptor.value;
}

function createVNextPg17TrustedSessionVerifierBoundary(config) {
  const settings = exactConfig(config);
  if (!settings || !settings.databaseBinding || types.isProxy(settings.databaseBinding) || typeof settings.verifyPresentation !== 'function' || types.isProxy(settings.verifyPresentation)) throw failure('VNEXT_PG17_TRUSTED_VERIFIER_INVALID');
  const assertions = new WeakMap();
  const boundary = Object.freeze({
    async verify(presentation) {
      try {
        let result = settings.verifyPresentation(presentation);
        if (types.isPromise(result)) result = await result;
        const sessionId = exactSessionId(result);
        if (!sessionId) throw failure('VNEXT_PG17_SESSION_PRESENTATION_REJECTED');
        const assertion = Object.freeze({});
        assertions.set(assertion, Object.freeze({ sessionId }));
        return assertion;
      } catch (_) {
        throw failure('VNEXT_PG17_SESSION_PRESENTATION_REJECTED');
      }
    },
    unwrap(assertion) {
      const session = assertions.get(assertion);
      if (!session) throw failure('VNEXT_PG17_SESSION_ASSERTION_INVALID');
      return session;
    },
  });
  boundaries.add(boundary);
  bindings.set(boundary, settings.databaseBinding);
  return boundary;
}

function isVNextPg17TrustedSessionVerifierBoundaryForHandle(value, handle) {
  return !!value && typeof value === 'object' && boundaries.has(value) && bindings.has(value) && bindings.get(value) === handle;
}

module.exports = Object.freeze({ createVNextPg17TrustedSessionVerifierBoundary, isVNextPg17TrustedSessionVerifierBoundaryForHandle });
