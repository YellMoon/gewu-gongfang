'use strict';
const assert = require('node:assert/strict');
(async () => {
  const { describePendingChanges } = await import('../services/desktopSyncReview.mjs');
  const legacy = { id: 'legacy-delete', type: 'student.delete.v1', status: 'awaiting_confirmation', payload: { id: 'student', expectedVersion: 'version' } };
  const before = structuredClone(legacy);
  let review = await describePendingChanges([legacy], {}, async () => ({ students: [{ id: 'student', name: 'Cloud original name' }] }));
  assert.equal(review[legacy.id].summary, 'Cloud original name'); assert(!review[legacy.id].blocked);
  assert.deepEqual(legacy, before, 'reviewing legacy deletes must never change signed submission content');
  review = await describePendingChanges([legacy], {}, async () => ({ students: [] }));
  assert.equal(review[legacy.id].blocked, true, 'unidentified deletes cannot be approved blindly');
  for (const origin of ['preview', 'cloud']) {
    const record = { id: 'lesson', course_id: 'deleted-course', course_name: 'Historical course', start_time: '2026-09-10T01:00:00Z', end_time: '2026-09-10T03:00:00Z', room: 'Original address' };
    const draft = { id: origin, type: 'schedule.delete.v1', payload: { id: 'lesson', expectedVersion: 'version' }, ...(origin === 'preview' ? { preview: { record } } : {}) };
    review = await describePendingChanges([draft], {}, async () => ({ courses: [], schedules: origin === 'cloud' ? [record] : [] }));
    assert(!review[origin].blocked); assert(review[origin].summary.includes('Historical course'));
    assert(review[origin].details.some(x => x.value.includes('2026/09/10')));
  }
  console.log('aggregate review preserves deletion identity, history and immutable payload checks');
})().catch(error => { console.error(error); process.exitCode = 1; });
