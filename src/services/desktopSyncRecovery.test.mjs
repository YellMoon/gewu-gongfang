import assert from 'node:assert/strict';
import { createDesktopCommandOutbox } from './desktopCommandOutbox.mjs';
import { createDesktopAuthorityClient } from './desktopAuthorityClient.mjs';
import { createDesktopCloudBusinessDraftAdapter } from './desktopCloudBusinessDraft.mjs';
import { createDesktopSyncController } from './desktopSyncController.mjs';

for (const failure of ['missing-version', 'CLOUD_BUSINESS_COURSE_CONFLICT', 'CLOUD_BUSINESS_COURSE_NOT_FOUND', 'ECONNRESET']) {
  let stored, attempts = 0;
  const store = { read: async () => stored, write: async value => { stored = value; } };
  const codec = { seal: JSON.stringify, open: JSON.parse };
  const outbox = createDesktopCommandOutbox({ store, codec, createId: () => 'old-draft' });
  const adapter = createDesktopCloudBusinessDraftAdapter({
    baseUrl: 'https://fixture.invalid', sha256: text => `hash:${text}`,
    cloudClient: { updateCloudCourse: async () => { attempts++; throw Object.assign(new Error(failure), { code: failure }); } }
  });
  const client = createDesktopAuthorityClient({ outbox, createCloudBusinessCommand: adapter.createCommand, submitCloudBusiness: adapter.submit });
  const draft = await client.appendDraft({ type: 'course.update.v1', payload: { id: 'deleted-course',
    ...(failure === 'missing-version' ? {} : { expectedVersion: '2026-09-28T01:00:00Z' }), changes: { name: '旧课程' } } });
  await outbox.confirm(draft.id);
  // Reproduce existing installs whose draft was persisted as submitted before failure.
  const command = adapter.createCommand(await outbox.get(draft.id));
  await outbox.markSubmitted(draft.id, { commandId: draft.id, payloadHash: command.payloadHash, transportUsed: 'cloud-business-authority', command });
  const controller = createDesktopSyncController({ bridge: client, sessionToken: () => 'fixture', isOnline: () => true,
    refreshProjection: async () => {} });
  await controller.tick();
  const saved = await outbox.get(draft.id);
  if (failure === 'ECONNRESET') {
    assert.equal(saved.status, 'submitted', 'uncertain network outcome must remain idempotently retryable');
    assert.deepEqual(saved.submission.command, command);
  } else {
    assert.equal(saved.status, 'conflict', `${failure}: persist an actionable failure`);
    assert.deepEqual(saved.payload, draft.payload, 'never synthesize a version or overwrite user content');
    assert.equal(controller.getState().open, true);
    await controller.tick();
    assert.equal(attempts, failure === 'missing-version' ? 0 : 1, 'terminal failures stop retries');
  }
  await controller.open();
  await controller.discard(draft.id);
  controller.stop();
  const reopened = createDesktopCommandOutbox({ store, codec });
  assert.deepEqual(await reopened.list(), [], 'discard must survive reopening the native store');
  assert.deepEqual(controller.getState().items, [], 'no stale row after discard');
}
console.log('legacy/missing-target sync failure, pause, network retry and durable discard passed');
