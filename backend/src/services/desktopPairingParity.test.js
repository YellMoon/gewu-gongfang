const assert = require('assert');
const fs = require('fs');

for (const file of ['backend/src/routes/desktopPairing.js', 'gateway/src/routes/desktopPairing.js']) {
  const source = fs.readFileSync(file, 'utf8');
  assert.ok(source.includes("status(410)") && source.includes('DESKTOP_PAIRING_V1_REMOVED'),
    `${file} must expose only a permanent V1 tombstone`);
  assert.ok(source.includes('router.use('), `${file} must tombstone every V1 method and path`);
  for (const forbidden of [
    'createDesktopPairing', 'exchangeDesktopPairing', 'desktop_device_pairings WHERE',
    'req.body?.userId', 'registerSyncDevice', 'PAIRING_USER_INVALID',
  ]) {
    assert.ok(!source.includes(forbidden), `${file} must not retain V1 action ${forbidden}`);
  }
}

console.log('desktop pairing V1 tombstone parity tests passed');
