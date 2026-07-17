const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('src/pages/IdentityDeviceCenter.tsx', 'utf8');
const style = fs.readFileSync('src/pages/IdentityDeviceCenter.css', 'utf8');
const decoded = source.replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex) => String.fromCharCode(Number.parseInt(hex, 16)));

assert.ok(decoded.includes('待审设备申请') && decoded.includes('我的设备') && decoded.includes('全部设备') && decoded.includes('本地数据主机'));
assert.ok(decoded.includes('申请人与审批人相同，但审批来自另一台可信设备'));
assert.ok(source.includes('loading') && source.includes('empty') && source.includes('offline'));
assert.ok(source.includes('expired') && source.includes('conflict') && source.includes('concurrent') && source.includes('revoked'));
assert.ok(source.includes('operationRef') && source.includes('Modal.confirm'), 'all mutations need a synchronous operation lock and confirmation');
assert.ok(source.includes('approveDesktopChallenge') && source.includes('rejectDesktopChallenge') && source.includes('revokeDesktopDevice'));
assert.ok(source.includes('replacementDeviceId'), 'replacement revocation must preserve an explicit device relationship');
assert.strictEqual(source.includes('<Select'), false);
assert.strictEqual(source.includes('selectedUsers'), false);
assert.strictEqual(decoded.includes('选择设备绑定账号'), false);
assert.strictEqual(source.includes('userId:'), false, 'review page must not submit or select a claimant user id');
assert.ok(style.includes(':focus-visible') && style.includes('@media (max-width: 900px)'));

console.log('identity device center page source checks passed');
