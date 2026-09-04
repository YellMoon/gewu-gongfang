'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const rootPackage = require('../package.json');
const gatewayPackage = require('../gateway/package.json');
const rootScripts = rootPackage.scripts || {};

const retiredReferences = [
  'gateway/src/databaseAuthorization.test.js',
  'gateway/src/routes/cloudRelay.http.test.js',
  'gateway/src/routes/cloudRelay.test.js',
  'gateway/src/services/cloudRelayTaskService.test.js',
  'gateway/src/services/desktopPairingService.test.js',
  'gateway/src/services/dataScopeService.parity.test.js',
  'gateway/src/services/authRateLimiter.test.js',
  'gateway/src/middleware/experienceTokenIsolation.test.js',
  'gateway/src/routes/invitationRemoval.test.js',
  'backend/src/websocket/client.test.js',
  'backend/src/websocket/hostTaskWakeup.test.js',
  'backend/src/services/desktopSessionRelayService.test.js',
  'src/services/desktopSessionRelayClient.test.js',
  'backend/src/services/cloudRelayTaskSchemaMigration.test.js',
  'backend/src/services/cloudRelayClient.test.js',
  'backend/src/services/relayAssertionService.test.js',
  'backend/src/services/primaryHostSyncPreflightService.test.js',
  'backend/src/routes/desktopCloudSync.test.js',
  'backend/src/routes/cloudRelay.http.test.js',
  'src/services/oneClickSyncService.test.js',
  'src/services/oneClickSyncTransports.test.js',
  'src/services/oneClickSyncHostBackground.test.js',
  'src/services/cloudRelayHostApi.test.js',
  'scripts/check_cloud_relay.test.js',
];

for (const [name, value] of Object.entries(rootScripts)) {
  const script = String(value || '');
  assert.ok(script, `${name} must exist`);
  for (const retired of retiredReferences) {
    assert.strictEqual(script.includes(retired), false, `${name} must not invoke retired test ${retired}`);
  }
}

function collectScript(name, seen = new Set()) {
  if (seen.has(name)) return '';
  seen.add(name);
  const lifecyclePrefix = name.startsWith('test') ? `pre${name}` : '';
  const parts = [];
  if (lifecyclePrefix && rootScripts[lifecyclePrefix]) parts.push(collectScript(lifecyclePrefix, seen));
  const script = String(rootScripts[name] || '');
  parts.push(script);
  for (const command of script.split(/\s*&&\s*/u)) {
    const match = /^npm run ([A-Za-z0-9:_-]+)$/u.exec(command.trim());
    if (match) parts.push(collectScript(match[1], seen));
  }
  return parts.join(' && ');
}

const defaultTestClosure = collectScript('test');
assert.ok(
  defaultTestClosure.includes('npm --prefix gateway test'),
  'default npm test must execute the gateway retirement suite',
);
assert.ok(
  defaultTestClosure.includes('node public/desktopAuthorityRuntimeRetirement.test.js'),
  'default npm test must execute the desktop authority retirement suite',
);

const defaultTestFiles = Array.from(defaultTestClosure.matchAll(/(?:^|\s&&\s)node ([^ ]+\.test\.js)(?=\s&&\s|$)/gu))
  .map(match => match[1]);
assert.ok(defaultTestFiles.length > 0, 'default npm test closure must expose its explicit test files');
for (const relativeTestPath of defaultTestFiles) {
  const absoluteTestPath = path.join(projectRoot, relativeTestPath);
  assert.ok(fs.existsSync(absoluteTestPath), `default npm test references missing test ${relativeTestPath}`);
  if (!relativeTestPath.startsWith('scripts/')) continue;
  const testSource = fs.readFileSync(absoluteTestPath, 'utf8');
  for (const match of testSource.matchAll(/\bread\(['"]([^'"]+)['"]\)/gu)) {
    const referencedPath = match[1];
    assert.ok(
      fs.existsSync(path.join(projectRoot, referencedPath)),
      `${relativeTestPath} directly reads missing retired file ${referencedPath}; assert its absence instead`,
    );
  }
}

for (const command of String(gatewayPackage.scripts?.test || '').split(/\s*&&\s*/u)) {
  const match = /^node (.+\.test\.js)$/u.exec(command.trim());
  assert.ok(match, `gateway test command must be an explicit test file: ${command}`);
  assert.ok(fs.existsSync(path.join(projectRoot, 'gateway', match[1])), `gateway test is missing ${match[1]}`);
}

console.log('default test entrypoint retirement checks passed');
