const assert = require('assert');
const { resolveConfiguredDesktopIdentityKind } = require('./desktopIdentityKind');

assert.strictEqual(resolveConfiguredDesktopIdentityKind({
  primaryHostCapable: true,
  nodeRole: 'desktop-client',
  desktopIdentityMode: 'single-user',
  singleUserHostEnrollment: true,
}), 'primary-host');
assert.strictEqual(resolveConfiguredDesktopIdentityKind({
  primaryHostCapable: false,
  nodeRole: 'desktop-client',
  desktopIdentityMode: 'single-user',
  singleUserHostEnrollment: true,
}), 'desktop-client');
assert.strictEqual(resolveConfiguredDesktopIdentityKind({
  primaryHostCapable: true,
  nodeRole: 'desktop-client',
  desktopIdentityMode: 'full',
  singleUserHostEnrollment: true,
}), 'desktop-client');
assert.strictEqual(resolveConfiguredDesktopIdentityKind({
  primaryHostCapable: true,
  nodeRole: 'primary-host',
  desktopIdentityMode: 'single-user',
}), 'primary-host');

console.log('desktop identity kind policy checks passed');
