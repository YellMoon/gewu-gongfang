const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDesktopAuthorityRuntime } = require('./desktopAuthorityRuntime');

(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-draft-scope-'));
  let userId = 'account-A', activeRole = 'super_admin', sequence = 0, switchOnRead = false, switchOnWrite = false;
  const calls = [];
  const filePath = path.join(directory, 'outbox');
  const configuration = {
    filePath, cloudBusinessBaseUrl: 'https://scope.invalid', now: () => '2026-10-07T00:00:00Z',
    createId: () => `draft-${++sequence}`, isOnline: () => true,
    safeStorage: { isEncryptionAvailable: () => true, encryptString: value => {
      if (switchOnWrite) { switchOnWrite = false; userId = 'account-B'; }
      return Buffer.from(value);
    }, decryptString: value => {
      if (switchOnRead) { switchOnRead = false; userId = 'account-B'; }
      return value.toString();
    } },
    vault: { status: () => ({ state: 'unlocked', unlocked: true, user: { id: userId },
      deviceId: 'device', authorizationId: 'authorization', credentialVersion: 1, activeRole,
      offlineLease: { userId, deviceId: 'device', authorizationId: 'authorization', credentialVersion: 1,
        issuedAt: '2026-10-06T00:00:00Z', expiresAt: '2026-10-08T00:00:00Z' } }) },
    fetchImpl: async (url, options) => { calls.push({ url, options }); return { ok: true, status: 200,
      json: async () => ({ ok: true, room: { id: 'room-A', updatedAt: '2026-10-07T00:00:01Z' } }) }; },
  };
  try {
    const runtime = createDesktopAuthorityRuntime(configuration);
    const draft = runtime.appendDraftSync({ type: 'room.create.v1', payload: { record: { id: 'room-A', name: 'Private A' } } });
    const snapshot = fs.readFileSync(filePath, 'utf8');
    userId = 'account-B';
    assert.deepEqual(await runtime.list(), [], 'account B must not see account A drafts');
    for (const operation of [() => runtime.get(draft.id), () => runtime.removeDraft(draft.id),
      () => runtime.resetDraft(draft.id), () => runtime.submit(draft.id, { sessionToken: 'B-token' }),
      () => runtime.confirmAndSubmit(draft.id, { sessionToken: 'B-token' })]) {
      await assert.rejects(operation, error => error.code === 'AUTHORITY_OUTBOX_ITEM_NOT_FOUND');
    }
    assert.equal(fs.readFileSync(filePath, 'utf8'), snapshot);
    assert.equal(calls.length, 0, 'foreign-account drafts never reach the cloud');
    userId = 'account-A';
    assert.equal((await runtime.get(draft.id)).id, draft.id);
    const otherAuthority = createDesktopAuthorityRuntime({ ...configuration, cloudBusinessBaseUrl: 'https://other.invalid' });
    assert.deepEqual(await otherAuthority.list(), []);
    await assert.rejects(otherAuthority.get(draft.id), error => error.code === 'AUTHORITY_OUTBOX_ITEM_NOT_FOUND');
    const state = JSON.parse(Buffer.from(snapshot, 'base64').toString());
    state.items.legacy = { ...state.items[draft.id], id: 'legacy', draftScope: undefined };
    fs.writeFileSync(filePath, Buffer.from(JSON.stringify(state)).toString('base64'));
    assert.deepEqual((await runtime.list()).map(item => item.id), [draft.id], 'unscoped legacy drafts fail closed');
    await assert.rejects(runtime.get('legacy'), error => error.code === 'AUTHORITY_OUTBOX_ITEM_NOT_FOUND');
    switchOnRead = true;
    await assert.rejects(runtime.get(draft.id), error => error.code === 'DESKTOP_IDENTITY_CHANGED_DURING_DRAFT_OPERATION');
    userId = 'account-A'; switchOnWrite = true;
    await assert.rejects(runtime.confirmAndSubmit(draft.id, { sessionToken: 'A-token' }),
      error => error.code === 'DESKTOP_IDENTITY_CHANGED_DURING_DRAFT_OPERATION');
    assert.equal(calls.length, 0, 'account switch before durable confirmation must cancel submission');
    userId = 'account-A';
    assert.equal((await runtime.get(draft.id)).status, 'awaiting_confirmation');
    const { buildAuthorityBackedBrowserCache } = await import('../src/services/authorityProjectionCacheAdapter.mjs');
    const projection = { protocol: 'gewu.authority-projection.v1', sourceVersion: 1,
      role: 'super_admin', userId: 'account-B', businessAuthority: configuration.cloudBusinessBaseUrl, payload: { rooms: [] } };
    assert.deepEqual(buildAuthorityBackedBrowserCache({ projection, outbox: [draft] }).rooms, []);
    projection.userId = 'account-A';
    assert.equal(buildAuthorityBackedBrowserCache({ projection, outbox: [draft] }).rooms[0].name, 'Private A');
    projection.role = 'teacher';
    assert.deepEqual(buildAuthorityBackedBrowserCache({ projection, outbox: [draft] }).rooms, [], 'a narrower role cannot overlay former-role drafts');
    activeRole = 'teacher';
    assert.deepEqual(await runtime.list(), [], 'former-role drafts do not auto-submit');
    activeRole = 'super_admin'; projection.role = 'super_admin';
    projection.businessAuthority = 'https://other.invalid';
    assert.deepEqual(buildAuthorityBackedBrowserCache({ projection, outbox: [draft] }).rooms, []);
    assert.deepEqual(buildAuthorityBackedBrowserCache({ projection, outbox: [{ ...draft, draftScope: undefined }] }).rooms, []);
    const second = runtime.appendDraftSync({ type: 'room.create.v1', createdOffline: true, payload: { record: { id: 'room-2', name: 'Second' } } });
    await runtime.confirmBatch([{ id: draft.id, type: draft.type, payload: draft.payload }, { id: second.id, type: second.type, payload: second.payload }], { sessionToken: 'A-token' });
    const restarted = createDesktopAuthorityRuntime(configuration);
    assert.deepEqual((await restarted.list()).map(item => item.status), ['confirmed', 'confirmed'], 'whole-batch approval is durable across native restart');
    await assert.rejects(restarted.confirmBatch([{ id: draft.id, type: draft.type, payload: { changed: true } }], { sessionToken: 'A-token' }), error => error.code === 'AUTHORITY_DRAFT_CONFIRMATION_CHANGED');
    console.log('desktop draft account/authority isolation and identity races passed');
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    fs.rmSync(directory, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
