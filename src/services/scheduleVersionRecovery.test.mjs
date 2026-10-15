import assert from 'node:assert/strict';
import { createDesktopCommandOutbox } from './desktopCommandOutbox.mjs';
import { createDesktopAuthorityClient } from './desktopAuthorityClient.mjs';
import { createDesktopCloudBusinessDraftAdapter } from './desktopCloudBusinessDraft.mjs';
import { createDesktopSyncController } from './desktopSyncController.mjs';

const version = '2026-10-15T15:23:07.170Z';
const scope = { userId: 'user', businessAuthority: 'https://fixture.invalid', activeRole: 'admin' };
const predecessor = { id: 'create', type: 'schedule.create.v1', draftScope: scope, status: 'completed',
  payload: { record: { id: 'lesson' } }, receipt: { status: 'committed', result: { id: 'lesson', updatedAt: version } } };
const changes = { course_id: 'course', start_time: '2026-10-12T11:45:00Z', end_time: '2026-10-12T13:05:00Z',
  status: 1, room: 'Original room', calculated_tuition: 240, calculated_teacher_fee: 160,
  student_pricings: [{ student_id: 'student', tuition: 180, teacher_fee: 120, status: 1 }] };
function harness(prior = predecessor, overrides = {}) {
  const item = { id: 'adjust', type: 'schedule.update.v1', draftScope: scope, createdOffline: false,
    status: 'conflict', payload: { id: 'lesson', changes },
    conflict: { code: 'CLOUD_BUSINESS_DRAFT_EXPECTED_VERSION_REQUIRED' },
    receipt: { status: 'rejected', result: { error: { code: 'CLOUD_BUSINESS_DRAFT_EXPECTED_VERSION_REQUIRED' } } }, ...overrides };
  let stored = JSON.stringify({ protocol: 'gewu.authority-outbox.v1', items: { ...(prior ? { create: prior } : {}), adjust: item } });
  const store = { read: async () => stored, write: async value => { stored = value; } };
  const outbox = createDesktopCommandOutbox({ store, codec: { seal: JSON.stringify, open: JSON.parse } });
  const calls = [];
  const adapter = createDesktopCloudBusinessDraftAdapter({ baseUrl: 'https://fixture.invalid', sha256: value => 'hash:' + value,
    cloudClient: {
      createCloudSchedule: async () => ({ id: 'lesson', updatedAt: version }),
      updateCloudSchedule: async input => { calls.push(input); return { id: 'lesson', updatedAt: '2026-10-15T15:25:00Z' }; },
    } });
  const client = createDesktopAuthorityClient({ outbox, createCloudBusinessCommand: adapter.createCommand, submitCloudBusiness: adapter.submit });
  return { outbox, client, calls, store, item, adapter };
}

for (const status of ['awaiting_confirmation', 'confirmed', 'conflict']) {
  const f = harness(predecessor, { status });
  const before = structuredClone(f.item.payload.changes);
  await f.client.list();
  if (status !== 'conflict') await f.outbox.recoverScheduleVersion('adjust');
  const repaired = await f.outbox.get('adjust');
  assert.equal(repaired.payload.expectedVersion, version);
  assert.deepEqual(repaired.payload.changes, before, 'retain unsaved duration, attendance and fees');
  assert.equal(repaired.localRecovery.predecessorId, 'create');
  const reopened = createDesktopCommandOutbox({ store: f.store, codec: { seal: JSON.stringify, open: JSON.parse } });
  assert.equal((await reopened.get('adjust')).payload.expectedVersion, version, 'recovery survives restart');
  const controller = createDesktopSyncController({ bridge: f.client, sessionToken: () => 'fixture', isOnline: () => true, refreshProjection: async () => {} });
  await controller.tick();
  assert.equal((await f.outbox.get('adjust')).status, 'completed');
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].expectedUpdatedAt, version);
  assert.equal(controller.getState().open, false, 'missing local baseline must not produce discard popup');
  controller.stop();
}
const offline = harness(predecessor, { createdOffline: true });
await offline.client.list();
const controller = createDesktopSyncController({ bridge: offline.client, sessionToken: () => 'fixture', isOnline: () => true, refreshProjection: async () => {} });
await controller.tick();
assert.equal(offline.calls.length, 0, 'recovering metadata does not authorize offline changes');
assert.equal(controller.getState().open, true);
controller.stop();

