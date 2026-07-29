const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('public/electron.js', 'utf8');

assert.ok(
  source.includes("log(`[desktop-identity:complete-registration] ${String(error?.code || 'DESKTOP_IDENTITY_REGISTRATION_FAILED')}`);"),
  'local vault registration failures must retain only a stable main-process diagnostic code'
);
assert.strictEqual(
  source.includes('Desktop identity local request failed:'),
  false,
  'the retired local HTTP identity bridge diagnostic must remain absent'
);
assert.ok(
  source.includes("require('./localSessionSigningSecret')"),
  'the embedded backend must have a local session signing fallback when no managed JWT secret is configured'
);
assert.ok(
  source.includes('ensureLocalSessionSigningSecret(process.env, electronLocalBridgeSecret);'),
  'the local session signing fallback must be prepared before backend modules are loaded'
);
assert.ok(
  source.includes('resolveEmbeddedRuntimePort(runtimeConfig)') && source.includes('process.env.PORT = String(embeddedPort);'),
  'a primary host must bind its embedded backend to the port in its configured host URL instead of the ordinary-desktop default'
);

console.log('electron local identity diagnostics checks passed');
