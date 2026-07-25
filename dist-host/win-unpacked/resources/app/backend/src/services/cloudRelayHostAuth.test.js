const assert = require('assert');
const { resolveCloudRelayHostAuthOptions } = require('./cloudRelayHostAuth');

assert.deepStrictEqual(resolveCloudRelayHostAuthOptions({
  authorization: 'Bearer desktop-session',
  hostCredential: '',
  hostDeviceId: 'host-a',
  hostGeneration: 1,
  hostToken: 'single-user-host-token',
  identityMode: 'single-user',
}), {
  authorization: 'Bearer desktop-session',
  hostToken: 'single-user-host-token',
});

assert.deepStrictEqual(resolveCloudRelayHostAuthOptions({
  authorization: 'Bearer desktop-session',
  hostCredential: 'managed-credential',
  hostDeviceId: 'host-a',
  hostGeneration: 2,
  hostToken: 'legacy-token',
  identityMode: 'single-user',
}), {
  authorization: 'Bearer desktop-session',
  hostCredential: 'managed-credential',
  hostDeviceId: 'host-a',
  hostGeneration: 2,
});

assert.deepStrictEqual(resolveCloudRelayHostAuthOptions({
  authorization: '',
  hostCredential: '',
  hostDeviceId: 'host-a',
  hostGeneration: 2,
  hostToken: 'legacy-token',
  identityMode: 'full',
}), {
  authorization: '',
  hostCredential: '',
  hostDeviceId: 'host-a',
  hostGeneration: 2,
});

console.log('cloud relay host auth checks passed');
