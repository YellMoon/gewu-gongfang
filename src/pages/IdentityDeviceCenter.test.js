const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('src/pages/IdentityDeviceCenter.tsx', 'utf8');
const decoded = source.replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex) => String.fromCharCode(Number.parseInt(hex, 16)));

assert.ok(decoded.includes('\u6211\u7684\u5df2\u767b\u8bb0\u8bbe\u5907'));
assert.ok(source.includes('loadIdentityDeviceCenter'));
assert.ok(source.includes('revokeDesktopDevice'));
assert.ok(source.includes('provider?.ensureOnline'));
assert.ok(!source.includes('primary-host'));
assert.ok(!source.includes('approveDesktopChallenge'));
assert.ok(!source.includes('startPrimaryHostOperation'));
assert.ok(!source.includes('primaryHostRuntime'));
assert.ok(!source.includes('QRCode'));

console.log('unified identity device center source checks passed');
