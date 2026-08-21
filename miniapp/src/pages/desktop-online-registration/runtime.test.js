'use strict';

const assert = require('assert');
const {
  buildPairingConfirmation,
  parseDesktopPairingCode,
} = require('./runtime');

const pairing = parseDesktopPairingCode('gewu://desktop-pairing?pairingId=pairing-123&secret=secret-456');
assert.deepStrictEqual(pairing, { pairingId: 'pairing-123', pairingSecret: 'secret-456' });
assert.deepStrictEqual(
  buildPairingConfirmation({ ...pairing, phoneCode: 'wechat-phone-code' }),
  { pairingId: 'pairing-123', pairingSecret: 'secret-456', phoneCode: 'wechat-phone-code' },
);
assert.throws(
  () => parseDesktopPairingCode('https://example.invalid/?pairingId=pairing-123&secret=secret-456'),
  error => error?.code === 'CLOUD_DESKTOP_PAIRING_CODE_INVALID',
);
assert.throws(
  () => buildPairingConfirmation({ ...pairing, phoneCode: '   ' }),
  error => error?.code === 'CLOUD_DESKTOP_PAIRING_PHONE_PROOF_REQUIRED',
);
console.log('miniapp cloud desktop pairing runtime checks passed');
