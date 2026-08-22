const assert = require('assert');

(async function main() {
  const { createDesktopCommandOutbox } = await import('./desktopCommandOutbox.mjs');
  const { createDesktopAuthorityClient } = await import('./desktopAuthorityClient.mjs');
  let sealed = '';
  const outbox = createDesktopCommandOutbox({
    store: {
      read: async () => sealed,
      write: async value => { sealed = value; },
    },
    codec: {
      seal: async value => Buffer.from(JSON.stringify(value)).toString('base64'),
      open: async value => JSON.parse(Buffer.from(value, 'base64').toString('utf8')),
    },
    createId: () => 'draft-1',
    now: () => '2026-07-28T00:00:00.000Z',
  });
  let submissions = 0;
  const envelope = Object.freeze({
    protocol: 'gewu.authority-command.v1',
    commandId: 'command-1',
    idempotencyKey: 'key-1',
    authorityId: 'authority-1',
    hostEpochId: 'epoch-1',
    actor: Object.freeze({ userId: 'user-1', deviceId: 'device-1', role: 'teacher' }),
    lease: Object.freeze({ id: 'lease-1', grantVersion: 1 }),
    type: 'schedule.update.v1',
    payload: Object.freeze({ id: 'schedule-1', changes: Object.freeze({ notes: 'safe' }) }),
    payloadHash: 'payload-hash-1',
    createdAt: '2026-07-28T00:00:00.000Z',
  });
  const receipt = Object.freeze({
    protocol: 'gewu.authority-receipt.v1',
    commandId: 'command-1',
    payloadHash: 'payload-hash-1',
    status: 'committed',
    resultHash: 'result-hash-1',
    authorityId: 'authority-1',
    hostEpochId: 'epoch-1',
    projectionVersion: 1,
    completedAt: '2026-07-28T00:00:01.000Z',
    result: Object.freeze({ ok: true }),
  });
  const client = createDesktopAuthorityClient({
    outbox,
    createEnvelope: async draft => {
      assert.strictEqual(draft.type, envelope.type);
      return envelope;
    },
    transports: {
      submit: async submitted => {
        submissions += 1;
        assert.strictEqual(submitted, envelope);
        return { receipt, transportUsed: 'lan' };
      },
    },
  });

  const queued = await client.appendDraft({
    type: envelope.type,
    payload: envelope.payload,
    preview: { title: 'Safe schedule update' },
  });
  assert.strictEqual(queued.status, 'awaiting_confirmation');
  assert.strictEqual(await client.submit(queued.id), undefined);
  assert.strictEqual(submissions, 0, 'unconfirmed offline drafts must never be sent');

  const result = await client.confirmAndSubmit(queued.id);
  assert.strictEqual(result.command.type, envelope.type);
  assert.strictEqual(result.transportUsed, 'lan');
  assert.deepStrictEqual(result.receipt, receipt);
  assert.strictEqual(submissions, 1);
  assert.strictEqual((await outbox.get(queued.id)).status, 'completed');

  let offlineSealed = '';
  const offlineStore = {
    read: async () => offlineSealed,
    write: async value => { offlineSealed = value; },
  };
  const offlineCodec = {
    seal: async value => Buffer.from(JSON.stringify(value)).toString('base64'),
    open: async value => JSON.parse(Buffer.from(value, 'base64').toString('utf8')),
  };
  const offlineOutbox = createDesktopCommandOutbox({
    store: offlineStore,
    codec: offlineCodec,
    createId: () => 'offline-draft-1',
    now: () => '2026-07-28T00:00:02.000Z',
  });
  let offlineSubmissions = 0;
  const offlineClient = createDesktopAuthorityClient({
    outbox: offlineOutbox,
    createEnvelope: async () => envelope,
    transports: { submit: async () => { offlineSubmissions += 1; return { receipt, transportUsed: 'durable-relay' }; } },
  });
  const offlineDraft = await offlineClient.appendDraft({
    type: envelope.type,
    payload: envelope.payload,
    preview: { title: 'Offline draft survives restart' },
  });
  assert.strictEqual(await offlineClient.submit(offlineDraft.id), undefined);
  assert.strictEqual(offlineSubmissions, 0, 'offline draft must not send before confirmation');

  const recoveredOutbox = createDesktopCommandOutbox({
    store: offlineStore,
    codec: offlineCodec,
    createId: () => 'offline-draft-2',
    now: () => '2026-07-28T00:00:03.000Z',
  });
  assert.strictEqual((await recoveredOutbox.get(offlineDraft.id)).status, 'awaiting_confirmation',
    'offline draft must survive restart without becoming confirmed');
  const recoveredClient = createDesktopAuthorityClient({
    outbox: recoveredOutbox,
    createEnvelope: async () => envelope,
    transports: { submit: async () => { offlineSubmissions += 1; return { receipt, transportUsed: 'durable-relay' }; } },
  });
  const recoveredResult = await recoveredClient.confirmAndSubmit(offlineDraft.id);
  assert.strictEqual(recoveredResult.transportUsed, 'durable-relay');
  assert.strictEqual(offlineSubmissions, 1, 'only an explicit post-restart confirmation may submit the offline draft');
  assert.strictEqual((await recoveredOutbox.get(offlineDraft.id)).status, 'completed');

  let retrySealed = '';
  const retryOutbox = createDesktopCommandOutbox({
    store: {
      read: async () => retrySealed,
      write: async value => { retrySealed = value; },
    },
    codec: {
      seal: async value => Buffer.from(JSON.stringify(value)).toString('base64'),
      open: async value => JSON.parse(Buffer.from(value, 'base64').toString('utf8')),
    },
    createId: () => 'retry-draft-1',
    now: () => '2026-07-28T00:00:00.000Z',
  });
  let envelopeCreations = 0;
  let retrySubmissions = 0;
  const retryClient = createDesktopAuthorityClient({
    outbox: retryOutbox,
    createEnvelope: async () => {
      envelopeCreations += 1;
      return envelope;
    },
    transports: {
      submit: async submitted => {
        retrySubmissions += 1;
        assert.strictEqual(submitted.commandId, 'command-1');
        if (retrySubmissions === 1) {
          throw Object.assign(new Error('receipt connection lost'), { code: 'AUTHORITY_RECEIPT_CONNECTION_LOST' });
        }
        return { receipt, transportUsed: 'durable-relay' };
      },
    },
  });
  const retryDraft = await retryClient.appendDraft({
    type: envelope.type,
    payload: envelope.payload,
    preview: { title: 'Retry-safe update' },
  });
  await retryOutbox.confirm(retryDraft.id);
  await assert.rejects(
    () => retryClient.submit(retryDraft.id),
    error => error?.code === 'AUTHORITY_RECEIPT_CONNECTION_LOST'
  );
  assert.strictEqual((await retryOutbox.get(retryDraft.id)).status, 'submitted');
  await retryClient.submit(retryDraft.id);
  assert.strictEqual(envelopeCreations, 1, 'a network retry must reuse the persisted command envelope');

  let rejectedSealed = '';
  const rejectedOutbox = createDesktopCommandOutbox({
    store: {
      read: async () => rejectedSealed,
      write: async value => { rejectedSealed = value; },
    },
    codec: {
      seal: async value => Buffer.from(JSON.stringify(value)).toString('base64'),
      open: async value => JSON.parse(Buffer.from(value, 'base64').toString('utf8')),
    },
    createId: () => 'rejected-draft-1',
    now: () => '2026-07-28T00:00:02.000Z',
  });
  const rejectedReceipt = {
    ...receipt,
    status: 'rejected',
    resultHash: 'rejected-result-hash',
    result: { error: { code: 'AUTHORITY_COMMAND_SCOPE_FORBIDDEN' } },
  };
  const rejectedClient = createDesktopAuthorityClient({
    outbox: rejectedOutbox,
    createEnvelope: async () => envelope,
    transports: {
      submit: async () => ({ receipt: rejectedReceipt, transportUsed: 'lan' }),
    },
  });
  const rejectedDraft = await rejectedClient.appendDraft({
    type: envelope.type,
    payload: envelope.payload,
  });
  const rejectedResult = await rejectedClient.confirmAndSubmit(rejectedDraft.id);
  assert.strictEqual(rejectedResult.rejected, true);
  assert.strictEqual((await rejectedOutbox.get(rejectedDraft.id)).status, 'conflict');

  let cloudSealed = '';
  let cloudSubmissions = 0;
  const cloudOutbox = createDesktopCommandOutbox({
    store: { read: async () => cloudSealed, write: async value => { cloudSealed = value; } },
    codec: {
      seal: async value => Buffer.from(JSON.stringify(value)).toString('base64'),
      open: async value => JSON.parse(Buffer.from(value, 'base64').toString('utf8')),
    },
    createId: () => 'question-draft-1', now: () => '2026-08-23T00:00:00.000Z',
  });
  const cloudClient = createDesktopAuthorityClient({
    outbox: cloudOutbox, createEnvelope: async () => { throw new Error('legacy envelope must not be used for question drafts'); },
    transports: { submit: async () => { throw new Error('legacy transport must not be used for question drafts'); } },
    createCloudQuestionCommand: draft => ({
      commandId: draft.id, payloadHash: 'e'.repeat(64), type: draft.type, payload: draft.payload,
    }),
    submitCloudQuestion: async command => {
      cloudSubmissions += 1;
      return {
        commandId: command.commandId, payloadHash: command.payloadHash, status: 'committed',
        result: { id: 'question-1' }, resultHash: 'f'.repeat(64),
      };
    },
  });
  const cloudDraft = await cloudClient.appendDraft({
    type: 'question.create.v1', payload: { record: { id: 'question-1' } },
  });
  assert.strictEqual(await cloudClient.submit(cloudDraft.id), undefined);
  const cloudResult = await cloudClient.confirmAndSubmit(cloudDraft.id);
  assert.strictEqual(cloudResult.transportUsed, 'cloud-question-authority');
  assert.strictEqual(cloudSubmissions, 1);
  assert.strictEqual((await cloudOutbox.get(cloudDraft.id)).status, 'completed');
  assert.ok(!Buffer.from(cloudSealed, 'base64').toString('utf8').includes('sessionToken'),
    'the outbox must never serialize a cloud login token');

  console.log('desktop authority client tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
