const assert = require('node:assert/strict');
const express = require('express');
const { createDesktopIdentityRouter } = require('./desktopIdentity');

async function request(baseUrl, method, pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      authorization: 'Bearer active-desktop-session',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = null;
  if (text && response.headers.get('content-type')?.includes('application/json')) parsed = JSON.parse(text);
  return { status: response.status, body: parsed };
}

(async function () {
  const identityService = {
    listDevicesForUser: () => [{ deviceId: 'device-active' }],
    listAllDevices: () => [{ deviceId: 'device-active' }],
  };
  const sessionService = {
    assertSuperAdmin: () => undefined,
    verifySessionToken: () => ({ userId: 'user-active', deviceId: 'device-active' }),
  };
  const deviceChallengeService = {
    startChallenge: () => ({ id: 'daily-session-challenge', rowVersion: 1 }),
    exchangeChallenge: () => ({
      session: { id: 'session-active' },
      token: 'token-active',
      offlineLease: { id: 'lease-active' },
      profile: { userId: 'user-active' },
    }),
  };

  const app = express();
  app.use(express.json());
  app.use('/api/desktop-identity', createDesktopIdentityRouter({
    db: {},
    identityService,
    sessionService,
    deviceChallengeService,
    authenticateDesktop: () => ({ userId: 'user-active', deviceId: 'device-active' }),
  }));
  const server = app.listen(0);

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const retiredRoutes = [
      ['POST', '/api/desktop-identity/challenges/start'],
      ['GET', '/api/desktop-identity/challenges/retired-challenge'],
      ['GET', '/api/desktop-identity/challenges/retired-challenge/public'],
      ['POST', '/api/desktop-identity/challenges/retired-challenge/confirm'],
      ['GET', '/api/desktop-identity/authorizations/pending'],
      ['POST', '/api/desktop-identity/challenges/retired-challenge/approve'],
      ['POST', '/api/desktop-identity/challenges/retired-challenge/reject'],
      ['POST', '/api/desktop-identity/challenges/retired-challenge/exchange'],
      ['POST', '/api/desktop-identity/challenges/retired-challenge/activation/exchange'],
      ['POST', '/api/desktop-identity/activations/retired-activation/finalize'],
    ];
    for (const [method, pathname] of retiredRoutes) {
      const result = await request(baseUrl, method, pathname, method === 'GET' ? undefined : {});
      assert.equal(result.status, 404, `${method} ${pathname} must be removed`);
    }

    const devices = await request(baseUrl, 'GET', '/api/desktop-identity/devices');
    assert.equal(devices.status, 200, 'device center route must remain available');
    assert.deepEqual(devices.body.data.items, [{ deviceId: 'device-active' }]);

    const sessionChallenge = await request(
      baseUrl,
      'POST',
      '/api/desktop-identity/session/challenges/start',
      { authorizationId: 'authorization-active', deviceId: 'device-active' },
    );
    assert.equal(sessionChallenge.status, 200, 'session renewal route must remain available');
    assert.equal(sessionChallenge.body.data.challenge.id, 'daily-session-challenge');

    console.log('desktop identity manual approval retirement HTTP tests passed');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
