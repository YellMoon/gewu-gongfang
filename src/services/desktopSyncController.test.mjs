import assert from 'node:assert/strict';
import { createDesktopSyncController } from './desktopSyncController.mjs';
const draft = (id, offline = true) => ({ id, type: 'student.update.v1', createdOffline: offline,
  status: 'awaiting_confirmation', payload: { id, changes: { name: id } } });
function fixture(initial) {
  let items = structuredClone(initial), online = true, refreshes = 0;
  const calls = [], assets = [];
  const bridge = {
    list: async () => structuredClone(items),
    confirmAndSubmit: async (id, input, confirmation) => {
      calls.push({ id, input, confirmation });
      const item = items.find(row => row.id === id);
      item.status = 'completed'; item.receipt = { status: 'committed' };
      return { receipt: item.receipt };
    },
    submit: async id => bridge.confirmAndSubmit(id),
    removeDraft: async id => { items = items.filter(row => row.id !== id); },
  };
  const controller = createDesktopSyncController({ bridge, sessionToken: () => 'ephemeral-token', isOnline: () => online,
    refreshProjection: async () => { refreshes++; }, afterCommit: async item => assets.push(item.id),
    pendingAssets: item => item.needsAsset === true });
  return { controller, bridge, calls, assets, get items() { return items; }, set items(value) { items = value; },
    set online(value) { online = value; }, get refreshes() { return refreshes; } };
}
{
  const f = fixture([draft('online', false), draft('offline'), { ...draft('history'), status: 'completed' }]);
  await f.controller.tick();
  assert.deepEqual(f.calls.map(x => x.id), ['online']);
  assert.deepEqual(f.assets, ['online'], 'silent commits must also start attachment handling');
  assert.deepEqual(f.controller.getState().items.map(x => x.id), ['offline'], 'completed history is excluded');
  assert.equal(f.controller.getState().open, true);
  f.controller.close(); await f.controller.tick();
  assert.equal(f.controller.getState().open, false, 'unchanged postponed drafts must not repeatedly interrupt');
  await f.controller.open();
  const reviewed = f.controller.getState().items;
  f.items.push(draft('later'));
  await f.controller.confirm(reviewed);
  assert.deepEqual(f.calls.map(x => x.id), ['online', 'offline'], 'confirmation cannot include unseen later work');
  assert.deepEqual(f.controller.getState().items.map(x => x.id), ['later']);
}
{
  const f = fixture([draft('one'), draft('two')]);
  f.online = false; await f.controller.tick(); assert.equal(f.controller.getState().open, false);
  f.online = true; await f.controller.tick(); assert.equal(f.calls.length, 0);
  let release; const submit = f.bridge.confirmAndSubmit;
  f.bridge.confirmAndSubmit = async (...args) => { if (args[0] === 'one') await new Promise(resolve => { release = resolve; }); return submit(...args); };
  const pending = f.controller.confirm(f.controller.getState().items);
  await new Promise(resolve => setImmediate(resolve));
  await f.controller.tick(); await f.controller.confirm(f.controller.getState().items);
  release(); await pending;
  assert.deepEqual(f.calls.map(x => x.id), ['one', 'two'], 'one click submits the batch exactly once despite ticks/double clicks');
  assert.equal(f.controller.getState().open, false);
}
{
  const f = fixture([draft('one'), draft('two')]); await f.controller.open();
  const reviewed = f.controller.getState().items;
  f.items[0].payload.changes.name = 'changed after review';
  await f.controller.confirm(reviewed);
  assert.equal(f.calls.length, 0, 'changed payload must require a new review');
  assert.equal(f.controller.getState().error, 'AUTHORITY_DRAFT_CONFIRMATION_CHANGED');
}
{
  const f = fixture([{ ...draft('conflict'), status: 'conflict' }, draft('online', false)]);
  await f.controller.tick(); assert.equal(f.calls.length, 0);
  await f.controller.discard('conflict');
  assert.deepEqual(f.calls.map(x => x.id), ['online'], 'resolving a conflict must resume automatically');
}
{
  const f = fixture(['one', 'two'].map(id => ({ ...draft(id), status: 'submitted' })));
  const attempts = [];
  f.bridge.submit = async id => { attempts.push(id); f.items.find(x => x.id === id).status = 'conflict'; return { receipt: { status: 'rejected' } }; };
  await f.controller.tick(); await f.controller.tick();
  assert.deepEqual(attempts, ['one'], 'a rejected retry stops the remainder and future automatic passes');
}
{
  const f = fixture([draft('online', false)]); let release;
  f.bridge.list = () => new Promise(resolve => { release = resolve; });
  const pending = f.controller.tick(); f.controller.stop(); release(f.items); await pending;
  assert.equal(f.calls.length, 0, 'a late read from a previous identity cannot submit');
}
{
  const f = fixture([{ ...draft('question', false), type: 'question.update.v1' }]);
  const refreshes = [];
  const controller = createDesktopSyncController({ bridge: f.bridge, sessionToken: () => 'token', isOnline: () => true,
    refreshProjection: async options => refreshes.push(options) });
  await controller.tick();
  assert.deepEqual(refreshes, [{ businessOnly: false }], 'question commits must read back their new content version');
}
console.log('unified desktop sync batch, reconnect, conflict, race and history checks passed');
