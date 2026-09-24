const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('src/pages/IdentityDeviceCenter.tsx', 'utf8');
const decoded = source.replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex) => String.fromCharCode(Number.parseInt(hex, 16)));

assert.ok(decoded.includes('我的登录设备')); // UTF-8: user-facing login-device wording.
assert.ok(source.includes('loadIdentityDeviceCenter'));
assert.ok(source.includes('revokeDesktopDevice'));
assert.ok(source.includes('provider?.ensureOnline'));
assert.ok(!source.includes('primary-host'));
assert.ok(!source.includes('approveDesktopChallenge'));
assert.ok(!source.includes('startPrimaryHostOperation'));
assert.ok(!source.includes('primaryHostRuntime'));
assert.ok(!source.includes('QRCode'));
// UTF-8: Device history must not push account review hundreds of rows down.
assert.ok(source.includes('pagination={{ pageSize: 5, showSizeChanger: false }}'));
assert.ok(!source.includes('pagination={false}'));

console.log('unified identity device center source checks passed');
