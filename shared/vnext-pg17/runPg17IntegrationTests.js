'use strict';

const { createDisposablePg17Runtime } = require('./disposableRuntime');
const { runManifestCases } = require('./migrationManifest.test');
const { runCatalogAssertionCases } = require('./catalogAssertion.test');
const { runProductionVerifierReadinessCases } = require('./productionVerifierReadiness.test');
const { runFirstAuthorityBootstrapMutationCases } = require('./firstAuthorityBootstrapMutation.test');
const { runEmergencyRecoveryMutationCases } = require('./emergencyRecoveryMutation.test');
const { runTrustedSessionVerifierBoundaryCases } = require('./trustedSessionVerifierBoundary.test');
const { runAccessContextResolverCases } = require('./accessContextResolver.test');
const { runPolicyPublicationMutationCases } = require('./policyPublicationMutation.test');
const { runRoleMutationCases } = require('./roleMutation.test');
const { runAccountDeviceLinkRevocationCases } = require('./accountDeviceLinkRevocationMutation.test');
const { runAccountDeviceLinkRevocationCanonicalParityCases } = require('./accountDeviceLinkRevocationCanonicalParity.test');
const { runSourceIsolationContractCases } = require('./sourceIsolationContract.test');

function sanitizedCode(error) {
  return error && typeof error.code === 'string' && /^VNEXT_PG17_[A-Z_]+$/.test(error.code)
    ? error.code
    : 'VNEXT_PG17_TEST_RUNTIME_UNAVAILABLE';
}

async function run({
  runtimeFactory = createDisposablePg17Runtime,
  runSourceIsolation = runSourceIsolationContractCases,
  runManifest = runManifestCases,
  runCatalog = runCatalogAssertionCases,
  runProductionVerifierReadiness = runProductionVerifierReadinessCases,
  runBootstrap = runFirstAuthorityBootstrapMutationCases,
  runRecovery = runEmergencyRecoveryMutationCases,
  runTrustedSessionBoundary = runTrustedSessionVerifierBoundaryCases,
  runAccessContext = runAccessContextResolverCases,
  runPolicyPublication = runPolicyPublicationMutationCases,
  runRoleMutation = runRoleMutationCases,
  runLinkRevocation = runAccountDeviceLinkRevocationCases,
  runLinkRevocationParity = runAccountDeviceLinkRevocationCanonicalParityCases,
  report = () => {},
} = {}) {
  let runtime;
  let exitCode = 0;
  try {
    await runSourceIsolation();
    runtime = runtimeFactory();
    await runtime.start();
    await runManifest(runtime);
    await runCatalog(runtime);
    await runProductionVerifierReadiness(runtime);
    await runBootstrap(runtime);
    await runRecovery(runtime);
    await runTrustedSessionBoundary(runtime);
    await runAccessContext(runtime);
    await runPolicyPublication(runtime);
    await runRoleMutation(runtime);
    await runLinkRevocation(runtime);
    await runLinkRevocationParity(runtime);
  } catch (error) {
    report({ code: sanitizedCode(error) });
    exitCode = 1;
  } finally {
    if (runtime) {
      try {
        await runtime.stop();
      } catch (error) {
        report({ code: sanitizedCode(error) });
        exitCode = 1;
      }
    }
  }
  return exitCode;
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
