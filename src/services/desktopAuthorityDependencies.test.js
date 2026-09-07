const assert = require('node:assert/strict');
assert(require('../../package.json').build.files.includes('src/services/authorityDraftDependencies.mjs'), 'packaged main process must include its new dependency module');
(async () => {
  const { createDesktopCommandOutbox } = await import('./desktopCommandOutbox.mjs');
  const { createDesktopAuthorityClient } = await import('./desktopAuthorityClient.mjs');
  const { draftConfirmationSnapshot } = await import('./authorityDraftDependencies.mjs');
  async function setup(mode = 'success') {
    let state; let id = 0; const sends = []; let fail = mode === 'retry';
    const outbox = createDesktopCommandOutbox({ store: { read: async () => state, write: async v => { state = v; } }, codec: { seal: async v => JSON.stringify(v), open: async v => JSON.parse(v) }, createId: () => `draft-${++id}` });
    const client = createDesktopAuthorityClient({ outbox,
      createCloudBusinessCommand: d => ({ commandId: d.id, type: d.type, payload: d.payload, payloadHash: 'hash' }),
      submitCloudBusiness: async c => {
        sends.push(c.type);
        if (c.type === 'room.create.v1' && fail) { fail = false; throw new Error('offline'); }
        return { commandId: c.commandId, payloadHash: c.payloadHash, resultHash: 'receipt', status: mode === 'reject' && c.type === 'room.create.v1' ? 'rejected' : 'committed' };
      },
    });
    const room = await outbox.append({ type: 'room.create.v1', payload: { record: { id: 'room', name: 'Classroom' } } });
    const unrelated = await outbox.append({ type: 'room.create.v1', payload: { record: { id: 'other', name: 'Other classroom' } } });
    const course = await outbox.append({ type: 'course.create.v1', payload: { record: { id: 'course', room_id: 'room', name: 'Physics' } } });
    return { outbox, client, sends, room, course, unrelated, plan: { items: draftConfirmationSnapshot([room, course]) } };
  }
  const h = await setup();
  assert.equal(await h.client.submit(h.course.id), undefined);
  await assert.rejects(() => h.client.confirmAndSubmit(h.course.id), e => e.code === 'AUTHORITY_DRAFT_DEPENDENCY_CONFIRMATION_REQUIRED');
  assert.equal((await h.outbox.get(h.course.id)).status, 'awaiting_confirmation');
  assert.equal(h.sends.length, 0);
  await h.client.confirmAndSubmit(h.course.id, {}, h.plan);
  assert.deepEqual(h.sends, ['room.create.v1', 'course.create.v1']);
  assert.equal((await h.outbox.get(h.unrelated.id)).status, 'awaiting_confirmation');
  const stale = await setup(); stale.plan.items[0].payload.record.name = 'Old value';
  await assert.rejects(() => stale.client.confirmAndSubmit(stale.course.id, {}, stale.plan), e => e.code === 'AUTHORITY_DRAFT_CONFIRMATION_CHANGED');
  assert((await stale.outbox.list()).every(x => x.status === 'awaiting_confirmation'));
  const retry = await setup('retry');
  await assert.rejects(() => retry.client.confirmAndSubmit(retry.course.id, {}, retry.plan), /offline/);
  assert.equal((await retry.outbox.get(retry.course.id)).status, 'confirmed');
  await retry.client.submit(retry.course.id);
  assert.deepEqual(retry.sends, ['room.create.v1', 'room.create.v1', 'course.create.v1']);
  const reject = await setup('reject');
  await assert.rejects(() => reject.client.confirmAndSubmit(reject.course.id, {}, reject.plan), e => e.code === 'AUTHORITY_DRAFT_DEPENDENCY_BLOCKED');
  assert.deepEqual(reject.sends, ['room.create.v1']);
  const single = await setup(); await single.outbox.confirm(single.course.id);
  await assert.rejects(() => single.client.submit(single.course.id), e => e.code === 'AUTHORITY_DRAFT_DEPENDENCY_CONFIRMATION_REQUIRED');
  assert.equal(single.sends.length, 0);
  console.log('desktop course/address explicit confirmation dependency checks passed');
})().catch(e => { console.error(e); process.exitCode = 1; });
