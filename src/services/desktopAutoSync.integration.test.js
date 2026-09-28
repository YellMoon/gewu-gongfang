'use strict';
const assert = require('node:assert/strict');

(async () => {
  const { createDesktopCommandOutbox } = await import('./desktopCommandOutbox.mjs');
  const { createDesktopAuthorityClient } = await import('./desktopAuthorityClient.mjs');
  const { submitSequentially } = await import('./desktopAutoSync.mjs');
  for (const reverse of [false, true]) {
    let state = '', sequence = 0;
    const sent = [];
    const outbox = createDesktopCommandOutbox({
      store: { read: async () => state, write: async value => { state = value; } },
      codec: { seal: async value => JSON.stringify(value), open: async value => JSON.parse(value) },
      createId: () => String(++sequence),
    });
    const bridge = createDesktopAuthorityClient({ outbox,
      createCloudBusinessCommand: draft => ({ commandId: draft.id, payloadHash: 'a'.repeat(64), type: draft.type, payload: draft.payload }),
      submitCloudBusiness: async command => {
        sent.push(command.type);
        return { commandId: command.commandId, payloadHash: command.payloadHash, status: 'committed', result: {}, resultHash: 'b'.repeat(64) };
      },
    });
    await bridge.appendDraft({ type: 'room.create.v1', payload: { record: { id: 'room' } } });
    await bridge.appendDraft({ type: 'course.create.v1', payload: { record: { id: 'course', room_id: 'room' } } });
    const items = await bridge.list();
    const ids = items.map(item => item.id);
    if (reverse) ids.reverse();
    const results = await submitSequentially({ bridge, items, ids, sessionToken: 'test-session' });
    assert(results.every(result => !result.error && !result.rejected), 'approved course/address batch must survive dependencies completed earlier in the same batch');
    assert.deepEqual(sent, ['room.create.v1', 'course.create.v1'], 'each mutation must be sent once regardless of draft order');
    assert((await bridge.list()).every(item => item.status === 'completed'));
    assert(!state.includes('test-session'));
  }
  console.log('desktop auto sync real outbox dependency batch checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
