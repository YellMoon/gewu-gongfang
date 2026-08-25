'use strict';

const assert = require('assert');
const crypto = require('crypto');
const {
  createCloudDesktopRegistrationService,
  createOperatorPhoneLookup,
  hmacPhone,
} = require('./desktopRegistrationService');

const now = new Date('2026-08-21T08:00:00.000Z');
const pepper = 'test-phone-lookup-pepper';
const ticketSecret = 'test-ticket-secret-material-32-bytes';
const leaseKeyPair = crypto.generateKeyPairSync('ed25519');
const records = [{ phoneHmac: hmacPhone(pepper, '13700000000'), authorityId: 'tenant-1', accountId: 'account-1' }];
const calls = { issued: [], registered: [], sessionContexts: [] };
const privateKey = crypto.generateKeyPairSync('ed25519').privateKey;
const publicKey = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'pem' });

const service = createCloudDesktopRegistrationService({
  now: () => new Date(now),
  randomId: prefix => `${prefix}-fixed`,
  phoneVerifier: async code => code === 'verified-phone-code' ? '13700000000' : (() => { throw Object.assign(new Error('invalid'), { code: 'PHONE_VERIFICATION_REJECTED' }); })(),
  lookupAccount: async phone => createOperatorPhoneLookup({ pepper, records })(phone),
  ticketSecret,
  leasePrivateKey: leaseKeyPair.privateKey,
  issueAssertion: async input => { calls.issued.push(input); },
  register: async input => { calls.registered.push(input); return { receiptId: input.receiptId, sessionId: input.sessionId, replayed: false }; },
  readSessionContext: async input => {
    calls.sessionContexts.push(input);
    return {
      authorityId: input.authorityId,
      accountId: input.accountId,
      deviceId: input.deviceId,
      installationId: input.installationId,
      sessionId: input.sessionId,
      expiresAt: input.expiresAt,
      roles: ['super_admin'],
      teacherId: null,
      studentId: null,
    };
  },
});

