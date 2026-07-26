const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const jwt = require('jsonwebtoken');
const { issueRelayAssertion } = require('./relayAssertionService');

const { DatabaseService } = require('../database');
const {
  DESKTOP_SESSION_RELAY_START,
  DESKTOP_SESSION_RELAY_EXCHANGE,
  createDesktopSessionRelayService,
  hashDesktopSessionRelaySecret,
} = require('./desktopSessionRelayService');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-session-relay-'));
process.env.DB_PATH = path.join(tempRoot, 'relay.db');
process.env.READ_DB_PATH = process.env.DB_PATH;
const database = new DatabaseService();
const db = database.db;
const now = new Date();
db.prepare(`INSERT INTO host_heartbeats
  (id, host_device_id, status, base_url, lan_urls, capabilities, created_at, updated_at)
  VALUES ('host-1', 'host-1', 'online', 'http://host.lan:3001', '[]', '[]', ?, ?)`)
  .run(now.toISOString(), now.toISOString());

let sequence = 0;
const relay = createDesktopSessionRelayService({
  db,
  now: () => now,
  idFactory: prefix => `${prefix}-${++sequence}`,
});
const secret = 'client-generated-relay-secret';
const secretHash = hashDesktopSessionRelaySecret(secret);
const started = relay.createStartRequest({
  authorizationId: 'auth-1',
  deviceId: 'device-1',
  requestSecretHash: secretHash,
  targetHostDeviceId: 'host-1',
});
assert.strictEqual(started.taskType, DESKTOP_SESSION_RELAY_START);
const rawStart = db.prepare('SELECT * FROM miniapp_tasks WHERE id=?').get(started.id);
assert.ok(rawStart);
assert.ok(rawStart.payload.includes(secretHash));
assert.ok(!rawStart.payload.includes(secret));
assert.throws(
  () => relay.readRequest({ requestId: started.id, requestSecret: 'wrong-secret' }),
  error => error.code === 'DESKTOP_SESSION_RELAY_SECRET_INVALID'
);
assert.strictEqual(relay.readRequest({ requestId: started.id, requestSecret: secret }).status, 'pending_host');

db.prepare(`UPDATE miniapp_tasks
  SET status='completed', result_payload=?, updated_at=?, row_version=row_version+1
  WHERE id=?`).run(JSON.stringify({
  challenge: {
    id: 'challenge-1',
    authorizationId: 'auth-1',
    deviceId: 'device-1',
    credentialVersion: 1,
    nonce: 'nonce-1',
    nonceIssuedAt: now.toISOString(),
    rowVersion: 1,
  },
}), now.toISOString(), started.id);
const completedStart = relay.readRequest({ requestId: started.id, requestSecret: secret });
assert.strictEqual(completedStart.result.challenge.id, 'challenge-1');
assert.strictEqual(Object.hasOwn(completedStart, 'requestSecretHash'), false);

const exchanged = relay.createExchangeRequest({
  startRequestId: started.id,
  challengeId: 'challenge-1',
  signature: Buffer.alloc(64, 7).toString('base64'),
  expectedRowVersion: 1,
  requestSecret: secret,
});
assert.strictEqual(exchanged.taskType, DESKTOP_SESSION_RELAY_EXCHANGE);
assert.strictEqual(exchanged.targetHostDeviceId, 'host-1');
const relayAssertionSecret = 'relay-assertion-secret';
const relayAssertion = issueRelayAssertion({
  taskId: exchanged.id,
  actorUserId: 'user-1',
  deviceId: 'device-1',
  sessionId: 'session-1',
  activeRole: 'teacher',
  teacherId: 'teacher-1',
  authVersion: 4,
  credentialVersion: 3,
  issuedAt: now.getTime(),
    expiresAt: now.getTime() + 2 * 60 * 60 * 1000,
}, relayAssertionSecret);
db.prepare(`UPDATE miniapp_tasks
  SET status='completed', result_payload=?, updated_at=?, row_version=row_version+1
  WHERE id=?`).run(JSON.stringify({
  session: {
    id: 'session-1',
    userId: 'user-1',
    deviceId: 'device-1',
    activeRole: 'teacher',
    eligibleRoles: ['teacher'],
    teacherId: 'teacher-1',
    authVersion: 4,
    credentialVersion: 3,
    expiresAt: new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString(),
  },
  profile: {
    userId: 'user-1',
    user: { id: 'user-1', name: 'Teacher' },
    activeRole: 'teacher',
    eligibleRoles: ['teacher'],
    teacherId: 'teacher-1',
  },
  offlineLease: { id: 'lease-1' },
  relayAssertion,
}), now.toISOString(), exchanged.id);
const materializedRelay = createDesktopSessionRelayService({
  db,
  now: () => now,
  relayAssertionSecret,
  jwtSecret: 'cloud-jwt-secret',
});
const exchangeResult = materializedRelay.readRequest({
  requestId: exchanged.id,
  requestSecret: secret,
});
assert.ok(exchangeResult.result.token);
assert.strictEqual(Object.hasOwn(exchangeResult.result, 'relayAssertion'), false);
const cloudClaims = jwt.verify(exchangeResult.result.token, 'cloud-jwt-secret', {
  algorithms: ['HS256'],
  issuer: 'gewu-auth',
  audience: 'gewu-api',
});
assert.strictEqual(cloudClaims.token_use, 'desktop-relay-session');
assert.strictEqual(cloudClaims.device_id, 'device-1');
assert.throws(
  () => relay.createExchangeRequest({
    startRequestId: started.id,
    challengeId: 'different-challenge',
    signature: Buffer.alloc(64, 7).toString('base64'),
    expectedRowVersion: 1,
    requestSecret: secret,
  }),
  error => error.code === 'DESKTOP_SESSION_RELAY_CHALLENGE_MISMATCH'
);

const expiredRelay = createDesktopSessionRelayService({
  db,
  now: () => new Date(now.getTime() + 10 * 60 * 1000),
});
assert.throws(
  () => expiredRelay.readRequest({ requestId: started.id, requestSecret: secret }),
  error => error.code === 'DESKTOP_SESSION_RELAY_REQUEST_EXPIRED'
);

database.close();
fs.rmSync(tempRoot, { recursive: true, force: true });
console.log('desktop session relay service checks passed');
