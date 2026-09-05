'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, 'packaged-smoke-check.js'), 'utf8');

assert.match(
  source,
  /mkdtempSync\(/,
  'packaged smoke must create an isolated user-data directory',
);
assert.match(
  source,
  /--user-data-dir=/,
  'packaged smoke must pass the isolated user-data directory to Electron',
);
assert.match(
  source,
  /rmSync\([^)]*\{\s*recursive:\s*true,\s*force:\s*true/,
  'packaged smoke must remove only its own temporary user-data directory',
);
assert.match(
  source,
  /maxRetries:\s*[1-9]\d*/,
  'packaged smoke cleanup must retry while Electron releases temporary files',
);
assert.match(
  source,
  /await\s+waitForProcessExit\(/,
  'packaged smoke must wait for the Electron process to exit before deleting user data',
);
assert.match(
  source,
  /function verifyPackagedNativeAbi\(/,
  'packaged smoke must verify the embedded native database module with Electron before launch',
);
assert.match(
  source,
  /ELECTRON_RUN_AS_NODE/,
  'packaged smoke must use the Electron runtime for native ABI verification',
);
assert.match(
  source,
  /better-sqlite3/,
  'packaged smoke must verify the embedded better-sqlite3 module',
);
assert.match(
  source,
  /verifyPackagedNativeAbi\(\);/,
  'packaged smoke must run native ABI verification before the renderer smoke flow',
);
assert.match(
  source,
  /function verifyPackagedRendererBundle\(/,
  'packaged smoke must verify that the packaged renderer bundle is present before launch',
);
assert.match(
  source,
  /build['"],\s*['"]index\.html/,
  'packaged smoke must require the renderer entry file inside the packaged app',
);
assert.match(
  source,
  /verifyPackagedRendererBundle\(\);/,
  'packaged smoke must run renderer-bundle verification before the renderer smoke flow',
);
assert.doesNotMatch(
  source,
  /taskkill', \['\/PID', String\(pid\), '\/T'/,
  'packaged smoke must stop only its exact Electron PID and never traverse unrelated process trees',
);
assert.match(
  source,
  /function findUserDataProcessIds\(/,
  'packaged smoke must locate only processes tied to its random user-data directory before cleanup',
);
assert.match(
  source,
  /stopUserDataProcesses\(isolatedUserDataDir\)/,
  'packaged smoke must clean up any exact renderer PID that outlives the launched main process',
);
assert.match(
  source,
  /assertNoLegacyIdentityFailure\(/,
  'packaged smoke must reject the retired generic identity-verification failure copy in a fresh profile',
);
assert.match(
  source,
  /embeddedBackendRuntimeFiles\s*=\s*\[['"]shared\/authorityProtocol\.js['"]\]/,
  'packaged smoke must require the current desktop authority helper rather than the retired cloud relay helper',
);
assert.doesNotMatch(
  source,
  /embeddedBackendRuntimeFiles\s*=\s*\[[^\]]*shared\/cloudRelayLogic\.js/,
  'packaged smoke must not require the retired cloud relay helper',
);
for (const retiredRuntimeFile of [
  'backend/src/routes/cloudRelay.js',
  'backend/src/services/cloudRelayTaskService.js',
  'backend/src/services/primaryHostIdentityService.js',
  'shared/cloudRelayLogic.js',
  'shared/primaryHostSigningKey.js',
]) {
  assert.ok(source.includes(`'${retiredRuntimeFile}'`), `packaged smoke must reject ${retiredRuntimeFile}`);
}
assert.match(
  source,
  /presentRetiredRuntimeFiles/,
  'packaged smoke must fail when any retired relay or primary-host file is present',
);

console.log('packaged smoke isolation checks passed');