(async () => {
  const started = await service.begin({ phoneCode: 'verified-phone-code' });
  assert.ok(typeof started.verificationToken === 'string' && started.verificationToken.length > 40);
  assert.strictEqual(JSON.stringify(started).includes('13700000000'), false);

  const phoneHmac = hmacPhone(pepper, '13700000000');
  const passwordVerified = service.issueVerificationForVerifiedAccount({ authorityId: 'tenant-1', accountId: 'account-1', phoneHmac });
  assert.ok(typeof passwordVerified.verificationToken === 'string' && passwordVerified.verificationToken.length > 40);
  assert.ok(typeof passwordVerified.deviceChallenge === 'string' && passwordVerified.deviceChallenge.length > 0);
  assert.deepStrictEqual(
    ((token => JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8')))(passwordVerified.verificationToken)).authorityId,
    'tenant-1',
    'an already verified password identity may only obtain the same short-lived registration ticket format',
  );
  assert.strictEqual(service.inspectVerificationToken(passwordVerified.verificationToken).phoneHmac, phoneHmac);
  assert.throws(
    () => service.issueVerificationForVerifiedAccount({ authorityId: 'tenant-1', accountId: '', phoneHmac }),
    error => error.code === 'CLOUD_ONLINE_IDENTITY_REJECTED',
  );

  const ticket = service.inspectVerificationToken(started.verificationToken);
  const proof = crypto.sign(null, Buffer.from(ticket.challenge, 'utf8'), privateKey).toString('base64url');
  const registered = await service.register({
    verificationToken: started.verificationToken,
    installationId: 'installation-1',
    installationPublicKey: publicKey,
    deviceProof: proof,
    idempotencyKey: 'registration-1',
  });
  assert.deepStrictEqual({ receiptId: registered.receiptId, sessionId: registered.sessionId, replayed: registered.replayed }, { receiptId: calls.registered[0].receiptId, sessionId: calls.registered[0].sessionId, replayed: false });
  assert.ok(typeof registered.sessionToken === 'string' && registered.sessionToken.length > 40);
  const unsignedLease = { ...registered.offlineLease };
  delete unsignedLease.signature;
  assert.deepStrictEqual(unsignedLease, {
    v: 1,
    id: `offline-lease-${registered.sessionId}`,
    userId: 'account-1',
    deviceId: calls.issued[0].deviceId,
    authorizationId: registered.sessionId,
    credentialVersion: 1,
    eligibleRoles: ['super_admin'],
    activeRole: 'super_admin',
    teacherId: null,
    studentId: null,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
    scope: { kind: 'super_admin' },
  }, 'the cloud registration result must issue a short-lived lease bound to this session and device');
  assert.strictEqual(crypto.verify(
    null,
    Buffer.from(JSON.stringify(unsignedLease), 'utf8'),
    leaseKeyPair.publicKey,
    Buffer.from(registered.offlineLease.signature, 'base64url'),
  ), true,
    'the lease is signed by the cloud service over every locally persisted binding');
  assert.strictEqual(calls.issued.length, 1);
  assert.strictEqual(calls.registered.length, 1);
  assert.strictEqual(calls.issued[0].authorityId, 'tenant-1');
  assert.strictEqual(calls.issued[0].accountId, 'account-1');
  assert.strictEqual(calls.issued[0].deviceId, `desktop-device-${crypto.createHash('sha256').update(crypto.createPublicKey(publicKey).export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 32)}`);
  assert.strictEqual(calls.issued[0].canonicalRequestSha256, calls.registered[0].canonicalRequestSha256);
  assert.strictEqual(calls.registered[0].canonicalResultJson, JSON.stringify({ sessionId: calls.registered[0].sessionId }));
  assert.deepStrictEqual(
    await service.sessionContext({ sessionToken: registered.sessionToken }),
    {
      authorityId: 'tenant-1',
      accountId: 'account-1',
      deviceId: calls.issued[0].deviceId,
      installationId: 'installation-1',
      sessionId: registered.sessionId,
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
      roles: ['super_admin'],
      teacherId: null,
      studentId: null,
    },
    'a desktop session context must be derived from the signed current cloud session',
  );
  assert.strictEqual(calls.sessionContexts.length, 2, 'registration re-reads the cloud session before issuing its lease');
  await assert.rejects(
    () => service.sessionContext({ sessionToken: `${registered.sessionToken}x` }),
    error => error.code === 'CLOUD_ONLINE_IDENTITY_REJECTED',
  );

  await assert.rejects(() => service.begin({ phoneCode: 'not-verified' }), error => error.code === 'CLOUD_ONLINE_IDENTITY_REJECTED');
  await assert.rejects(() => service.register({ verificationToken: started.verificationToken, installationId: 'installation-1', installationPublicKey: publicKey, deviceProof: 'bad', idempotencyKey: 'registration-1' }), error => error.code === 'CLOUD_ONLINE_IDENTITY_REJECTED');
  await assert.rejects(() => service.register({ verificationToken: `${started.verificationToken}x`, installationId: 'installation-1', installationPublicKey: publicKey, deviceProof: proof, idempotencyKey: 'registration-1' }), error => error.code === 'CLOUD_ONLINE_IDENTITY_REJECTED');
  assert.throws(() => createOperatorPhoneLookup({ pepper, records: [{ ...records[0], authorityId: 'tenant-2' }, { ...records[0], accountId: 'account-2' }] }), error => error.code === 'CLOUD_ONLINE_IDENTITY_INVALID');

  const pendingService = createCloudDesktopRegistrationService({
    now: () => new Date(now), randomId: prefix => `${prefix}-pending`, phoneVerifier: async () => '13700000000',
    lookupAccount: async () => ({ authorityId: 'tenant-1', accountId: 'account-pending', phoneHmac }), ticketSecret, leasePrivateKey: leaseKeyPair.privateKey,
    issueAssertion: async () => {}, register: async input => ({ receiptId: input.receiptId, sessionId: input.sessionId, replayed: false }),
    readSessionContext: async input => ({
      authorityId: input.authorityId, accountId: input.accountId, deviceId: input.deviceId, installationId: input.installationId,
      sessionId: input.sessionId, expiresAt: input.expiresAt, roles: ['pending'], teacherId: null, studentId: null,
    }),
  });
  const pendingStarted = await pendingService.begin({ phoneCode: 'verified-phone-code' });
  const pendingTicket = pendingService.inspectVerificationToken(pendingStarted.verificationToken);
  const pendingProof = crypto.sign(null, Buffer.from(pendingTicket.challenge, 'utf8'), privateKey).toString('base64url');
  await assert.rejects(() => pendingService.register({
    verificationToken: pendingStarted.verificationToken, installationId: 'installation-pending', installationPublicKey: publicKey, deviceProof: pendingProof, idempotencyKey: 'registration-pending',
  }), error => error && error.code === 'CLOUD_ONLINE_IDENTITY_REJECTED',
  'a no-role account must not receive a desktop lease before teacher registration');

  console.log('cloud desktop registration service checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
