'use strict';

const assert = require('assert');
const { run } = require('./runPg17IntegrationTests');
const { runManifestCases } = require('./migrationManifest.test');
const { runCatalogAssertionCases } = require('./catalogAssertion.test');
const { runProductionVerifierReadinessCases } = require('./productionVerifierReadiness.test');

assert.strictEqual(typeof runManifestCases, 'function');
assert.strictEqual(typeof runCatalogAssertionCases, 'function');
assert.strictEqual(typeof runProductionVerifierReadinessCases, 'function');

async function main() {
  const calls = [];
  const runtime = {
    async start() { calls.push('start'); },
    async stop() { calls.push('stop'); },
  };
  const exitCode = await run({
    runtimeFactory: () => runtime,
    runManifest: async received => { assert.strictEqual(received, runtime); calls.push('manifest'); },
    runCatalog: async received => { assert.strictEqual(received, runtime); calls.push('catalog'); },
    runProductionVerifierReadiness: async received => { assert.strictEqual(received, runtime); calls.push('production-verifier-readiness'); },
    runBootstrap: async received => { assert.strictEqual(received, runtime); calls.push('bootstrap'); },
    runRecovery: async received => { assert.strictEqual(received, runtime); calls.push('recovery'); },
    runTrustedSessionBoundary: async received => { assert.strictEqual(received, runtime); calls.push('trusted-session-boundary'); },
    runAccessContext: async received => { assert.strictEqual(received, runtime); calls.push('access-context'); },
    runPolicyPublication: async received => { assert.strictEqual(received, runtime); calls.push('policy-publication'); },
    runRoleMutation: async received => { assert.strictEqual(received, runtime); calls.push('role-mutation'); },
    runLinkRevocation: async received => { assert.strictEqual(received, runtime); calls.push('link-revocation'); },
    report: message => calls.push(`report:${message.code}`),
  });
  assert.strictEqual(exitCode, 0);
  assert.deepStrictEqual(calls, ['start', 'manifest', 'catalog', 'production-verifier-readiness', 'bootstrap', 'recovery', 'trusted-session-boundary', 'access-context', 'policy-publication', 'role-mutation', 'link-revocation', 'stop']);

  const failedCalls = [];
  const unavailable = Object.assign(new Error('private detail'), { code: 'VNEXT_PG17_TEST_RUNTIME_UNAVAILABLE' });
  const failedCode = await run({
    runtimeFactory: () => ({
      async start() { failedCalls.push('start'); throw unavailable; },
      async stop() { failedCalls.push('stop'); },
    }),
    runManifest: async () => failedCalls.push('manifest'),
    runCatalog: async () => failedCalls.push('catalog'),
    runProductionVerifierReadiness: async () => failedCalls.push('production-verifier-readiness'),
    runBootstrap: async () => failedCalls.push('bootstrap'),
    runRecovery: async () => failedCalls.push('recovery'),
    runTrustedSessionBoundary: async () => failedCalls.push('trusted-session-boundary'),
    runAccessContext: async () => failedCalls.push('access-context'),
    runPolicyPublication: async () => failedCalls.push('policy-publication'),
    runRoleMutation: async () => failedCalls.push('role-mutation'),
    runLinkRevocation: async () => failedCalls.push('link-revocation'),
    report: message => failedCalls.push(`report:${message.code}`),
  });
  assert.strictEqual(failedCode, 1);
  assert.deepStrictEqual(failedCalls, ['start', 'report:VNEXT_PG17_TEST_RUNTIME_UNAVAILABLE', 'stop']);
  console.log('vNext PG17 runner orchestration checks passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
