'use strict';

const assert = require('assert');
const {
  createDisposablePg17Runtime,
  isVNextPg17DisposableHandle,
  withVNextPg17SyntheticQuery,
} = require('./disposableRuntime');

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
assert.deepStrictEqual(Object.keys(runtime).sort(), ['createIsolatedHandle', 'createPeerHandle', 'disposeHandle', 'start', 'stop']);
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
