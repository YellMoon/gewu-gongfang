const assert = require('assert');

(async function main() {
  const { createDesktopCommandOutbox } = await import('./desktopCommandOutbox.mjs');
  const { createDesktopAuthorityClient } = await import('./desktopAuthorityClient.mjs');

  function createHarness(prefix) {
    let sealed = '';
    let sequence = 0;
    const outbox = createDesktopCommandOutbox({
      store: {
        read: async () => sealed,
        write: async value => { sealed = value; },
      },
      codec: {
        seal: async value => Buffer.from(JSON.stringify(value)).toString('base64'),
        open: async value => JSON.parse(Buffer.from(value, 'base64').toString('utf8')),
      },
      createId: () => `${prefix}-${++sequence}`,
      now: () => '2026-09-05T00:00:00.000Z',
    });
    return { outbox, readSealed: () => sealed };
  }

  function command(draft, hash = 'a'.repeat(64)) {
    return Object.freeze({
      commandId: draft.id,
      payloadHash: hash,
      type: draft.type,
      payload: draft.payload,
    });
  }

  function receipt(currentCommand, overrides = {}) {
    return Object.freeze({
      commandId: currentCommand.commandId,
      payloadHash: currentCommand.payloadHash,
      status: 'committed',
      result: { id: currentCommand.commandId },
      resultHash: 'b'.repeat(64),
      ...overrides,
    });
  }

  assert.throws(
    () => createDesktopAuthorityClient(),
    error => error?.code === 'DESKTOP_AUTHORITY_CLIENT_DEPENDENCY_REQUIRED',
  );
  const dependencyHarness = createHarness('dependency');
  assert.doesNotThrow(
    () => createDesktopAuthorityClient({ outbox: dependencyHarness.outbox }),
    'the cloud-only client must not require a retired LAN or relay transport',
  );

  const questionHarness = createHarness('question');
  let questionSubmissions = 0;
  const questionClient = createDesktopAuthorityClient({
    outbox: questionHarness.outbox,
    createCloudQuestionCommand: draft => command(draft),
    submitCloudQuestion: async currentCommand => {
      questionSubmissions += 1;
      return receipt(currentCommand);
    },
  });
  const questionDraft = await questionClient.appendDraft({
    type: 'question.create.v1',
    payload: { record: { id: 'question-1' } },
  });
  assert.strictEqual(questionDraft.status, 'awaiting_confirmation');
  assert.strictEqual(await questionClient.submit(questionDraft.id), undefined);
  assert.strictEqual(questionSubmissions, 0, 'an unconfirmed question draft must make zero cloud requests');
  const questionResult = await questionClient.confirmAndSubmit(questionDraft.id, { sessionToken: 'runtime-only-token' });
  assert.strictEqual(questionResult.transportUsed, 'cloud-question-authority');
  assert.strictEqual(questionSubmissions, 1);
  assert.strictEqual((await questionHarness.outbox.get(questionDraft.id)).status, 'completed');
  assert.ok(!Buffer.from(questionHarness.readSealed(), 'base64').toString('utf8').includes('runtime-only-token'),
    'the outbox must never serialize a cloud session token');

  const retryHarness = createHarness('retry');
  let commandCreations = 0;
  let retrySubmissions = 0;
  let firstCommand = null;
  const retryClient = createDesktopAuthorityClient({
    outbox: retryHarness.outbox,
    createCloudQuestionCommand: draft => {
      commandCreations += 1;
      return command(draft, 'c'.repeat(64));
    },
    submitCloudQuestion: async currentCommand => {
      retrySubmissions += 1;
      firstCommand ||= currentCommand;
      assert.deepStrictEqual(currentCommand, firstCommand, 'retry must reuse the persisted idempotent command');
      if (retrySubmissions === 1) throw Object.assign(new Error('connection lost'), { code: 'CLOUD_CONNECTION_LOST' });
      return receipt(currentCommand, { resultHash: 'd'.repeat(64) });
    },
  });
  const retryDraft = await retryClient.appendDraft({ type: 'question.update.v1', payload: { id: 'question-1', expectedVersion: 1, changes: { difficulty: 4 } } });
  await retryHarness.outbox.confirm(retryDraft.id);
  await assert.rejects(() => retryClient.submit(retryDraft.id), error => error?.code === 'CLOUD_CONNECTION_LOST');
  assert.strictEqual((await retryHarness.outbox.get(retryDraft.id)).status, 'submitted');
  await retryClient.submit(retryDraft.id);
  assert.strictEqual(commandCreations, 1, 'a retry must not create a second command');

  const businessHarness = createHarness('business');
  let businessSubmissions = 0;
  const businessClient = createDesktopAuthorityClient({
    outbox: businessHarness.outbox,
    createCloudBusinessCommand: draft => command(draft, 'e'.repeat(64)),
    submitCloudBusiness: async currentCommand => {
      businessSubmissions += 1;
      return receipt(currentCommand, { resultHash: 'f'.repeat(64) });
    },
  });
  const cloudBusinessEntities = [
    'student', 'teacher', 'room', 'institution', 'school', 'course', 'schedule',
    'payment', 'consumption', 'grade', 'personal-asset-category', 'personal-asset-record',
  ];
  for (const entity of cloudBusinessEntities) {
    for (const action of ['create', 'update', 'delete']) {
      const id = `${entity}-${action}`;
      const payload = action === 'create'
        ? { record: { id } }
        : { id, expectedVersion: '2026-09-05T00:00:00.000Z', ...(action === 'update' ? { changes: { name: 'edited' } } : {}) };
      const draft = await businessClient.appendDraft({ type: `${entity}.${action}.v1`, payload });
      const result = await businessClient.confirmAndSubmit(draft.id);
      assert.strictEqual(result.transportUsed, 'cloud-business-authority', `${entity}.${action} must use cloud REST authority`);
      assert.strictEqual((await businessHarness.outbox.get(draft.id)).status, 'completed');
    }
  }
  assert.strictEqual(businessSubmissions, cloudBusinessEntities.length * 3);

  const failClosedHarness = createHarness('closed');
  const failClosedClient = createDesktopAuthorityClient({ outbox: failClosedHarness.outbox });
  for (const [type, expectedCode] of [
    ['student.update.v1', 'CLOUD_BUSINESS_AUTHORITY_UNAVAILABLE'],
    ['taxonomy-system.create.v1', 'CLOUD_QUESTION_AUTHORITY_UNAVAILABLE'],
    ['pricing.create.v1', 'CLOUD_BUSINESS_DRAFT_MAPPING_REQUIRED'],
    ['authority.reconcile.v1', 'CLOUD_AUTHORITY_DRAFT_TYPE_UNSUPPORTED'],
  ]) {
    const draft = await failClosedClient.appendDraft({ type, payload: { id: type } });
    await assert.rejects(
      () => failClosedClient.confirmAndSubmit(draft.id),
      error => error?.code === expectedCode,
      `${type} must fail closed with ${expectedCode}`,
    );
  }

  assert.strictEqual(questionClient.confirmAndExecuteLocal, undefined);
  assert.strictEqual(questionClient.submitLocal, undefined);
  console.log('desktop cloud-only authority client tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
