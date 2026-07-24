const assert = require('assert');

(async () => {
  const {
    exchangeDesktopSessionThroughRelay,
  } = await import('./desktopSessionRelayClient.mjs');

  const calls = [];
  let startReads = 0;
  let exchangeReads = 0;
  const challenge = {
    id: 'challenge-relay-1',
    authorizationId: 'auth-1',
    deviceId: 'device-1',
    credentialVersion: 3,
    nonce: 'nonce-relay-1',
    nonceIssuedAt: '2026-07-25T08:00:00.000Z',
    rowVersion: 1,
  };
  const issued = {
    token: 'host-issued-token',
    session: {
      id: 'session-1',
      userId: 'user-1',
      deviceId: 'device-1',
      activeRole: 'teacher',
      eligibleRoles: ['teacher'],
      expiresAt: '2026-07-25T16:00:00.000Z',
      authVersion: 1,
      credentialVersion: 3,
    },
    offlineLease: {
      id: 'lease-1',
      userId: 'user-1',
      deviceId: 'device-1',
      authorizationId: 'auth-1',
      credentialVersion: 3,
      activeRole: 'teacher',
      eligibleRoles: ['teacher'],
      issuedAt: '2026-07-25T08:00:00.000Z',
      expiresAt: '2026-08-08T08:00:00.000Z',
      scope: { kind: 'teacher', teacherId: 'teacher-1' },
    },
    profile: {
      userId: 'user-1',
      user: { id: 'user-1', name: 'Teacher' },
      activeRole: 'teacher',
      eligibleRoles: ['teacher'],
      teacherId: 'teacher-1',
    },
  };
  const fetchImpl = async (url, options = {}) => {
    calls.push([url, options]);
    if (url.endsWith('/desktop-session/challenges/start')) {
      const body = JSON.parse(options.body);
      assert.strictEqual(body.authorizationId, 'auth-1');
      assert.strictEqual(body.deviceId, 'device-1');
      assert.match(body.requestSecretHash, /^[a-f0-9]{64}$/);
      return response({ success: true, request: { id: 'start-1', status: 'pending_host' } });
    }
    if (url.endsWith('/desktop-session/requests/start-1')) {
      startReads += 1;
      assert.ok(options.headers['x-desktop-session-request-secret']);
      return response({
        success: true,
        request: startReads === 1
          ? { id: 'start-1', status: 'pending_host' }
          : { id: 'start-1', status: 'completed', result: { challenge } },
      });
    }
    if (url.endsWith('/desktop-session/challenges/challenge-relay-1/exchange')) {
      const body = JSON.parse(options.body);
      assert.strictEqual(body.startRequestId, 'start-1');
      assert.strictEqual(body.signature, 'signed-relay-challenge');
      assert.strictEqual(body.expectedRowVersion, 1);
      return response({ success: true, request: { id: 'exchange-1', status: 'pending_host' } });
    }
    if (url.endsWith('/desktop-session/requests/exchange-1')) {
      exchangeReads += 1;
      return response({
        success: true,
        request: exchangeReads === 1
          ? { id: 'exchange-1', status: 'processing' }
          : { id: 'exchange-1', status: 'completed', result: issued },
      });
    }
    throw new Error(`unexpected URL ${url}`);
  };
  const result = await exchangeDesktopSessionThroughRelay({
    baseUrl: 'https://relay.example/scheduling/',
    authorizationId: 'auth-1',
    deviceId: 'device-1',
    fetchImpl,
    signChallenge: async input => {
      assert.strictEqual(input.challengeId, challenge.id);
      return { signature: 'signed-relay-challenge' };
    },
    sleep: async () => {},
    cryptoImpl: globalThis.crypto,
  });
  assert.strictEqual(result.token, issued.token);
  assert.strictEqual(result.offlineLease.expiresAt, '2026-08-08T08:00:00.000Z');
  assert.strictEqual(startReads, 2);
  assert.strictEqual(exchangeReads, 2);
  assert.ok(calls.every(([url]) => url.startsWith('https://relay.example/scheduling/api/cloud/')));

  console.log('desktop session relay client checks passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}
