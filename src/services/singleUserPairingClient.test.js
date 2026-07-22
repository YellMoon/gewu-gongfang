const assert = require('assert');
const crypto = require('crypto');

(async () => {
  const {
    normalizePairingCode,
    discoverPairingCapability,
    submitPairingRequest,
    pollPairingResult,
  } = await import('./singleUserPairingClient.mjs');

  assert.strictEqual(normalizePairingCode('0123-4567-89ab-cdef'), '0123456789ABCDEF');
  assert.throws(() => normalizePairingCode('0123-4567'), error => error.code === 'PAIRING_CODE_INVALID');
  assert.throws(() => normalizePairingCode('0123-4567-89IL-CDEF'), error => error.code === 'PAIRING_CODE_INVALID');

  const capability = {
    id: '0123456789abcdef0123456789abcdef',
    protocolVersion: 'gewu-single-user-pairing/v1',
    publicKey: 'host-public-key',
    expiresAt: '2099-07-23T10:10:00.000Z',
  };
  const directCalls = [];
  const direct = await discoverPairingCapability({
    lanBaseUrl: 'http://192.168.1.2:3001/',
    cloudBaseUrl: 'https://physicsedu.xyz/scheduling/',
    fetchImpl: async url => {
      directCalls.push(url);
      return { ok: true, status: 200, json: async () => ({ success: true, capability }) };
    },
  });
  assert.strictEqual(direct.channel, 'direct');
  assert.strictEqual(directCalls.length, 1, 'LAN capability must be preferred over cloud');
  assert.ok(directCalls[0].endsWith('/api/desktop-identity/single-user/pairing-capability'));

  const fallbackCalls = [];
  const cloud = await discoverPairingCapability({
    lanBaseUrl: 'http://offline-host:3001',
    cloudBaseUrl: 'https://physicsedu.xyz/scheduling',
    fetchImpl: async url => {
      fallbackCalls.push(url);
      if (url.includes('offline-host')) throw new TypeError('offline');
      return { ok: true, status: 200, json: async () => ({ success: true, capability }) };
    },
  });
  assert.strictEqual(cloud.channel, 'cloud');
  assert.strictEqual(fallbackCalls.length, 2);
  assert.ok(fallbackCalls[1].endsWith('/api/cloud/desktop-pairing/capability'));

  const envelope = {
    protocolVersion: capability.protocolVersion,
    capabilityId: capability.id,
    clientEphemeralPublicKey: 'ephemeral',
    iv: 'iv',
    ciphertext: 'ciphertext',
    tag: 'tag',
  };
  let directBody = '';
  const directSubmitted = await submitPairingRequest({
    discovery: direct,
    envelope,
    fetchImpl: async (_url, options) => {
      directBody = options.body;
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, authorization: { id: 'auth-1' }, profile: {}, offlineLease: {} }),
      };
    },
  });
  assert.strictEqual(directSubmitted.status, 'completed');
  assert.strictEqual(directSubmitted.result.authorization.id, 'auth-1');
  assert.deepStrictEqual(JSON.parse(directBody), envelope);
  await assert.rejects(
    submitPairingRequest({
      discovery: direct,
      envelope,
      fetchImpl: async () => ({
        ok: false,
        status: 410,
        json: async () => ({ success: false, code: 'DESKTOP_PAIRING_GRANT_EXPIRED' }),
      }),
    }),
    error => error.code === 'PAIRING_CODE_EXPIRED'
  );

  let cloudBody = null;
  const cryptoImpl = {
    getRandomValues(target) { target.fill(7); return target; },
    subtle: {
      async digest(_algorithm, data) {
        return crypto.createHash('sha256').update(Buffer.from(data)).digest();
      },
    },
  };
  const cloudSubmitted = await submitPairingRequest({
    discovery: cloud,
    envelope,
    cryptoImpl,
    fetchImpl: async (_url, options) => {
      cloudBody = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, request: { id: 'request-1', status: 'pending_host', expiresAt: capability.expiresAt } }),
      };
    },
  });
  assert.strictEqual(cloudSubmitted.status, 'pending_host');
  assert.strictEqual(cloudSubmitted.requestSecret, '07070707070707070707070707070707');
  assert.strictEqual(cloudBody.requestSecretHash, crypto.createHash('sha256').update(cloudSubmitted.requestSecret).digest('hex'));
  assert.deepStrictEqual(cloudBody.envelope, envelope);
  assert.ok(!JSON.stringify(cloudBody).includes(cloudSubmitted.requestSecret), 'raw request secret must stay in local memory');

  let pollSecret = '';
  const completed = await pollPairingResult({
    pending: cloudSubmitted,
    fetchImpl: async (_url, options) => {
      pollSecret = options.headers['x-pairing-request-secret'];
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          request: {
            id: 'request-1',
            status: 'completed',
            result: { authorization: { id: 'auth-1' }, profile: {}, offlineLease: {} },
          },
        }),
      };
    },
  });
  assert.strictEqual(pollSecret, cloudSubmitted.requestSecret);
  assert.strictEqual(completed.result.authorization.id, 'auth-1');

  await assert.rejects(
    pollPairingResult({
      pending: cloudSubmitted,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ success: true, request: { status: 'rejected', errorCode: 'PAIRING_CODE_USED' } }),
      }),
    }),
    error => error.code === 'PAIRING_CODE_USED'
  );

  console.log('single-user pairing client checks passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
