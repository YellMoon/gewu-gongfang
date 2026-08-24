const assert = require('assert');

(async function main() {
  const { createAuthorityCacheCheckpoint } = await import('./authorityCacheCheckpoint.mjs');
  const checkpoint = createAuthorityCacheCheckpoint({ students: [{ id: 'student-1', name: 'Before' }] });
  const committed = { students: [{ id: 'student-1', name: 'Committed' }] };
  checkpoint.commit(committed);
  committed.students[0].name = 'Mutated before draft';
  let restored;
  assert.throws(
    () => checkpoint.guard(
      () => { throw Object.assign(new Error('outbox write failed'), { code: 'AUTHORITY_OUTBOX_WRITE_FAILED' }); },
      value => { restored = value; },
    ),
    error => error?.code === 'AUTHORITY_OUTBOX_WRITE_FAILED',
  );
  assert.deepStrictEqual(restored, { students: [{ id: 'student-1', name: 'Committed' }] });
  restored.students[0].name = 'Changed after restore';
  assert.deepStrictEqual(checkpoint.snapshot(), { students: [{ id: 'student-1', name: 'Committed' }] },
    'restored cache must not alias the durable checkpoint');
  console.log('authority cache checkpoint tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
