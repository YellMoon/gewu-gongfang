const assert = require('assert');
const fs = require('fs');
for (const file of ['backend/src/routes/desktopPairing.js', 'gateway/src/routes/desktopPairing.js']) {
  const source = fs.readFileSync(file, 'utf8');
  for (const route of ["'/start'", "'/exchange'", "'/pending'", "'/code/:pairingCode/approve'", "'/code/:pairingCode/reject'", "'/:id/approve'", "'/:id/reject'"]) {
    assert.ok(source.includes(route), `${file} missing ${route}`);
  }
  for (const code of ['SUPER_ADMIN_REQUIRED', 'PAIRING_NOT_FOUND', 'PAIRING_USER_UNRESOLVED']) assert.ok(source.includes(code));
  assert.ok(source.includes('pairing_code AS pairingCode') && !source.includes('secret_hash AS'), 'pending API must expose safe explicit fields only');
}
assert.ok(!fs.readFileSync('gateway/src/services/desktopPairingService.js', 'utf8').includes('backend/src'));
const gatewayRoute=fs.readFileSync('gateway/src/routes/desktopPairing.js','utf8');
assert.ok(gatewayRoute.includes('DEVICE_OWNER_CONFLICT')&&gatewayRoute.includes('COALESCE(cloud_devices.owner_user_id'),
  'gateway approval must reject cross-owner devices before its transaction and never overwrite owner');
console.log('desktop pairing parity tests passed');
