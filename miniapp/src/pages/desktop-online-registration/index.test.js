const assert = require('assert');
const fs = require('fs');
const path = require('path');

const pagePath = path.join(__dirname, 'index.tsx');
assert.strictEqual(fs.existsSync(pagePath), true, 'the cloud desktop confirmation page must exist');

const source = fs.readFileSync(pagePath, 'utf8');
assert.match(source, /Taro\.scanCode\(/, 'the user must be able to scan the desktop pairing QR code');
assert.match(source, /openType="getPhoneNumber"/, 'phone verification must use the official WeChat capability');
assert.match(source, /\/api\/desktop\/pairing\/confirm/, 'confirmation must go only to the cloud pairing endpoint');
assert.match(source, /getCloudBusinessApiBaseUrl/, 'confirmation must target the cloud-business authority, not the legacy scheduling API');
assert.match(source, /parseDesktopPairingCode/, 'the scanned pairing payload must be structurally validated');
assert.doesNotMatch(source, /<Input\b/, 'this new path must not ask the user to type a phone number');
assert.doesNotMatch(source, /等待.*审批|设备审批/, 'this new path must not mention the retired manual approval flow');

console.log('miniapp cloud desktop pairing page contract passed');
