const assert = require('assert');

async function main() {
  const service = await import('./desktopAuthorizationSession.mjs');
  const values = new Map();
  const storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const ipc = new Map();
  const api = { invoke: async (channel, value) => {
    if (channel === 'desktop-auth:get') return ipc.get('credential') || null;
    if (channel === 'desktop-auth:set') { ipc.set('credential', value); return true; }
    if (channel === 'desktop-auth:clear') { ipc.delete('credential'); return true; }
    throw new Error(channel);
  } };
  assert.throws(() => service.readDesktopAuthorizationSession({ getItem: () => null }), error => error.code === 'AUTHORIZATION_CONTEXT_REQUIRED');
  let requestBody;
  const pending = await service.startPairing({ baseUrl: 'http://host', deviceId: 'd1', deviceName: 'PC' }, { storage, fetchImpl: async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return { ok: true, json: async () => ({ success: true, pairing: { id: 'p1', pairingCode: '123456', expiresAt: 'later' } }) };
  } });
  assert.strictEqual(pending.pairingCode, '123456');
  assert.deepStrictEqual(requestBody, { deviceId: 'd1', deviceName: 'PC', secret: requestBody.secret });
  assert.ok(!Object.hasOwn(requestBody, 'phone') && !Object.hasOwn(requestBody, 'userId') && !Object.hasOwn(requestBody, 'role'));
  await service.pollOrExchange({ storage, api, fetchImpl: async () => ({ ok: true, json: async () => ({ success: true, token: 'jwt', userId: 'u1', deviceId: 'd1', user: { id: 'u1', name: '教师甲', role: 'teacher' } }) }) });
  assert.strictEqual(service.readDesktopAuthorizationSession(storage).authorization, 'Bearer jwt');
  assert.strictEqual(ipc.get('credential').user.name, '教师甲');
  values.set(service.desktopAuthorizationSessionKey, JSON.stringify({ token: 'legacy', userId: 'u2', deviceId: 'd2' }));
  await service.clearDesktopAuthorizationSession({ storage, api });
  values.set(service.desktopAuthorizationSessionKey, JSON.stringify({ token: 'legacy', userId: 'u2', deviceId: 'd2' }));
  const migrated = await service.hydrateDesktopAuthorizationSession({ storage, api });
  assert.strictEqual(migrated.authorization, 'Bearer legacy');
  assert.strictEqual(values.has(service.desktopAuthorizationSessionKey), false);
  console.log('desktop authorization session tests passed');
}
main().catch(error => { console.error(error); process.exit(1); });
