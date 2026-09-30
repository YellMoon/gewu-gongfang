const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');
const { createDesktopAuthorityRuntime } = require('../../public/desktopAuthorityRuntime');

(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-cloud-transport-draft-'));
  const configuration = {
    filePath: path.join(directory, 'outbox.bin'),
    cloudBusinessBaseUrl: 'https://business.example',
    // Windows virtual adapters can report online after physical Wi-Fi is lost.
    isOnline: () => true,
    now: () => '2026-09-30T00:00:00Z',
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: value => Buffer.from(value),
      decryptString: value => value.toString(),
    },
    vault: { status: () => ({ state: 'unlocked', unlocked: true, user: { id: 'user-test' },
      deviceId: 'device-test', authorizationId: 'authorization-test', credentialVersion: 1,
      offlineLease: { userId: 'user-test', deviceId: 'device-test', authorizationId: 'authorization-test',
        credentialVersion: 1, issuedAt: '2026-09-29T00:00:00Z', expiresAt: '2026-10-01T00:00:00Z' } }) },
  };
  try {
    const native = createDesktopAuthorityRuntime(configuration);
    const explicit = native.appendDraftSync({ type: 'room.create.v1', payload: { record: { id: 'explicit', name: 'Temporary' } }, createdOffline: true });
    assert.equal(explicit.createdOffline, true, 'observed cloud failure must outweigh an online virtual adapter');

    const identity = await import('./desktopIdentityClient.mjs');
    const adapter = await import('./authorityDraftAdapter.mjs');
    const { planDesktopAutoSync } = await import('./desktopAutoSync.mjs');
    const client = identity.createDesktopIdentityClient({ desktopIdentity: configuration.vault,
      fetchImpl: async () => { throw new TypeError('Failed to fetch'); }, sessionStore: { save() {}, clear() {} } });
    await assert.rejects(client.createCloudRoom({ baseUrl: configuration.cloudBusinessBaseUrl,
      currentSession: { token: 'test-session', offline: false }, roomId: 'first', name: 'First' }), TypeError);

    const source = fs.readFileSync('src/services/browserDatabase.ts', 'utf8');
    const start = source.indexOf('  private recordAuthorityDraft(');
    const end = source.indexOf('  private compactLargeQuestionPayloads()', start);
    assert(start >= 0 && end > start);
    const compiled = ts.transpileModule('class Capture {\n' + source.slice(start, end) + '\n}\nglobalThis.Capture=Capture;', {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const sandbox = { createAuthorityDraftFromLocalMutation: adapter.createAuthorityDraftFromLocalMutation,
      captureDesktopCloudDraftConnectivity: identity.captureDesktopCloudDraftConnectivity,
      window: { desktopAuthority: native, dispatchEvent() {} }, Event: class {} };
    vm.runInNewContext(compiled, sandbox);
    const capture = new sandbox.Capture();
    capture.authorityCacheCheckpoint = { guard: operation => operation() };
    capture.recordAuthorityDraft('rooms', 'create', 'first', { id: 'first', name: 'First' });
    capture.recordAuthorityDraftBatch([{ collection: 'rooms', action: 'create', recordId: 'second', value: { id: 'second', name: 'Second' } }]);

    const restarted = createDesktopAuthorityRuntime(configuration);
    const offline = (await restarted.list()).filter(d => ['first', 'second'].includes(d.payload.record?.id));
    assert.equal(offline.length, 2);
    assert(offline.every(d => d.createdOffline === true && d.status === 'awaiting_confirmation'));
    const plan = planDesktopAutoSync(offline);
    assert.equal(plan.onlineIds.length, 0, 'reconnect must not silently submit either offline draft');
    assert.equal(plan.offlineIds.length, 2, 'both drafts belong to one reviewed batch');

    const onlineClient = identity.createDesktopIdentityClient({ desktopIdentity: configuration.vault,
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, room: { id: 'third', updatedAt: '2026-09-30T00:00:00Z' } }) }),
      sessionStore: { save() {}, clear() {} } });
    await onlineClient.createCloudRoom({ baseUrl: configuration.cloudBusinessBaseUrl,
      currentSession: { token: 'test-session', offline: false }, roomId: 'third', name: 'Third' });
    capture.recordAuthorityDraft('rooms', 'create', 'fourth', { id: 'fourth', name: 'Fourth' });
    capture.recordAuthorityDraft('rooms', 'update', 'first', { name: 'First edited after reconnect' });
    const all = await native.list();
    assert.equal(all.find(d => d.payload.record?.id === 'fourth').createdOffline, false, 'fresh online edits keep automatic submission');
    assert(all.filter(d => ['first', 'second'].includes(d.payload.record?.id)).every(d => d.createdOffline === true),
      'a later successful cloud request must not clear the durable confirmation requirement');
    console.log('desktop cloud transport draft capture passed');
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert(path.basename(directory).startsWith('gewu-cloud-transport-draft-'));
    fs.rmSync(directory, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
