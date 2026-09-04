'use strict';

const assert = require('assert');
const {
  parseDesktopLoginConfirmationQuery,
  desktopLoginConfirmationError,
} = require('./desktopLoginConfirmationRuntime');

assert.deepStrictEqual(parseDesktopLoginConfirmationQuery({
  scene: 'd_123456789012345678901234567890',
}), { scene: 'd_123456789012345678901234567890' });

assert.strictEqual(parseDesktopLoginConfirmationQuery({
  scene: ['d_123456789012345678901234567890'],
}), null);
assert.strictEqual(parseDesktopLoginConfirmationQuery({
  scene: ' d_12345678901234567890123456789',
}), null);
assert.strictEqual(parseDesktopLoginConfirmationQuery({
  scene: 'd_123456789012345678901234567890x',
}), null);
assert.strictEqual(parseDesktopLoginConfirmationQuery({
  desktopLogin: '1', pairingId: 'pairing-id-1', secret: 'legacy-secret',
}), null);

assert.strictEqual(
  desktopLoginConfirmationError('CLOUD_DESKTOP_PAIRING_REJECTED'),
  '登录二维码已失效，请在电脑上重新获取',
);
assert.strictEqual(
  desktopLoginConfirmationError('NETWORK_ERROR'),
  '暂时无法连接，请稍后重试',
);

console.log('desktop login confirmation runtime checks passed');
