'use strict';

const assert = require('assert');
const { run } = require('./runPg17IntegrationTests');
const { runManifestCases } = require('./migrationManifest.test');
const { runCatalogAssertionCases } = require('./catalogAssertion.test');
const { runProductionVerifierReadinessCases } = require('./productionVerifierReadiness.test');
const { runSourceIsolationContractCases } = require('./sourceIsolationContract.test');
const { runBusinessFoundationManifestCases } = require('./businessFoundationManifest.test');
const { runBusinessFoundationAdmissionBatchRequestCases } = require('./businessFoundationAdmissionBatchRequest.test');
const { runBusinessFoundationAdmissionCatalogCases } = require('./businessFoundationAdmissionCatalog.test');
const { runBusinessFoundationCatalogAssertionCases } = require('./businessFoundationCatalogAssertion.test');
const { runBusinessFoundationShadowAdmissionCases } = require('./businessFoundationShadowAdmission.test');
const { runUnifiedDesktopRegistrationMutationCases } = require('./unifiedDesktopRegistrationMutation.test');

assert.strictEqual(typeof runManifestCases, 'function');
assert.strictEqual(typeof runCatalogAssertionCases, 'function');
assert.strictEqual(typeof runProductionVerifierReadinessCases, 'function');
assert.strictEqual(typeof runSourceIsolationContractCases, 'function');
assert.strictEqual(typeof runBusinessFoundationManifestCases, 'function');
assert.strictEqual(typeof runBusinessFoundationAdmissionBatchRequestCases, 'function');
assert.strictEqual(typeof runBusinessFoundationAdmissionCatalogCases, 'function');
assert.strictEqual(typeof runBusinessFoundationCatalogAssertionCases, 'function');
assert.strictEqual(typeof runBusinessFoundationShadowAdmissionCases, 'function');
assert.strictEqual(typeof runUnifiedDesktopRegistrationMutationCases, 'function');

