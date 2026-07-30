const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const packageJson = require('../package.json');
const {
  createDesktopAuthorityRuntime,
} = require('./desktopAuthorityRuntime');
const {
  createSignedAuthorityProjection,
} = require('../shared/authorityProjectionProtocol');

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

(async function main() {
  for (const packagedFile of [
    'public/desktopAuthorityRuntime.js',
    'src/services/desktopCommandOutbox.mjs',
    'src/services/desktopAuthorityClient.mjs',
    'src/services/authorityTransports.mjs',
    'src/services/authorityWebSocketTransport.mjs',
  ]) {
    assert.ok(packageJson.build.files.includes(packagedFile), `${packagedFile} must be packaged`);
  }
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-desktop-authority-runtime-'));
  const outboxPath = path.join(workspace, 'authority-outbox.bin');
  const envelope = Object.freeze({
    protocol: 'gewu.authority-command.v1',
    commandId: 'command-runtime-1',
    idempotencyKey: 'key-runtime-1',
    authorityId: 'authority-1',
    hostEpochId: 'epoch-1',
    actor: Object.freeze({ userId: 'user-1', deviceId: 'device-1', role: 'teacher' }),
    lease: Object.freeze({ id: 'lease-1', grantVersion: 1 }),
    type: 'schedule.update.v1',
    payload: Object.freeze({ id: 'schedule-1', changes: Object.freeze({ notes: 'private runtime draft' }) }),
    payloadHash: 'payload-hash-1',
    createdAt: '2026-07-28T00:00:00.000Z',
  });
  const receipt = Object.freeze({
    protocol: 'gewu.authority-receipt.v1',
    commandId: envelope.commandId,
    payloadHash: envelope.payloadHash,
    status: 'committed',
    resultHash: 'result-hash-1',
    authorityId: envelope.authorityId,
    hostEpochId: envelope.hostEpochId,
    projectionVersion: 1,
    completedAt: '2026-07-28T00:00:01.000Z',
    result: Object.freeze({ ok: true }),
  });
  const calls = [];
  const hostKeyPair = require('crypto').generateKeyPairSync('ed25519');
  const hostPublicKey = hostKeyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const projection = createSignedAuthorityProjection({
    authorityId: envelope.authorityId,
    hostEpochId: envelope.hostEpochId,
    userId: envelope.actor.userId,
    role: envelope.actor.role,
    sourceVersion: 1,
    generatedAt: '2026-07-28T00:00:02.000Z',
    payload: { schedules: [], courses: [], assets: [], questionPreviews: [] },
    privateKey: hostKeyPair.privateKey,
  });
  const vault = {
    createAuthorityCommand: input => {
      assert.strictEqual(input.type, envelope.type);
      return { envelope };
    },
    signAuthorityHttpRequest: input => ({
      actor: envelope.actor,
      authorityId: envelope.authorityId,
      hostEpochId: envelope.hostEpochId,
      hostPublicKey,
      leaseId: envelope.lease.id,
      grantVersion: envelope.lease.grantVersion,
      headers: {
        'x-gewu-authority-user-id': 'user-1',
        'x-gewu-authority-device-id': 'device-1',
        'x-gewu-authority-role': 'teacher',
        'x-gewu-device-signature': `signature:${input.method}:${input.path}`,
      },
    }),
  };
  const runtime = createDesktopAuthorityRuntime({
    filePath: outboxPath,
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: value => Buffer.from(`safe:${Buffer.from(value).toString('base64')}`),
      decryptString: value => Buffer.from(Buffer.from(value).toString().slice(5), 'base64').toString(),
    },
    vault,
    lanBaseUrl: 'http://host.lan',
    durableRelayBaseUrl: 'https://control.example',
    lanTransport: { name: 'lan', isReady: async () => false },
    relayWebSocketTransport: { name: 'relay-websocket', isReady: async () => false },
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (url.endsWith('/api/authority/commands') && options.method === 'POST') {
        assert.strictEqual(options.headers['x-gewu-device-signature'],
          'signature:POST:/api/authority/commands');
        assert.deepStrictEqual(JSON.parse(options.body), envelope);
        return response(202, { success: true, command: { id: envelope.commandId } });
      }
      if (url.endsWith(`/api/authority/commands/${envelope.commandId}/receipt`)) {
        assert.strictEqual(options.headers['x-gewu-device-signature'],
          `signature:GET:/api/authority/commands/${envelope.commandId}/receipt`);
        return response(200, { success: true, receipt });
      }
      if (url === 'http://host.lan/api/authority/projections/current') {
        return response(503, { error: { code: 'HOST_TEMPORARILY_UNAVAILABLE' } });
      }
      if (url === 'https://control.example/api/authority/projections/current') {
        assert.strictEqual(options.headers['x-gewu-authority-id'], envelope.authorityId);
        assert.strictEqual(options.headers['x-gewu-authority-lease-id'], envelope.lease.id);
        return response(200, { success: true, projection });
      }
      throw new Error(`unexpected request ${url}`);
    },
    sleep: async () => {},
    now: () => '2026-07-28T00:00:00.000Z',
  });

  const draft = await runtime.appendDraft({
    type: envelope.type,
    payload: envelope.payload,
    preview: { title: 'Runtime schedule update' },
  });
  assert.strictEqual(draft.status, 'awaiting_confirmation');
  assert.ok(!fs.readFileSync(outboxPath, 'utf8').includes('private runtime draft'));
  assert.strictEqual(await runtime.submit(draft.id), undefined);
  assert.strictEqual(calls.length, 0);
  const completed = await runtime.confirmAndSubmit(draft.id);
  assert.strictEqual(completed.transportUsed, 'durable-relay');
  assert.deepStrictEqual(completed.receipt, receipt);
  assert.strictEqual((await runtime.get(draft.id)).status, 'completed');
  assert.deepStrictEqual(await runtime.readProjection(), projection);
  assert.ok(calls.some(call => call.url === 'http://host.lan/api/authority/projections/current'));
  assert.ok(calls.some(call => call.url === 'https://control.example/api/authority/projections/current'));
  assert.deepStrictEqual(
    await runtime.readProjection({ minSourceVersion: receipt.projectionVersion }),
    projection,
  );
  const syncDraft = runtime.appendDraftSync({
    type: 'student.update.v1',
    payload: { id: 'student-1', changes: { notes: 'synchronous encrypted draft' } },
  });
  assert.strictEqual(syncDraft.status, 'awaiting_confirmation');
  assert.ok(!fs.readFileSync(outboxPath, 'utf8').includes('synchronous encrypted draft'));
  assert.strictEqual((await runtime.get(syncDraft.id)).type, 'student.update.v1');
  const syncBatch = runtime.appendDraftBatchSync([
    {
      type: 'schedule.create.v1',
      payload: { id: 'schedule-batch-1', values: { courseId: 'course-1' } },
    },
    {
      type: 'schedule.delete.v1',
      payload: { id: 'schedule-batch-2' },
    },
  ]);
  assert.strictEqual(syncBatch.length, 2);
  assert.strictEqual((await runtime.get(syncBatch[0].id)).type, 'schedule.create.v1');
  assert.strictEqual((await runtime.get(syncBatch[1].id)).type, 'schedule.delete.v1');
  const batchSnapshot = fs.readFileSync(outboxPath, 'utf8');
  assert.throws(() => runtime.appendDraftBatchSync([
    { type: 'schedule.update.v1', payload: { id: 'schedule-batch-1', changes: {} } },
    { type: 'legacy-row-mutation', payload: { id: 'bad' } },
  ]), /AUTHORITY_DRAFT_INVALID/);
  assert.strictEqual(
    fs.readFileSync(outboxPath, 'utf8'),
    batchSnapshot,
    'an invalid draft must reject the entire batch without changing the encrypted outbox',
  );

  const preloadSource = fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf8');
  const electronSource = fs.readFileSync(path.join(__dirname, 'electron.js'), 'utf8');
  const runtimeSource = fs.readFileSync(path.join(__dirname, 'desktopAuthorityRuntime.js'), 'utf8');
  assert.ok(runtimeSource.includes("const crypto = require('crypto');"));
  assert.ok(runtimeSource.includes('function createSecureOutboxId()'));
  assert.ok(runtimeSource.includes('crypto.randomBytes(16).toString(\'hex\')'));
  assert.ok(runtimeSource.includes('createId ? createId() : createSecureOutboxId()'));
  assert.ok(runtimeSource.includes('createId: createId || createSecureOutboxId'),
    'Electron main must supply a Node randomUUID fallback when Web Crypto is absent');
  assert.ok(runtimeSource.includes('createAuthorityWebSocketTransport'));
  assert.ok(runtimeSource.includes("socketTransport('lan-websocket', lanBaseUrl)"),
    'a LAN WebSocket receipt must identify the concrete LAN WebSocket transport');
  assert.ok(runtimeSource.includes("socketTransport('relay-websocket', relayWebSocketBaseUrl)"));
  assert.ok(electronSource.includes('lanBaseUrl: runtimeConfig.hostBaseUrl'));
  assert.ok(electronSource.includes('relayWebSocketBaseUrl: runtimeConfig.cloudBaseUrl'));
  assert.ok(electronSource.includes('WebSocketImpl: AUTHORITY_WEBSOCKET_ENABLED ? WebSocket : undefined'),
    'the WebSocket-disabled mode must remove both LAN and relay WebSocket transports before selection');
  assert.ok(preloadSource.includes("contextBridge.exposeInMainWorld('desktopAuthority'"));
  for (const channel of [
    'desktop-authority:append-draft',
    'desktop-authority:get',
    'desktop-authority:list',
    'desktop-authority:read-projection',
    'desktop-authority:submit',
    'desktop-authority:confirm-and-submit',
  ]) {
    assert.ok(electronSource.includes(`ipcMain.handle('${channel}'`), `${channel} must stay in Electron main`);
  }
  assert.ok(electronSource.includes("ipcMain.on('desktop-authority:append-draft-sync'"));
  assert.ok(electronSource.includes("ipcMain.on('desktop-authority:append-draft-batch-sync'"));
  assert.ok(preloadSource.includes("ipcRenderer.sendSync('desktop-authority:append-draft-sync'"));
  assert.ok(preloadSource.includes("ipcRenderer.sendSync('desktop-authority:append-draft-batch-sync'"));
  assert.ok(preloadSource.includes("get: id => ipcRenderer.invoke('desktop-authority:get', id)"),
    'the renderer facade must read a command receipt by draft id');

  fs.rmSync(workspace, { recursive: true, force: true });
  console.log('desktop authority runtime tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
