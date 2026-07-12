const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createDesktopCredentialStore } = require('./desktopCredentialStore');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-credential-'));
const filePath = path.join(dir, 'desktop-session.bin');
const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: value => Buffer.from(`protected:${Buffer.from(value).toString('base64')}`),
  decryptString: value => Buffer.from(String(value).replace(/^protected:/, ''), 'base64').toString('utf8'),
};
const store = createDesktopCredentialStore({ filePath, safeStorage });
assert.strictEqual(store.read(), null);
store.write({ token: 'secret-jwt', userId: 'u1', deviceId: 'd1', user: { id: 'u1', name: '教师甲', role: 'teacher' } });
assert.ok(!fs.readFileSync(filePath).toString().includes('secret-jwt'));
assert.deepStrictEqual(store.read(), {
  token: 'secret-jwt', userId: 'u1', deviceId: 'd1', user: { id: 'u1', name: '教师甲', role: 'teacher' }, expiresAt: null,
});
store.clear();
assert.strictEqual(store.read(), null);
assert.throws(() => createDesktopCredentialStore({ filePath, safeStorage: { isEncryptionAvailable: () => false } }).write({ token: 'x', userId: 'u', deviceId: 'd' }), /ENCRYPTION_UNAVAILABLE/);
console.log('desktop credential store tests passed');
