'use strict';

const assert = require('assert');
const {
  createDisposablePg17Runtime,
  isVNextPg17DisposableHandle,
  withVNextPg17SyntheticQuery,
} = require('./disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('./catalogAssertion');

function expectInvalidConfig(fn) {
  assert.throws(fn, error => error && error.code === 'VNEXT_PG17_RUNTIME_CONFIG_INVALID');
}

expectInvalidConfig(() => createDisposablePg17Runtime({ forbidden: true }));
expectInvalidConfig(() => createDisposablePg17Runtime(new Proxy({}, {})));

let getterReads = 0;
const accessorArgument = Object.defineProperty({}, 'x', {
  enumerable: true,
  get() {
    getterReads += 1;
    throw new Error('getter must not run');
  },
});
expectInvalidConfig(() => createDisposablePg17Runtime(accessorArgument));
assert.strictEqual(getterReads, 0);

const runtime = createDisposablePg17Runtime();
assert.ok(Object.isFrozen(runtime));
assert.deepStrictEqual(Object.keys(runtime).sort(), ['createIsolatedHandle', 'createPeerHandle', 'createVNextPg17CopyOnlyRehearsalFaultPlan', 'createVNextPg17CopyOnlyRehearsalTarget', 'disposeHandle', 'start', 'stop']);
async function main() {
  assert.strictEqual(isVNextPg17DisposableHandle({}), false);
  await assert.rejects(
    () => withVNextPg17SyntheticQuery({}, 'verifier', () => {}),
    error => error && error.code === 'VNEXT_PG17_HANDLE_INVALID',
  );

  const liveRuntime = createDisposablePg17Runtime();
  try {
    await liveRuntime.start();
    const handle = await liveRuntime.createIsolatedHandle();
    assert.strictEqual(isVNextPg17DisposableHandle(handle), true);
    assert.ok(Object.isFrozen(handle));
    assert.deepStrictEqual(Reflect.ownKeys(handle), []);
    const result = await withVNextPg17SyntheticQuery(handle, 'verifier', facade =>
      facade.query("SELECT current_setting('server_version_num')::int AS version_num"),
    );
    assert.ok(result.rows[0].version_num >= 170000);
    assert.ok(result.rows[0].version_num < 180000);
    await createVNextPg17CatalogBoundary(liveRuntime).apply(handle, {
      appliedAt: '2026-08-20T00:00:00.000Z',
      appliedBy: 'writer-zero-dml-test',
    });
    const writerRead = await withVNextPg17SyntheticQuery(handle, 'writer', facade => facade.query(
      'SELECT COUNT(*)::text AS count FROM vnext_control_plane.vnext_authorities',
    ));
    assert.strictEqual(writerRead.rows[0].count, '0');
    await assert.rejects(
      () => withVNextPg17SyntheticQuery(handle, 'writer', facade => facade.query(
        "INSERT INTO vnext_control_plane.vnext_authorities (authority_id, status, created_at, updated_at) VALUES ('writer-test', 'active', now(), now())",
      )),
      error => error && error.code === '42501',
    );
    const peer = await liveRuntime.createPeerHandle(handle);
    const peerResult = await withVNextPg17SyntheticQuery(peer, 'fixture-provisioner', facade =>
      facade.query('SELECT 1 AS peer_write_test'),
    );
    assert.strictEqual(peerResult.rows[0].peer_write_test, 1);
    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', facade => facade.query(
      'CREATE TABLE public.vnext_pg17_snapshot_probe(value integer NOT NULL)',
    ));
    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', facade => facade.query(
      'INSERT INTO public.vnext_pg17_snapshot_probe(value) VALUES(1)',
    ));
    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
      await facade.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      try {
        assert.strictEqual((await facade.query('SELECT value FROM public.vnext_pg17_snapshot_probe')).rows[0].value, 1);
        await withVNextPg17SyntheticQuery(peer, 'fixture-provisioner', peerFacade => peerFacade.query(
          'UPDATE public.vnext_pg17_snapshot_probe SET value=2',
        ));
        assert.strictEqual((await facade.query('SELECT value FROM public.vnext_pg17_snapshot_probe')).rows[0].value, 1);
        await facade.query('COMMIT');
      } catch (error) {
        await facade.query('ROLLBACK');
        throw error;
      }
    });
    await liveRuntime.disposeHandle(peer);
    await liveRuntime.disposeHandle(handle);
    assert.strictEqual(isVNextPg17DisposableHandle(handle), false);
    await assert.rejects(
      () => withVNextPg17SyntheticQuery(handle, 'verifier', () => {}),
      error => error && error.code === 'VNEXT_PG17_HANDLE_INVALID',
    );
  } finally {
    await liveRuntime.stop();
  }

  const failedSetupRuntime = createDisposablePg17Runtime();
  try {
    await failedSetupRuntime.start();
    const setupHandle = await failedSetupRuntime.createIsolatedHandle();
    await withVNextPg17SyntheticQuery(setupHandle, 'fixture-provisioner', facade => facade.query(
      'ALTER ROLE vnext_pg17_verifier NOLOGIN',
    ));
    await failedSetupRuntime.disposeHandle(setupHandle);
    await assert.rejects(
      () => failedSetupRuntime.createIsolatedHandle(),
      error => error && error.code === 'VNEXT_PG17_TEST_RUNTIME_UNAVAILABLE',
    );
    await assert.rejects(
      () => failedSetupRuntime.start(),
      error => error && error.code === 'VNEXT_PG17_TEST_RUNTIME_UNAVAILABLE',
    );
  } finally {
    await failedSetupRuntime.stop();
  }
  console.log('vNext PG17 disposable runtime strict-config checks passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
