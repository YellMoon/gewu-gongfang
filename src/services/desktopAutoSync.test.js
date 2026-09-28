'use strict';
// UTF-8: online drafts auto-submit, offline drafts await one aggregate confirmation, conflicts pause.
const assert = require('node:assert/strict');

(async () => {
  const { planDesktopAutoSync, submitSequentially } = await import('./desktopAutoSync.mjs');

  assert.deepEqual(planDesktopAutoSync([
    { id: 'a', status: 'awaiting_confirmation', createdOffline: false },
    { id: 'b', status: 'awaiting_confirmation', createdOffline: true },
    { id: 'c', status: 'completed' },
    { id: 'd', status: 'submitted' },
  ]), { blocked: false, onlineIds: ['a'], offlineIds: ['b'], retryIds: ['d'] });
  assert.equal(planDesktopAutoSync([{ id: 'x', status: 'conflict' }]).blocked, true);
  assert.deepEqual(planDesktopAutoSync(undefined), { blocked: false, onlineIds: [], offlineIds: [], retryIds: [] });
  const offlineRoom = { id: 'room-draft', type: 'room.create.v1', status: 'awaiting_confirmation', createdOffline: true, payload: { record: { id: 'room' } } };
  const onlineCourse = { id: 'course-draft', type: 'course.create.v1', status: 'awaiting_confirmation', createdOffline: false, payload: { record: { id: 'course', room_id: 'room' } } };
  assert.deepEqual(planDesktopAutoSync([offlineRoom, onlineCourse]).onlineIds, [], 'online course must not silently confirm its offline address');
  assert.deepEqual(planDesktopAutoSync([offlineRoom, onlineCourse]).offlineIds, ['room-draft', 'course-draft']);
  assert.deepEqual(planDesktopAutoSync([{ id: 'legacy', status: 'awaiting_confirmation' }]).offlineIds, ['legacy'], 'legacy drafts without a connectivity classification require confirmation');

  const items = [
    { id: 'a', type: 'schedule.update.v1', status: 'awaiting_confirmation', payload: { id: 'a', changes: { notes: 'x' } } },
    { id: 'b', type: 'schedule.update.v1', status: 'awaiting_confirmation', payload: { id: 'b', changes: { notes: 'y' } } },
  ];
  const calls = [];
  const bridge = { list: async () => items, confirmAndSubmit: async (id) => { calls.push(id); return { receipt: { status: id === 'a' ? 'rejected' : 'committed' } }; } };
  const outcomes = await submitSequentially({ bridge, items, ids: ['a', 'b'], sessionToken: 'token' });
  assert.deepEqual(calls, ['a'], 'submission stops after a rejected draft');
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].rejected, true);

  const okCalls = [];
  const okBridge = { list: async () => items, confirmAndSubmit: async (id) => { okCalls.push(id); return { receipt: { status: 'committed' } }; } };
  const okOutcomes = await submitSequentially({ bridge: okBridge, items, ids: ['a', 'b'], sessionToken: 'token' });
  assert.deepEqual(okCalls, ['a', 'b']);
  assert.equal(okOutcomes.length, 2);

  const errorBridge = { list: async () => items, confirmAndSubmit: async () => { throw Object.assign(new Error('conflict'), { code: 'CLOUD_BUSINESS_VERSION_CONFLICT' }); } };
  const errorOutcomes = await submitSequentially({ bridge: errorBridge, items, ids: ['a'], sessionToken: 'token' });
  assert.equal(errorOutcomes[0].error, 'CLOUD_BUSINESS_VERSION_CONFLICT');

  const changed = structuredClone(items);
  changed[0].payload.changes.name = 'changed after confirmation opened';
  let unexpectedSends = 0;
  const changedBridge = { list: async () => changed, confirmAndSubmit: async () => { unexpectedSends++; } };
  const changedResult = await submitSequentially({ bridge: changedBridge, items, ids: ['a', 'b'], sessionToken: 'token' });
  assert.equal(changedResult[0].error, 'AUTHORITY_DRAFT_CONFIRMATION_CHANGED');
  assert.equal(unexpectedSends, 0, 'a newer payload is not covered by an earlier decision');
  const dependencyBridge = { list: async () => [offlineRoom, onlineCourse], confirmAndSubmit: async () => { unexpectedSends++; } };
  const dependencyResult = await submitSequentially({ bridge: dependencyBridge, items: [offlineRoom, onlineCourse], ids: ['course-draft'], sessionToken: 'token' });
  assert.equal(dependencyResult[0].error, 'AUTHORITY_DRAFT_CONFIRMATION_CHANGED');
  assert.equal(unexpectedSends, 0, 'an unapproved offline dependency cannot be included implicitly');
  let active = true;
  const stoppingBridge = { list: async () => items, confirmAndSubmit: async () => { active = false; return { receipt: { status: 'committed' } }; } };
  const stoppedResults = await submitSequentially({ bridge: stoppingBridge, items, ids: ['a', 'b'], sessionToken: 'token', shouldContinue: () => active });
  assert.equal(stoppedResults[1].error, 'AUTHORITY_DRAFT_SUBMISSION_STOPPED');

  console.log('desktop auto sync tests passed');
})().catch(error => { console.error(error); process.exit(1); });
