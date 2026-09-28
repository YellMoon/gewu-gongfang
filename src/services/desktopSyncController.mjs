import { planDesktopAutoSync, submitSequentially } from './desktopAutoSync.mjs';

const signature = items => JSON.stringify(items.map(({ id, type, payload, status }) => ({ id, type, payload, status })));

// One owner serializes automatic work and the single manual/reconnect decision.
/** @param {{bridge:any, sessionToken:()=>string, isOnline:()=>boolean, refreshProjection:(options?:{businessOnly:boolean})=>any,
 * describe?:(items:any[])=>Promise<any>, pendingAssets?:(item:any)=>boolean,
 * afterCommit?:(item:any,receipt:any,shouldContinue:()=>boolean)=>Promise<any>, checkAssets?:(items:any[])=>Promise<any>}} options */
export function createDesktopSyncController({ bridge, sessionToken, isOnline, refreshProjection,
  describe = async () => ({}), pendingAssets = () => false, afterCommit = async () => {},
  checkAssets = async () => {} }) {
  let state = { items: [], descriptions: {}, open: false, busy: false, online: isOnline(), error: '' };
  let stopped = false, working = false, dismissed = '', shown = '';
  const listeners = new Set();
  const emit = patch => {
    if (stopped) return;
    state = { ...state, ...patch };
    for (const listener of listeners) listener(state);
  };
  const active = () => !stopped && isOnline();
  const pending = items => items.filter(item => item.status !== 'completed' || pendingAssets(item));
  async function read() {
    const all = await bridge.list();
    if (stopped) return [];
    const items = pending(all);
    const descriptions = await describe(items);
    emit({ items, descriptions, online: isOnline() });
    return all;
  }
  async function exclusive(job) {
    if (stopped || working) return;
    working = true;
    emit({ busy: true });
    try { await job(); }
    catch (error) { emit({ error: error?.code || error?.message || 'SUBMIT_FAILED' }); }
    finally { working = false; emit({ busy: false }); }
  }
  async function acknowledge(items, outcomes) {
    for (const outcome of outcomes) {
      if (!active()) break;
      const item = items.find(row => row.id === outcome.id);
      if (item && outcome.result?.receipt?.status === 'committed') {
        try { await afterCommit(item, outcome.result.receipt, active); }
        catch { emit({ error: 'QUESTION_ASSET_RELAY_PENDING' }); }
      }
    }
    const failure = outcomes.find(outcome => outcome.error || outcome.rejected);
    if (failure) emit({ error: failure.error || failure.result?.receipt?.result?.error?.code || 'AUTHORITY_COMMAND_REJECTED' });
    if (active() && outcomes.some(outcome => outcome.result?.receipt?.status === 'committed')) {
      const questionCommitted = outcomes.some(outcome => outcome.result?.receipt?.status === 'committed'
        && /^question\./.test(items.find(item => item.id === outcome.id)?.type || ''));
      try { await refreshProjection({ businessOnly: !questionCommitted }); }
      catch { emit({ error: 'AUTHORITY_PROJECTION_REFRESH_FAILED' }); }
    }
    return !failure;
  }
  function prompt(items, force = false) {
    const key = signature(items.filter(item => item.status === 'awaiting_confirmation' || item.status === 'conflict'));
    if (force || (key !== '[]' && key !== dismissed && key !== shown)) {
      shown = key;
      emit({ open: true });
    }
  }
  async function tick() {
    return exclusive(async () => {
      let items = await read();
      if (!active()) return;
      const token = sessionToken();
      let plan = planDesktopAutoSync(items);
      if (plan.blocked) { prompt(items); return; }
      emit({ error: '' });
      if (plan.onlineIds.length) {
        const outcomes = await submitSequentially({ bridge, items, ids: plan.onlineIds, sessionToken: token, shouldContinue: active });
        const ok = await acknowledge(items, outcomes);
        items = await read();
        if (!ok || !active()) { prompt(items); return; }
      }
      plan = planDesktopAutoSync(items);
      for (const id of plan.retryIds) {
        if (!active()) return;
        const result = await bridge.submit(id, { sessionToken: token });
        if (!await acknowledge(items, [{ id, result, rejected: result?.receipt?.status === 'rejected' }])) {
          await read(); prompt(state.items); return;
        }
      }
      if (!active()) return;
      await checkAssets(items);
      items = await read();
      plan = planDesktopAutoSync(items);
      if (plan.blocked || plan.offlineIds.length) prompt(items.filter(item => item.status === 'conflict' || plan.offlineIds.includes(item.id)));
    });
  }
  async function confirm(reviewedItems) {
    return exclusive(async () => {
      if (!active()) { emit({ online: false }); return; }
      if (reviewedItems.some(item => item.status === 'conflict')) return;
      const unidentifiable = reviewedItems.some(item => state.descriptions[item.id]?.blocked);
      if (unidentifiable) throw new Error('AUTHORITY_DRAFT_TARGET_UNAVAILABLE');
      emit({ error: '' });
      const ids = reviewedItems.filter(item => item.status === 'awaiting_confirmation').map(item => item.id);
      const token = sessionToken();
      const outcomes = await submitSequentially({ bridge, items: reviewedItems, ids, sessionToken: token, shouldContinue: active });
      if (!await acknowledge(reviewedItems, outcomes) || !active()) { await read(); return; }
      for (const item of reviewedItems.filter(item => ['confirmed', 'submitted'].includes(item.status))) {
        if (!active()) return;
        const result = await bridge.submit(item.id, { sessionToken: token });
        if (!await acknowledge(reviewedItems, [{ id: item.id, result, rejected: result?.receipt?.status === 'rejected' }])) { await read(); return; }
      }
      if (active()) {
        for (const item of reviewedItems.filter(item => item.status === 'completed' && pendingAssets(item))) {
          if (!active()) return;
          await afterCommit(item, item.receipt, active);
        }
      }
      await read();
      // Leave new/unreviewed work visible; never include it in the prior decision.
      if (!state.items.length) emit({ open: false });
    });
  }
  return {
    getState: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    tick,
    confirm,
    async open() { emit({ open: true }); await exclusive(async () => { await read(); }); },
    close() { if (working) return; dismissed = signature(state.items.filter(item => item.status === 'awaiting_confirmation' || item.status === 'conflict')); emit({ open: false }); },
    async discard(id) {
      await exclusive(async () => {
        const item = state.items.find(row => row.id === id);
        await bridge.removeDraft(id);
        emit({ error: '' });
        if (active()) { try { await refreshProjection({ businessOnly: !/^question\./.test(item?.type || '') }); } catch { /* draft removal is already durable */ } }
        await read();
      });
      await tick();
    },
    stop() { stopped = true; listeners.clear(); },
  };
}