async function main() {
  const calls = [];
  const runtime = {
    async start() { calls.push('start'); },
    async stop() { calls.push('stop'); },
  };
  const exitCode = await run({
    runtimeFactory: () => runtime,
    runSourceIsolation: async () => calls.push('source-isolation'),
    runManifest: async received => { assert.strictEqual(received, runtime); calls.push('manifest'); },
    runCatalog: async received => { assert.strictEqual(received, runtime); calls.push('catalog'); },
    runBusinessFoundationManifest: async received => { assert.strictEqual(received, runtime); calls.push('business-foundation-manifest'); },
    runBusinessFoundationAdmissionBatchRequest: async received => { assert.strictEqual(received, runtime); calls.push('business-foundation-admission-batch-request'); },
    runBusinessFoundationAdmissionCatalog: async received => { assert.strictEqual(received, runtime); calls.push('business-foundation-admission-catalog'); },
    runBusinessFoundationCatalog: async received => { assert.strictEqual(received, runtime); calls.push('business-foundation-catalog'); },
    runBusinessFoundationShadowAdmission: async received => { assert.strictEqual(received, runtime); calls.push('business-shadow-admission'); },
    runUnifiedDesktopRegistration: async received => { assert.strictEqual(received, runtime); calls.push('unified-desktop-registration'); },
    runProductionVerifierReadiness: async received => { assert.strictEqual(received, runtime); calls.push('production-verifier-readiness'); },
    runBootstrap: async received => { assert.strictEqual(received, runtime); calls.push('bootstrap'); },
    runRecovery: async received => { assert.strictEqual(received, runtime); calls.push('recovery'); },
    runTrustedSessionBoundary: async received => { assert.strictEqual(received, runtime); calls.push('trusted-session-boundary'); },
    runAccessContext: async received => { assert.strictEqual(received, runtime); calls.push('access-context'); },
    runPolicyPublication: async received => { assert.strictEqual(received, runtime); calls.push('policy-publication'); },
    runRoleMutation: async received => { assert.strictEqual(received, runtime); calls.push('role-mutation'); },
    runLinkRevocation: async received => { assert.strictEqual(received, runtime); calls.push('link-revocation'); },
    runLinkRevocationParity: async received => { assert.strictEqual(received, runtime); calls.push('link-revocation-parity'); },
    report: message => calls.push(`report:${message.code}`),
  });
  assert.strictEqual(exitCode, 0);
  assert.deepStrictEqual(calls, ['source-isolation', 'start', 'manifest', 'catalog', 'business-foundation-manifest', 'business-foundation-admission-batch-request', 'business-foundation-admission-catalog', 'business-foundation-catalog', 'business-shadow-admission', 'unified-desktop-registration', 'production-verifier-readiness', 'bootstrap', 'recovery', 'trusted-session-boundary', 'access-context', 'policy-publication', 'role-mutation', 'link-revocation', 'link-revocation-parity', 'stop']);

  const failedCalls = [];
  const unavailable = Object.assign(new Error('private detail'), { code: 'VNEXT_PG17_TEST_RUNTIME_UNAVAILABLE' });
  const failedCode = await run({
    runtimeFactory: () => ({
      async start() { failedCalls.push('start'); throw unavailable; },
      async stop() { failedCalls.push('stop'); },
    }),
    runSourceIsolation: async () => failedCalls.push('source-isolation'),
    runManifest: async () => failedCalls.push('manifest'),
    runCatalog: async () => failedCalls.push('catalog'),
    runBusinessFoundationManifest: async () => failedCalls.push('business-foundation-manifest'),
    runBusinessFoundationAdmissionBatchRequest: async () => failedCalls.push('business-foundation-admission-batch-request'),
    runBusinessFoundationAdmissionCatalog: async () => failedCalls.push('business-foundation-admission-catalog'),
    runBusinessFoundationCatalog: async () => failedCalls.push('business-foundation-catalog'),
    runBusinessFoundationShadowAdmission: async () => failedCalls.push('business-shadow-admission'),
    runProductionVerifierReadiness: async () => failedCalls.push('production-verifier-readiness'),
    runBootstrap: async () => failedCalls.push('bootstrap'),
    runRecovery: async () => failedCalls.push('recovery'),
    runTrustedSessionBoundary: async () => failedCalls.push('trusted-session-boundary'),
    runAccessContext: async () => failedCalls.push('access-context'),
    runPolicyPublication: async () => failedCalls.push('policy-publication'),
    runRoleMutation: async () => failedCalls.push('role-mutation'),
    runLinkRevocation: async () => failedCalls.push('link-revocation'),
    runLinkRevocationParity: async () => failedCalls.push('link-revocation-parity'),
    report: message => failedCalls.push(`report:${message.code}`),
  });
  assert.strictEqual(failedCode, 1);
  assert.deepStrictEqual(failedCalls, ['source-isolation', 'start', 'report:VNEXT_PG17_TEST_RUNTIME_UNAVAILABLE', 'stop']);

  const isolationCalls = [];
  const isolationFailure = Object.assign(new Error('private isolation detail'), { code: 'VNEXT_PG17_LEGACY_SOURCE_ISOLATION_VIOLATION' });
  const isolationCode = await run({
    runtimeFactory: () => { isolationCalls.push('runtime-factory'); throw new Error('must not construct runtime'); },
    runSourceIsolation: async () => { isolationCalls.push('source-isolation'); throw isolationFailure; },
    report: message => isolationCalls.push(`report:${message.code}`),
  });
  assert.strictEqual(isolationCode, 1);
  assert.deepStrictEqual(isolationCalls, ['source-isolation', 'report:VNEXT_PG17_LEGACY_SOURCE_ISOLATION_VIOLATION']);

  const admissionFailureCalls = [];
  const admissionFailure = Object.assign(new Error('batch request invalid'), { code: 'VNEXT_PG17_ADMISSION_INPUT_INVALID' });
  const admissionFailureCode = await run({
    runtimeFactory: () => ({
      async start() { admissionFailureCalls.push('start'); },
      async stop() { admissionFailureCalls.push('stop'); },
    }),
    runSourceIsolation: async () => admissionFailureCalls.push('source-isolation'),
    runManifest: async () => admissionFailureCalls.push('manifest'),
    runCatalog: async () => admissionFailureCalls.push('catalog'),
    runBusinessFoundationManifest: async () => admissionFailureCalls.push('business-foundation-manifest'),
    runBusinessFoundationAdmissionBatchRequest: async () => {
      admissionFailureCalls.push('business-foundation-admission-batch-request');
      throw admissionFailure;
    },
    runBusinessFoundationAdmissionCatalog: async () => admissionFailureCalls.push('business-foundation-admission-catalog'),
    runBusinessFoundationCatalog: async () => admissionFailureCalls.push('business-foundation-catalog'),
    runBusinessFoundationShadowAdmission: async () => admissionFailureCalls.push('business-shadow-admission'),
    report: message => admissionFailureCalls.push(`report:${message.code}`),
  });
  assert.strictEqual(admissionFailureCode, 1);
  assert.deepStrictEqual(admissionFailureCalls, [
    'source-isolation', 'start', 'manifest', 'catalog', 'business-foundation-manifest',
    'business-foundation-admission-batch-request', 'report:VNEXT_PG17_ADMISSION_INPUT_INVALID', 'stop',
  ]);

  const shadowFailureCalls = [];
  const shadowFailure = Object.assign(new Error('synthetic shadow admission failure'), { code: 'VNEXT_PG17_ADMISSION_RECONCILIATION_MISMATCH' });
  const shadowFailureCode = await run({
    runtimeFactory: () => ({
      async start() { shadowFailureCalls.push('start'); },
      async stop() { shadowFailureCalls.push('stop'); },
    }),
    runSourceIsolation: async () => shadowFailureCalls.push('source-isolation'),
    runManifest: async () => shadowFailureCalls.push('manifest'),
    runCatalog: async () => shadowFailureCalls.push('catalog'),
    runBusinessFoundationManifest: async () => shadowFailureCalls.push('business-foundation-manifest'),
    runBusinessFoundationAdmissionBatchRequest: async () => shadowFailureCalls.push('business-foundation-admission-batch-request'),
    runBusinessFoundationAdmissionCatalog: async () => shadowFailureCalls.push('business-foundation-admission-catalog'),
    runBusinessFoundationCatalog: async () => shadowFailureCalls.push('business-foundation-catalog'),
    runBusinessFoundationShadowAdmission: async () => { shadowFailureCalls.push('business-shadow-admission'); throw shadowFailure; },
    runProductionVerifierReadiness: async () => shadowFailureCalls.push('production-verifier-readiness'),
    runBootstrap: async () => shadowFailureCalls.push('bootstrap'),
    report: message => shadowFailureCalls.push(`report:${message.code}`),
  });
  assert.strictEqual(shadowFailureCode, 1);
  assert.deepStrictEqual(shadowFailureCalls, [
    'source-isolation', 'start', 'manifest', 'catalog', 'business-foundation-manifest',
    'business-foundation-admission-batch-request', 'business-foundation-admission-catalog', 'business-foundation-catalog',
    'business-shadow-admission', 'report:VNEXT_PG17_ADMISSION_RECONCILIATION_MISMATCH', 'stop',
  ]);

  const cleanupCalls = [];
  const cleanupCode = await run({
    runtimeFactory: () => ({
      async start() { cleanupCalls.push('start'); },
      async stop() {
        cleanupCalls.push('stop');
        throw Object.assign(new Error('private cleanup detail'), { code: 'VNEXT_PG17_TEST_RUNTIME_UNAVAILABLE' });
      },
    }),
    runSourceIsolation: async () => cleanupCalls.push('source-isolation'),
    runManifest: async () => cleanupCalls.push('manifest'),
    runCatalog: async () => cleanupCalls.push('catalog'),
    runBusinessFoundationManifest: async () => cleanupCalls.push('business-foundation-manifest'),
    runBusinessFoundationAdmissionBatchRequest: async () => cleanupCalls.push('business-foundation-admission-batch-request'),
    runBusinessFoundationAdmissionCatalog: async () => cleanupCalls.push('business-foundation-admission-catalog'),
    runBusinessFoundationCatalog: async () => cleanupCalls.push('business-foundation-catalog'),
    runBusinessFoundationShadowAdmission: async () => cleanupCalls.push('business-shadow-admission'),
    runUnifiedDesktopRegistration: async () => cleanupCalls.push('unified-desktop-registration'),
    runProductionVerifierReadiness: async () => cleanupCalls.push('production-verifier-readiness'),
    runBootstrap: async () => cleanupCalls.push('bootstrap'),
    runRecovery: async () => cleanupCalls.push('recovery'),
    runTrustedSessionBoundary: async () => cleanupCalls.push('trusted-session-boundary'),
    runAccessContext: async () => cleanupCalls.push('access-context'),
    runPolicyPublication: async () => cleanupCalls.push('policy-publication'),
    runRoleMutation: async () => cleanupCalls.push('role-mutation'),
    runLinkRevocation: async () => cleanupCalls.push('link-revocation'),
    runLinkRevocationParity: async () => cleanupCalls.push('link-revocation-parity'),
    report: message => cleanupCalls.push(`report:${message.code}`),
  });
  assert.strictEqual(cleanupCode, 1);
  assert.deepStrictEqual(cleanupCalls, [
    'source-isolation', 'start', 'manifest', 'catalog', 'business-foundation-manifest', 'business-foundation-admission-batch-request', 'business-foundation-admission-catalog', 'business-foundation-catalog', 'business-shadow-admission', 'unified-desktop-registration', 'production-verifier-readiness',
    'bootstrap', 'recovery', 'trusted-session-boundary', 'access-context', 'policy-publication',
    'role-mutation', 'link-revocation', 'link-revocation-parity', 'stop',
    'report:VNEXT_PG17_TEST_RUNTIME_UNAVAILABLE',
  ]);
  console.log('vNext PG17 runner orchestration checks passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
