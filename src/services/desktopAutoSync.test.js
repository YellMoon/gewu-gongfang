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

  const items = [
    { id: 'a', type: 'schedule.update.v1', status: 'awaiting_confirmation', payload: { id: 'a', changes: { notes: 'x' } } },
    { id: 'b', type: 'schedule.update.v1', status: 'awaiting_confirmation', payload: { id: 'b', changes: { notes: 'y' } } },
  ];
  const calls = [];
  const bridge = { confirmAndSubmit: async (id) => { calls.push(id); return { receipt: { status: id === 'a' ? 'rejected' : 'committed' } }; } };
  const outcomes = await submitSequentially({ bridge, items, ids: ['a', 'b'], sessionToken: 'token' });
  assert.deepEqual(calls, ['a'], 'submission stops after a rejected draft');
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].rejected, true);

  const okCalls = [];
  const okBridge = { confirmAndSubmit: async (id) => { okCalls.push(id); return { receipt: { status: 'committed' } }; } };
  const okOutcomes = await submitSequentially({ bridge: okBridge, items, ids: ['a', 'b'], sessionToken: 'token' });
  assert.deepEqual(okCalls, ['a', 'b']);
  assert.equal(okOutcomes.length, 2);

  const errorBridge = { confirmAndSubmit: async () => { throw Object.assign(new Error('conflict'), { code: 'CLOUD_BUSINESS_VERSION_CONFLICT' }); } };
  const errorOutcomes = await submitSequentially({ bridge: errorBridge, items, ids: ['a'], sessionToken: 'token' });
  assert.equal(errorOutcomes[0].error, 'CLOUD_BUSINESS_VERSION_CONFLICT');

  console.log('desktop auto sync tests passed');
})().catch(error => { console.error(error); process.exit(1); });