// Resize while the create request is still pending: submit the create first,
// then use that exact receipt; never send the dependent update without a CAS.
const pendingCreate = harness({ ...predecessor, status: 'awaiting_confirmation', receipt: null, createdOffline: false,
  payload: { record: { id: 'lesson', ...changes } } }, { status: 'awaiting_confirmation' });
const pendingController = createDesktopSyncController({ bridge: pendingCreate.client, sessionToken: () => 'fixture', isOnline: () => true, refreshProjection: async () => {} });
await pendingController.tick();
assert.equal((await pendingCreate.outbox.get('adjust')).status, 'completed');
assert.equal(pendingCreate.calls.length, 1);
assert.equal(pendingCreate.calls[0].expectedUpdatedAt, version);
pendingController.stop();

const inFlight = harness({ ...predecessor, status: 'awaiting_confirmation', receipt: null, createdOffline: false,
  payload: { record: { id: 'lesson', ...changes } } }, { status: 'awaiting_confirmation', baseDraftId: 'create' });
await inFlight.outbox.confirm('create');
const command = inFlight.adapter.createCommand(await inFlight.outbox.get('create'));
await inFlight.outbox.markSubmitted('create', { commandId: 'create', payloadHash: command.payloadHash, transportUsed: 'cloud-business-authority', command });
const inFlightController = createDesktopSyncController({ bridge: inFlight.client, sessionToken: () => 'fixture', isOnline: () => true, refreshProjection: async () => {} });
await inFlightController.tick();
assert.equal((await inFlight.outbox.get('adjust')).status, 'completed', 'dependent resize waits for an in-flight create receipt');
assert.equal(inFlight.calls.length, 1);
inFlightController.stop();

const chained = harness({ ...predecessor, type: 'schedule.update.v1', payload: { id: 'lesson', expectedVersion: '2026-10-01T00:00:00Z', changes } },
  { status: 'awaiting_confirmation', baseDraftId: 'create', payload: { id: 'lesson', expectedVersion: '2026-10-01T00:00:00Z', changes } });
const chainController = createDesktopSyncController({ bridge: chained.client, sessionToken: () => 'fixture', isOnline: () => true, refreshProjection: async () => {} });
await chainController.tick();
assert.equal((await chained.outbox.get('adjust')).status, 'completed');
assert.equal(chained.calls[0].expectedUpdatedAt, version, 'a second local resize follows its exact predecessor receipt');
chainController.stop();

for (const prior of [null, { ...predecessor, status: 'submitted' },
  { ...predecessor, draftScope: { ...scope, userId: 'another' } },
  { ...predecessor, draftScope: { ...scope, activeRole: 'teacher' } },
  { ...predecessor, receipt: { status: 'committed', result: { id: 'different', updatedAt: version } } },
  { ...predecessor, receipt: { status: 'committed', result: { id: 'lesson', updatedAt: 'invalid' } } }]) {
  const f = harness(prior);
  const before = await f.outbox.get('adjust');
  await f.client.list();
  assert.deepEqual(await f.outbox.get('adjust'), before, 'unverified/mismatched receipts cannot repair a baseline');
}
for (const overrides of [
  { conflict: { code: 'CLOUD_BUSINESS_SCHEDULE_CONFLICT' } },
  { payload: { id: 'lesson', expectedVersion: '2026-10-01T00:00:00Z', changes } },
  { status: 'submitted', submission: { command: { payload: { id: 'lesson' } } } },
]) {
  const f = harness(predecessor, overrides);
  const before = await f.outbox.get('adjust');
  await f.client.list();
  assert.deepEqual(await f.outbox.get('adjust'), before, 'version conflicts and uncertain submitted commands stay unchanged');
}
console.log('real logged missing-version failure: verified receipt recovery, content preservation, retry, restart and offline confirmation passed');
