const assert = require('assert');
const fs = require('fs');
const { resolveConfiguredDesktopIdentityKind } = require('./desktopIdentityKind');

assert.strictEqual(resolveConfiguredDesktopIdentityKind({
  primaryHostCapable: true,
  nodeRole: 'desktop-client',
}), 'desktop-client');
assert.strictEqual(resolveConfiguredDesktopIdentityKind({
  primaryHostCapable: true,
  nodeRole: 'desktop-client',
}), 'desktop-client');
assert.strictEqual(resolveConfiguredDesktopIdentityKind({
  primaryHostCapable: true,
  nodeRole: 'primary-host',
}), 'primary-host');
assert.ok(!fs.readFileSync('public/desktopIdentityKind.js', 'utf8').includes('singleUser'),
  'desktop kind must come only from the declared node role, never a legacy single-user enrollment switch');

console.log('desktop identity kind policy checks passed');
