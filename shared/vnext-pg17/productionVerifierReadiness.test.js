'use strict';

const assert = require('assert');
const {
  createDisposablePg17Runtime,
  createVNextPg17SyntheticVerifierPool,
  createVNextPg17SyntheticVerifierFaultPlan,
  armVNextPg17SyntheticVerifierFaultPlan,
  inspectVNextPg17SyntheticVerifierFaultPlan,
  issueVNextPg17SyntheticTlsBrand,
  syntheticVerifierPoolDatabase,
  withVNextPg17SyntheticQuery,
} = require('./disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('./catalogAssertion');
const {
  createVNextPg17ProductionVerifierReadiness,
} = require('./productionVerifierReadiness');

const NOW = '2026-08-15T00:00:00.000Z';

async function expectCode(action, code) {
  await assert.rejects(action, error => error && error.code === code);
}

async function runProductionVerifierReadinessCases(runtime) {
  const handle = await runtime.createIsolatedHandle();
  try {
    await createVNextPg17CatalogBoundary(runtime).apply(handle, {
      appliedAt: NOW,
      appliedBy: 'production-verifier-readiness-test',
    });
    const verifierPool = createVNextPg17SyntheticVerifierPool(runtime, handle);
    const normalPlan = createVNextPg17SyntheticVerifierFaultPlan(runtime, handle, []);
    armVNextPg17SyntheticVerifierFaultPlan(verifierPool, normalPlan);
    const readiness = createVNextPg17ProductionVerifierReadiness({
      databaseBinding: handle,
      verifierPool,
      expectedDatabase: syntheticVerifierPoolDatabase(verifierPool),
      expectedUser: 'vnext_pg17_verifier',
      syntheticTlsBrand: issueVNextPg17SyntheticTlsBrand(runtime, handle),
    });
    const result = await readiness.check();
    assert.deepStrictEqual(result, {
      migrationVersion: 15,
      ready: true,
      schemaVersion: 5,
    });
    assert.strictEqual(Object.isFrozen(result), true);
    assert.deepStrictEqual(Reflect.ownKeys(result), ['migrationVersion', 'ready', 'schemaVersion']);
    const normalTrace = inspectVNextPg17SyntheticVerifierFaultPlan(normalPlan);
    assert.deepStrictEqual(normalTrace.queries.slice(0, 5), [
      'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
      "SELECT set_config('TimeZone', 'UTC', true)",
      "SELECT set_config('statement_timeout', '5000ms', true)",
      "SELECT set_config('lock_timeout', '1000ms', true)",
      "SELECT set_config('application_name', 'gewu-vnext-verifier-readiness', true)",
    ]);
    assert.strictEqual(normalTrace.queries.at(-1), 'COMMIT');
    assert.strictEqual(normalTrace.queries.every(query => /^(BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY|COMMIT|ROLLBACK|SELECT )/.test(query)), true);
    assert.strictEqual(normalTrace.queries.every(query => !/^(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE|DROP|SET ROLE|CREATE TEMP)\b/i.test(query)), true);

    const parallel = await Promise.all([
      readiness.check(),
      readiness.check(),
    ]);
    assert.deepStrictEqual(parallel, [result, result]);

    const runFault = async (stages, expected) => {
      const plan = createVNextPg17SyntheticVerifierFaultPlan(runtime, handle, stages);
      armVNextPg17SyntheticVerifierFaultPlan(verifierPool, plan);
      const faultyReadiness = createVNextPg17ProductionVerifierReadiness({
        databaseBinding: handle,
        verifierPool,
        expectedDatabase: syntheticVerifierPoolDatabase(verifierPool),
        expectedUser: 'vnext_pg17_verifier',
        syntheticTlsBrand: issueVNextPg17SyntheticTlsBrand(runtime, handle),
      });
      await expectCode(() => faultyReadiness.check(), 'VNEXT_PG17_PRODUCTION_VERIFIER_UNAVAILABLE');
      const trace = inspectVNextPg17SyntheticVerifierFaultPlan(plan);
      assert.strictEqual(trace.destroyCount, expected.destroyCount);
      assert.strictEqual(trace.releaseCount, expected.releaseCount);
      assert.strictEqual(trace.stages.includes(stages[0]), true);
      assert.deepStrictEqual(trace.stages.slice(-expected.lastStages.length), expected.lastStages);
    };

    await runFault(['begin'], {
      destroyCount: 1,
      releaseCount: 0,
      lastStages: ['begin', 'destroy'],
    });
    for (const stage of ['setup', 'identity', 'tls', 'catalog']) {
      await runFault([stage], {
        destroyCount: 0,
        releaseCount: 1,
        lastStages: [stage, 'rollback', 'release'],
      });
    }
    await runFault(['commit'], {
      destroyCount: 1,
      releaseCount: 0,
      lastStages: ['commit', 'destroy'],
    });
    await runFault(['setup', 'rollback'], {
      destroyCount: 1,
      releaseCount: 0,
      lastStages: ['setup', 'rollback', 'destroy'],
    });
    await runFault(['release'], {
      destroyCount: 1,
      releaseCount: 1,
      lastStages: ['release', 'destroy'],
    });

    await expectCode(
      async () => createVNextPg17ProductionVerifierReadiness({
        databaseBinding: handle,
        verifierPool: {},
        expectedDatabase: syntheticVerifierPoolDatabase(verifierPool),
        expectedUser: 'vnext_pg17_verifier',
        syntheticTlsBrand: {},
      }).check(),
      'VNEXT_PG17_PRODUCTION_VERIFIER_UNAVAILABLE',
    );

    const otherHandle = await runtime.createIsolatedHandle();
    try {
      assert.throws(() => createVNextPg17ProductionVerifierReadiness({
        databaseBinding: otherHandle,
        verifierPool,
        expectedDatabase: syntheticVerifierPoolDatabase(verifierPool),
        expectedUser: 'vnext_pg17_verifier',
        syntheticTlsBrand: issueVNextPg17SyntheticTlsBrand(runtime, handle),
      }), error => error && error.code === 'VNEXT_PG17_PRODUCTION_VERIFIER_UNAVAILABLE');
    } finally {
      await runtime.disposeHandle(otherHandle);
    }

    readiness.close();
    await expectCode(() => readiness.check(), 'VNEXT_PG17_PRODUCTION_VERIFIER_UNAVAILABLE');

    const driftHandle = await runtime.createIsolatedHandle();
    try {
      await createVNextPg17CatalogBoundary(runtime).apply(driftHandle, {
        appliedAt: NOW,
        appliedBy: 'production-verifier-readiness-drift-test',
      });
      await withVNextPg17SyntheticQuery(driftHandle, 'fixture-provisioner', facade => facade.query(
        'REVOKE SELECT ON vnext_control_plane.vnext_accounts FROM vnext_pg17_verifier',
      ));
      const driftPool = createVNextPg17SyntheticVerifierPool(runtime, driftHandle);
      const driftReadiness = createVNextPg17ProductionVerifierReadiness({
        databaseBinding: driftHandle,
        verifierPool: driftPool,
        expectedDatabase: syntheticVerifierPoolDatabase(driftPool),
        expectedUser: 'vnext_pg17_verifier',
        syntheticTlsBrand: issueVNextPg17SyntheticTlsBrand(runtime, driftHandle),
      });
      await expectCode(() => driftReadiness.check(), 'VNEXT_PG17_PRODUCTION_VERIFIER_UNAVAILABLE');
    } finally {
      await runtime.disposeHandle(driftHandle);
    }

  } finally {
    await runtime.disposeHandle(handle);
  }
}

async function main() {
  const runtime = createDisposablePg17Runtime();
  try {
    await runtime.start();
    await runProductionVerifierReadinessCases(runtime);
  } finally {
    await runtime.stop();
  }
  console.log('vNext PG17 production verifier readiness checks passed');
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${error.code || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { runProductionVerifierReadinessCases };
