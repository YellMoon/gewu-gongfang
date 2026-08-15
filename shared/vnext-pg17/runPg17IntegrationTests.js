'use strict';

const { createDisposablePg17Runtime } = require('./disposableRuntime');
const { runManifestCases } = require('./migrationManifest.test');
const { runCatalogAssertionCases } = require('./catalogAssertion.test');
const { runFirstAuthorityBootstrapMutationCases } = require('./firstAuthorityBootstrapMutation.test');
const { runEmergencyRecoveryMutationCases } = require('./emergencyRecoveryMutation.test');
const { runTrustedSessionVerifierBoundaryCases } = require('./trustedSessionVerifierBoundary.test');
const { runAccessContextResolverCases } = require('./accessContextResolver.test');
const { runPolicyPublicationMutationCases } = require('./policyPublicationMutation.test');
const { runRoleMutationCases } = require('./roleMutation.test');

function sanitizedCode(error) {
  return error && typeof error.code === 'string' && /^VNEXT_PG17_[A-Z_]+$/.test(error.code)
    ? error.code
    : 'VNEXT_PG17_TEST_RUNTIME_UNAVAILABLE';
}

async function run({
  runtimeFactory = createDisposablePg17Runtime,
  runManifest = runManifestCases,
  runCatalog = runCatalogAssertionCases,
  runBootstrap = runFirstAuthorityBootstrapMutationCases,
  runRecovery = runEmergencyRecoveryMutationCases,
  runTrustedSessionBoundary = runTrustedSessionVerifierBoundaryCases,
  runAccessContext = runAccessContextResolverCases,
  runPolicyPublication = runPolicyPublicationMutationCases,
  runRoleMutation = runRoleMutationCases,
  report = () => {},
} = {}) {
  const runtime = runtimeFactory();
  try {
    await runtime.start();
    await runManifest(runtime);
    await runCatalog(runtime);
    await runBootstrap(runtime);
    await runRecovery(runtime);
    await runTrustedSessionBoundary(runtime);
    await runAccessContext(runtime);
    await runPolicyPublication(runtime);
    await runRoleMutation(runtime);
    return 0;
  } catch (error) {
    report({ code: sanitizedCode(error) });
    return 1;
  } finally {
    await runtime.stop();
  }
}

if (require.main === module) {
  run().then(code => {
    if (code !== 0) process.exitCode = code;
  }).catch(() => {
    process.stderr.write('VNEXT_PG17_TEST_RUNTIME_UNAVAILABLE\n');
    process.exitCode = 1;
  });
}

module.exports = { run };
