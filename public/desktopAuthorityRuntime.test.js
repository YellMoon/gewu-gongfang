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

async function withTimeout(promise, timeoutMs, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

(async function main() {
  const electronMainSource = fs.readFileSync('public/electron.js', 'utf8');
  assert.match(electronMainSource, /isOnline:\s*\(\)\s*=>\s*net\.isOnline\(\)/,
    'the actual Electron runtime must provide its connectivity state to the draft boundary');
  for (const packagedFile of [
    'public/desktopAuthorityRuntime.js',
    'src/services/desktopCommandOutbox.mjs',
    'src/services/desktopAuthorityClient.mjs',
    'src/services/desktopCloudBusinessDraft.mjs',
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
    type: 'role-application.update.v1',
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
  const offlineLeaseStatus = Object.freeze({
    state: 'unlocked',
    unlocked: true,
    user: Object.freeze({ id: 'user-1' }),
    deviceId: 'device-1',
    authorizationId: 'authorization-1',
    credentialVersion: 1,
    offlineLease: Object.freeze({
      id: 'offline-lease-1',
      userId: 'user-1',
      deviceId: 'device-1',
      authorizationId: 'authorization-1',
      credentialVersion: 1,
      issuedAt: '2026-07-27T00:00:00.000Z',
      expiresAt: '2026-07-29T00:00:00.000Z',
    }),
  });
  const vault = {
    status: () => offlineLeaseStatus,
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
    cloudBusinessBaseUrl: 'https://business.example',
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
      if (url === 'https://control.example/api/desktop/question-bank/commands') {
        assert.strictEqual(options.method, 'POST');
        assert.strictEqual(options.headers.authorization, 'Bearer desktop-session-token');
        const command = JSON.parse(options.body);
        assert.strictEqual(command.type, 'question.create.v1');
        assert.match(command.payloadHash, /^[0-9a-f]{64}$/);
        return response(200, {
          ok: true,
          receipt: {
            commandId: command.commandId, payloadHash: command.payloadHash, status: 'committed',
            result: { id: 'question-runtime-1' }, resultHash: '1'.repeat(64),
          },
        });
      }
      if (url === 'https://business.example/api/business/students/student-runtime-1/record') {
        assert.strictEqual(options.method, 'PUT');
        assert.strictEqual(options.headers.Authorization, 'Bearer desktop-session-token');
        assert.deepStrictEqual(JSON.parse(options.body), {
          expectedUpdatedAt: '2026-08-23T00:00:00.000Z',
          name: 'Student Runtime', school: null, gradeYear: null, gradeCurrent: null,
          institutionId: null, parentName: null, notes: 'confirmed cloud update',
          sourceType: 1, studentSource: null, contacts: [],
        });
        return response(200, { ok: true, student: { id: 'student-runtime-1', updatedAt: '2026-08-24T00:00:01.000Z' } });
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

  let offlineNetworkCalls = 0;
  const offlineRuntime = createDesktopAuthorityRuntime({
    filePath: path.join(workspace, 'offline-authority-outbox.bin'),
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: value => Buffer.from(`safe:${Buffer.from(value).toString('base64')}`),
      decryptString: value => Buffer.from(Buffer.from(value).toString().slice(5), 'base64').toString(),
    },
    vault,
    isOnline: () => false,
    fetchImpl: async () => {
      offlineNetworkCalls += 1;
      throw new Error('offline drafts must not access a transport');
    },
    now: () => '2026-07-28T00:00:00.000Z',
  });
  const offlineDraft = await offlineRuntime.appendDraft({
    type: envelope.type,
    payload: envelope.payload,
    preview: { title: 'Offline schedule update' },
  });
  assert.strictEqual(offlineDraft.status, 'awaiting_confirmation');
  await assert.rejects(
    () => offlineRuntime.confirmAndSubmit(offlineDraft.id),
    error => error?.code === 'DESKTOP_OFFLINE_DRAFT_SUBMISSION_FORBIDDEN',
  );
  assert.strictEqual((await offlineRuntime.get(offlineDraft.id)).status, 'awaiting_confirmation',
    'an offline submit attempt must not confirm or mutate the draft');
  assert.strictEqual(offlineNetworkCalls, 0);

  const emptyVaultRuntime = createDesktopAuthorityRuntime({
    filePath: path.join(workspace, 'empty-vault-authority-outbox.bin'),
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: value => Buffer.from(`safe:${Buffer.from(value).toString('base64')}`),
      decryptString: value => Buffer.from(Buffer.from(value).toString().slice(5), 'base64').toString(),
    },
    vault: { ...vault, status: () => ({ state: 'empty', unlocked: false }) },
    isOnline: () => false,
    now: () => '2026-07-28T00:00:00.000Z',
  });
  await assert.rejects(
    () => emptyVaultRuntime.appendDraft({ type: envelope.type, payload: envelope.payload }),
    error => error?.code === 'DESKTOP_OFFLINE_DRAFT_SESSION_REQUIRED',
  );

  const expiredVaultRuntime = createDesktopAuthorityRuntime({
    filePath: path.join(workspace, 'expired-vault-authority-outbox.bin'),
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: value => Buffer.from(`safe:${Buffer.from(value).toString('base64')}`),
      decryptString: value => Buffer.from(Buffer.from(value).toString().slice(5), 'base64').toString(),
    },
    vault: {
      ...vault,
      status: () => ({
        ...offlineLeaseStatus,
        offlineLease: { ...offlineLeaseStatus.offlineLease, expiresAt: '2026-07-28T00:00:00.000Z' },
      }),
    },
    isOnline: () => false,
    now: () => '2026-07-28T00:00:00.000Z',
  });
  await assert.rejects(
    () => expiredVaultRuntime.appendDraft({ type: envelope.type, payload: envelope.payload }),
    error => error?.code === 'DESKTOP_OFFLINE_DRAFT_SESSION_EXPIRED',
  );

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
  assert.ok(!calls.some(call => call.url === 'http://host.lan/api/authority/projections/current'));
  assert.ok(calls.some(call => call.url === 'https://control.example/api/authority/projections/current'));
  assert.deepStrictEqual(
    await runtime.readProjection({ minSourceVersion: receipt.projectionVersion }),
    projection,
  );
  const timeoutRuntime = createDesktopAuthorityRuntime({
    filePath: path.join(workspace, 'authority-timeout-outbox.bin'),
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: value => Buffer.from(`safe:${Buffer.from(value).toString('base64')}`),
      decryptString: value => Buffer.from(Buffer.from(value).toString().slice(5), 'base64').toString(),
    },
    vault,
    durableRelayBaseUrl: 'https://control.example',
    requestTimeoutMs: 5,
    fetchImpl: async (url, options = {}) => {
      if (url.startsWith('http://unreachable-host.lan')) {
        return new Promise((_resolve, reject) => {
          options.signal?.addEventListener('abort', () => {
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          }, { once: true });
        });
      }
      if (url === 'https://control.example/api/authority/projections/current') {
        return response(200, { success: true, projection });
      }
      throw new Error(`unexpected request ${url}`);
    },
  });
  assert.deepStrictEqual(await Promise.race([
    timeoutRuntime.readProjection(),
    new Promise((_resolve, reject) => setTimeout(() => reject(new Error('projection fallback timed out')), 100)),
  ]), projection, 'projection reads use the cloud relay only');
  const bodyTimeoutRuntime = createDesktopAuthorityRuntime({
    filePath: path.join(workspace, 'authority-body-timeout-outbox.bin'),
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: value => Buffer.from(`safe:${Buffer.from(value).toString('base64')}`),
      decryptString: value => Buffer.from(Buffer.from(value).toString().slice(5), 'base64').toString(),
    },
    vault,
    durableRelayBaseUrl: 'https://control.example',
    requestTimeoutMs: 5,
    fetchImpl: async (url, options = {}) => {
      if (url.startsWith('http://slow-body-host.lan')) {
        return {
          ok: true,
          status: 200,
          json: () => new Promise((_resolve, reject) => {
            options.signal?.addEventListener('abort', () => {
              reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
            }, { once: true });
          }),
        };
      }
      if (url === 'https://control.example/api/authority/projections/current') {
        return response(200, { success: true, projection });
      }
      throw new Error(`unexpected request ${url}`);
    },
  });
  assert.deepStrictEqual(await Promise.race([
    bodyTimeoutRuntime.readProjection(),
    new Promise((_resolve, reject) => setTimeout(() => reject(new Error('projection body fallback timed out')), 100)),
  ]), projection, 'a cloud projection response remains available without a LAN endpoint');

  let durableReceiptCalls = 0;
  const durableTimeoutRuntime = createDesktopAuthorityRuntime({
    filePath: path.join(workspace, 'authority-durable-timeout-outbox.bin'),
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: value => Buffer.from(`safe:${Buffer.from(value).toString('base64')}`),
      decryptString: value => Buffer.from(Buffer.from(value).toString().slice(5), 'base64').toString(),
    },
    vault,
    durableRelayBaseUrl: 'https://control.example',
    relayWebSocketTransport: { name: 'relay-websocket', isReady: async () => false },
    requestTimeoutMs: 5,
    receiptPollAttempts: 3,
    receiptPollIntervalMs: 0,
    now: () => '2026-07-28T00:00:00.000Z',
    fetchImpl: async (url, options = {}) => {
      const stalledBody = () => new Promise((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        }, { once: true });
      });
      if (url.endsWith('/api/authority/commands') && options.method === 'POST') {
        return { ok: true, status: 202, json: stalledBody };
      }
      if (url.endsWith(`/api/authority/commands/${envelope.commandId}/receipt`)) {
        durableReceiptCalls += 1;
        if (durableReceiptCalls === 1) return { ok: true, status: 200, json: stalledBody };
        return response(200, { success: true, receipt });
      }
      throw new Error(`unexpected request ${url}`);
    },
  });
  const durableTimeoutDraft = await durableTimeoutRuntime.appendDraft({
    type: envelope.type,
    payload: envelope.payload,
    preview: { title: 'Durable timeout recovery' },
  });
  const durableTimeoutResult = await withTimeout(
    durableTimeoutRuntime.confirmAndSubmit(durableTimeoutDraft.id),
    10_000,
    'durable timeout recovery timed out',
  );
  assert.deepStrictEqual(durableTimeoutResult.receipt, receipt,
    'an accepted POST timeout and a transient receipt timeout must continue with idempotent receipt polling');
  assert.strictEqual(durableReceiptCalls, 2);
  const questionDraft = await runtime.appendDraft({
    type: 'question.create.v1',
    payload: { record: { id: 'question-runtime-1', subject: 'physics' } },
    preview: { title: 'Cloud question draft' },
  });
  await assert.rejects(
    () => runtime.confirmAndSubmit(questionDraft.id),
    error => error?.code === 'DESKTOP_CLOUD_SESSION_REQUIRED',
  );
  assert.strictEqual((await runtime.get(questionDraft.id)).status, 'awaiting_confirmation');
  const questionResult = await runtime.confirmAndSubmit(questionDraft.id, { sessionToken: 'desktop-session-token' });
  assert.strictEqual(questionResult.transportUsed, 'cloud-question-authority');
  assert.strictEqual((await runtime.get(questionDraft.id)).status, 'completed');
  const decryptedOutbox = Buffer.from(fs.readFileSync(outboxPath, 'utf8'), 'base64').toString('utf8');
  assert.ok(!decryptedOutbox.includes('desktop-session-token'), 'the renderer session token must not be persisted in the encrypted outbox payload');
  const legacyBusinessCallsBefore = calls.filter(call => call.url.endsWith('/api/authority/commands')).length;
  const businessDraft = await runtime.appendDraft({
    type: 'student.update.v1',
    payload: {
      id: 'student-runtime-1', expectedVersion: '2026-08-23T00:00:00.000Z',
      changes: {
        name: 'Student Runtime', school: null, grade_year: null, grade_current: null,
        institution_id: null, parent_name: null, notes: 'confirmed cloud update',
        source_type: 1, student_source: null,
      },
    },
    preview: { title: 'Cloud business draft' },
  });
  await assert.rejects(
    () => runtime.confirmAndSubmit(businessDraft.id),
    error => error?.code === 'DESKTOP_CLOUD_SESSION_REQUIRED',
  );
  assert.strictEqual((await runtime.get(businessDraft.id)).status, 'awaiting_confirmation');
  const businessResult = await runtime.confirmAndSubmit(businessDraft.id, { sessionToken: 'desktop-session-token' });
  assert.strictEqual(businessResult.transportUsed, 'cloud-business-authority');
  assert.strictEqual((await runtime.get(businessDraft.id)).status, 'completed');
  assert.strictEqual(calls.filter(call => call.url.endsWith('/api/authority/commands')).length, legacyBusinessCallsBefore,
    'cloud business drafts must never use the legacy authority command relay');
  assert.ok(!Buffer.from(fs.readFileSync(outboxPath, 'utf8'), 'base64').toString('utf8').includes('desktop-session-token'),
    'the business session token must not be persisted in the encrypted outbox payload');
  assert.strictEqual(runtime.confirmAndExecuteLocal, undefined,
    'a unified desktop must not expose a local authority execution path');
  assert.strictEqual(runtime.submitLocal, undefined,
    'a unified desktop must not expose a local authority retry path');
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
  assert.ok(runtimeSource.includes("socketTransport('relay-websocket', relayWebSocketBaseUrl)"));
  assert.ok(!runtimeSource.includes('lanBaseUrl'));
  assert.ok(electronSource.includes('relayWebSocketBaseUrl'));
  assert.ok(electronSource.includes('WebSocketImpl: WebSocket'));
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
