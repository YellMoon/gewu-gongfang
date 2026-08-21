'use strict';

const assert = require('assert');
const { createCloudBusinessApp } = require('./app');

async function request(app, path, { method = 'GET', body, headers = {} } = {}) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method,
      headers: body === undefined ? headers : { ...headers, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let responseBody;
    try {
      responseBody = await response.json();
    } catch (_) {
      responseBody = null;
    }
    return { status: response.status, body: responseBody };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

(async () => {
  const healthy = await request(createCloudBusinessApp({ query: async () => ({ rows: [{ ok: 1 }] }) }), '/api/health');
  assert.strictEqual(healthy.status, 200);
  assert.deepStrictEqual(healthy.body, { ok: true, database: 'postgresql', businessAuthority: 'cloud' });

  const unavailable = await request(createCloudBusinessApp({ query: async () => { throw new Error('database unavailable'); } }), '/api/health');
  assert.strictEqual(unavailable.status, 503);
  assert.deepStrictEqual(unavailable.body, { ok: false, database: 'unavailable' });

  const calls = [];
  const identity = {
    begin: async input => { calls.push(['begin', input]); return { verificationToken: 'ticket-1' }; },
    register: async input => { calls.push(['register', input]); return { receiptId: 'receipt-1', sessionId: 'session-1', replayed: false, sessionToken: 'eyJ2IjoxfQ.signature' }; },
    sessionContext: async input => {
      calls.push(['sessionContext', input]);
      return { authorityId: 'authority-1', accountId: 'account-1', deviceId: 'device-1', installationId: 'install-1', sessionId: 'session-1', expiresAt: '2026-08-21T13:00:00.000Z', roles: ['super_admin'] };
    },
  };
  const verification = await request(createCloudBusinessApp({ query: async () => ({ rows: [] }), desktopRegistration: identity }), '/api/desktop/online-verification', { method: 'POST', body: { phoneCode: 'provider-code' } });
  assert.strictEqual(verification.status, 200);
  assert.deepStrictEqual(verification.body, { ok: true, verificationToken: 'ticket-1' });
  const registration = await request(createCloudBusinessApp({ query: async () => ({ rows: [] }), desktopRegistration: identity }), '/api/desktop/online-registration', { method: 'POST', body: { verificationToken: 'ticket-1', installationId: 'install-1', installationPublicKey: 'public-key', deviceProof: 'proof', idempotencyKey: 'retry-1' } });
  assert.strictEqual(registration.status, 200);
  assert.deepStrictEqual(registration.body, { ok: true, receiptId: 'receipt-1', sessionId: 'session-1', replayed: false, sessionToken: 'eyJ2IjoxfQ.signature' });
  const sessionContext = await request(createCloudBusinessApp({ query: async () => ({ rows: [] }), desktopRegistration: identity }), '/api/desktop/session-context', { headers: { authorization: 'Bearer eyJ2IjoxfQ.signature' } });
  assert.strictEqual(sessionContext.status, 200);
  assert.deepStrictEqual(sessionContext.body, { ok: true, authorityId: 'authority-1', accountId: 'account-1', deviceId: 'device-1', installationId: 'install-1', sessionId: 'session-1', expiresAt: '2026-08-21T13:00:00.000Z', roles: ['super_admin'] });
  const businessQueries = [];
  const scheduleList = await request(createCloudBusinessApp({
    query: async (text, values) => {
      businessQueries.push([text, values]);
      return { rows: [{ id: 'schedule-1', courseId: 'course-1', courseName: '\\u6570\\u5b66', startAt: '2026-08-22T01:00:00.000Z', endAt: '2026-08-22T02:00:00.000Z', status: 1, roomDisplay: 'A101', tuition: '100', teacherFee: '50' }] };
    },
    desktopRegistration: identity,
    businessTenantId: 'default',
  }), '/api/business/schedules', { headers: { authorization: 'Bearer eyJ2IjoxfQ.signature' } });
  assert.strictEqual(scheduleList.status, 200);
  assert.deepStrictEqual(scheduleList.body, {
    ok: true,
    schedules: [{ id: 'schedule-1', courseId: 'course-1', courseName: '\\u6570\\u5b66', startAt: '2026-08-22T01:00:00.000Z', endAt: '2026-08-22T02:00:00.000Z', status: 1, roomDisplay: 'A101', tuition: '100', teacherFee: '50' }],
  });
  assert.strictEqual(businessQueries.length, 1);
  assert.deepStrictEqual(businessQueries[0][1], ['default']);
  assert.ok(businessQueries[0][0].startsWith('SELECT s.id AS "id", s.course_id AS "courseId"'));
  const businessWrites = [];
  const scheduleUpdate = await request(createCloudBusinessApp({
    query: async () => ({ rows: [] }),
    businessScheduleUpdate: async input => {
      businessWrites.push(input);
      return { id: 'schedule-1', updatedAt: '2026-08-22T01:05:00.000Z' };
    },
    desktopRegistration: identity,
    businessTenantId: 'default',
  }), '/api/business/schedules/schedule-1', {
    method: 'PUT',
    headers: { authorization: 'Bearer eyJ2IjoxfQ.signature' },
    body: {
      expectedUpdatedAt: '2026-08-22T01:00:00.000Z',
      startAt: '2026-08-23T01:00:00.000Z',
      endAt: '2026-08-23T02:00:00.000Z',
      status: 1,
      roomDisplay: 'A102',
      tuition: 120,
      teacherFee: 60,
      notes: null,
    },
  });
  assert.strictEqual(scheduleUpdate.status, 200);
  assert.deepStrictEqual(scheduleUpdate.body, { ok: true, schedule: { id: 'schedule-1', updatedAt: '2026-08-22T01:05:00.000Z' } });
  assert.strictEqual(businessWrites.length, 1);
  assert.deepStrictEqual(businessWrites[0], {
    tenantId: 'default', scheduleId: 'schedule-1', expectedUpdatedAt: '2026-08-22T01:00:00.000Z',
    startAt: '2026-08-23T01:00:00.000Z', endAt: '2026-08-23T02:00:00.000Z', status: 1,
    roomDisplay: 'A102', tuition: 120, teacherFee: 60, notes: null,
  });
  let deniedBusinessQuery = false;
  const deniedScheduleList = await request(createCloudBusinessApp({
    query: async () => { deniedBusinessQuery = true; return { rows: [] }; },
    desktopRegistration: { ...identity, sessionContext: async () => ({ authorityId: 'authority-1', accountId: 'account-2', roles: ['visitor'] }) },
    businessTenantId: 'default',
  }), '/api/business/schedules', { headers: { authorization: 'Bearer eyJ2IjoxfQ.signature' } });
  assert.strictEqual(deniedScheduleList.status, 403);
  assert.deepStrictEqual(deniedScheduleList.body, { ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
  assert.strictEqual(deniedBusinessQuery, false);
  const missingSessionToken = await request(createCloudBusinessApp({ query: async () => ({ rows: [] }), desktopRegistration: identity }), '/api/desktop/session-context');
  assert.strictEqual(missingSessionToken.status, 403);
  assert.deepStrictEqual(missingSessionToken.body, { ok: false, code: 'CLOUD_ONLINE_IDENTITY_REJECTED' });
  assert.deepStrictEqual(calls, [
    ['begin', { phoneCode: 'provider-code' }],
    ['register', { verificationToken: 'ticket-1', installationId: 'install-1', installationPublicKey: 'public-key', deviceProof: 'proof', idempotencyKey: 'retry-1' }],
    ['sessionContext', { sessionToken: 'eyJ2IjoxfQ.signature' }],
    ['sessionContext', { sessionToken: 'eyJ2IjoxfQ.signature' }],
    ['sessionContext', { sessionToken: 'eyJ2IjoxfQ.signature' }],
  ]);
  const denied = await request(createCloudBusinessApp({ query: async () => ({ rows: [] }), desktopRegistration: { begin: async () => { throw Object.assign(new Error('no'), { code: 'CLOUD_ONLINE_IDENTITY_REJECTED' }); }, register: async () => null } }), '/api/desktop/online-verification', { method: 'POST', body: { phoneCode: 'bad' } });
  assert.strictEqual(denied.status, 403);
  assert.deepStrictEqual(denied.body, { ok: false, code: 'CLOUD_ONLINE_IDENTITY_REJECTED' });
  const invalid = await request(createCloudBusinessApp({ query: async () => ({ rows: [] }), desktopRegistration: { begin: async () => { throw Object.assign(new Error('bad input'), { code: 'CLOUD_ONLINE_IDENTITY_INVALID' }); }, register: async () => null } }), '/api/desktop/online-verification', { method: 'POST', body: {} });
  assert.strictEqual(invalid.status, 400);
  assert.deepStrictEqual(invalid.body, { ok: false, code: 'CLOUD_ONLINE_IDENTITY_INPUT_INVALID' });

  const pairingCalls = [];
  const pairing = {
    start: input => { pairingCalls.push(['start', input]); return { pairingId: 'pair-1', pairingSecret: 'secret-1', expiresAt: '2026-08-21T12:05:00.000Z' }; },
    confirm: async input => { pairingCalls.push(['confirm', input]); return { status: 'verified' }; },
    read: input => { pairingCalls.push(['read', input]); return { status: 'verified', verificationToken: 'ticket-1' }; },
  };
  const pairedApp = createCloudBusinessApp({ query: async () => ({ rows: [] }), desktopRegistration: identity, desktopPairing: pairing });
  const pairingStart = await request(pairedApp, '/api/desktop/pairing/start', { method: 'POST', body: { installationId: 'install-1', installationPublicKey: 'public-key', idempotencyKey: 'retry-1' } });
  assert.strictEqual(pairingStart.status, 200);
  assert.deepStrictEqual(pairingStart.body, { ok: true, pairingId: 'pair-1', pairingSecret: 'secret-1', expiresAt: '2026-08-21T12:05:00.000Z' });
  const pairingConfirm = await request(pairedApp, '/api/desktop/pairing/confirm', { method: 'POST', body: { pairingId: 'pair-1', pairingSecret: 'secret-1', phoneCode: 'provider-code' } });
  assert.strictEqual(pairingConfirm.status, 200);
  assert.deepStrictEqual(pairingConfirm.body, { ok: true, status: 'verified' });
  const pairingRead = await request(pairedApp, '/api/desktop/pairing/pair-1?secret=secret-1');
  assert.strictEqual(pairingRead.status, 200);
  assert.deepStrictEqual(pairingRead.body, { ok: true, status: 'verified', verificationToken: 'ticket-1' });
  assert.deepStrictEqual(pairingCalls, [
    ['start', { installationId: 'install-1', installationPublicKey: 'public-key', idempotencyKey: 'retry-1' }],
    ['confirm', { pairingId: 'pair-1', pairingSecret: 'secret-1', phoneCode: 'provider-code' }],
    ['read', { pairingId: 'pair-1', pairingSecret: 'secret-1' }],
  ]);

  console.log('cloud business API health checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
