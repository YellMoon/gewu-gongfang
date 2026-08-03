const assert = require('assert');
const { resolveCloudRelayHostAuthOptions } = require('./cloudRelayHostAuth');

assert.deepStrictEqual(resolveCloudRelayHostAuthOptions({
  authorization: 'Bearer desktop-session',
  hostCredential: 'managed-credential',
  hostDeviceId: 'host-a',
  hostGeneration: 2,
}), {
  authorization: 'Bearer desktop-session',
  hostCredential: 'managed-credential',
  hostDeviceId: 'host-a',
  hostGeneration: 2,
});

assert.throws(() => resolveCloudRelayHostAuthOptions({
  authorization: '',
  hostCredential: '',
  hostDeviceId: 'host-a',
  hostGeneration: 2,
}), error => error.code === 'MANAGED_HOST_IDENTITY_INCOMPLETE');

console.log('cloud relay host auth checks passed');
