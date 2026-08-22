const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('public/electron.js', 'utf8');

assert.ok(!source.includes('primaryHost') && !source.includes('primary-host'),
  'the unified Electron main must not retain local host diagnostics');
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
assert.ok(source.includes("listen(port, '127.0.0.1'"),
  'the local cache helper must bind only to loopback');

console.log('electron local identity diagnostics checks passed');
