'use strict';

const { types } = require('node:util');

const REQUEST_KEYS = Object.freeze([
  'assertionId', 'idempotencyKey',
]);

function failure() {
  const error = new Error('unified desktop registration input is invalid');
  error.code = 'VNEXT_UNIFIED_DESKTOP_REGISTRATION_INPUT_INVALID';
  return error;
}

function exactOwnData(value, expectedKeys) {
  if (!value || typeof value !== 'object' || types.isProxy(value)
    || Object.getPrototypeOf(value) !== Object.prototype) return null;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expectedKeys.length || expectedKeys.some(key => !keys.includes(key))) return null;
  const copy = {};
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
    copy[key] = descriptor.value;
  }
  return copy;
}

function text(value) {
  return typeof value === 'string' && value === value.trim() && value !== '' ? value : null;
}

function registrationRequestSnapshot(value) {
  const copy = exactOwnData(value, REQUEST_KEYS);
  if (!copy) throw failure();
  for (const key of REQUEST_KEYS) {
    if (!text(copy[key])) throw failure();
  }
  return Object.freeze(copy);
}

function createUnifiedDesktopRegistrationCommand(config) {
  const settings = exactOwnData(config, ['invoke']);
  if (!settings || typeof settings.invoke !== 'function' || types.isProxy(settings.invoke)) throw failure();
  return Object.freeze({
    async execute(request) {
      const snapshot = registrationRequestSnapshot(request);
      try {
        return await settings.invoke(snapshot);
      } catch (_) {
        throw failure();
      }
    },
  });
}

module.exports = Object.freeze({ createUnifiedDesktopRegistrationCommand, registrationRequestSnapshot });
