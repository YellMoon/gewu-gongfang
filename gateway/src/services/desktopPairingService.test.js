const assert = require('assert');
const Database = require('better-sqlite3');
const service = require('./desktopPairingService');

const db = new Database(':memory:');
db.exec(`CREATE TABLE desktop_device_pairings(
  id TEXT PRIMARY KEY, device_id TEXT, device_name TEXT, phone TEXT,
  secret_hash TEXT, pairing_code TEXT, status TEXT, expires_at TEXT,
  approved_by TEXT, user_id TEXT, created_at TEXT, updated_at TEXT, exchanged_at TEXT
)`);
const secret = 'a'.repeat(64);
const row = service.createDesktopPairing(db, { deviceId: 'd1', deviceName: 'Office PC', secret }, {
  now: '2026-01-01T00:00:00Z',
});
assert.strictEqual(row.status, 'pending');
assert.strictEqual(db.prepare('SELECT phone FROM desktop_device_pairings WHERE id=?').get(row.id).phone, null);
for (const forbidden of [{ phone: '13800138000' }, { userId: 'u1' }, { role: 'admin' }, { teacherId: 't1' }]) {
  assert.throws(
    () => service.createDesktopPairing(db, { deviceId: `d-${Object.keys(forbidden)[0]}`, secret, ...forbidden }),
    error => error.code === 'PAIRING_IDENTITY_NOT_ALLOWED',
  );
}
db.prepare("UPDATE desktop_device_pairings SET status='approved',user_id='u1' WHERE id=?").run(row.id);
assert.deepStrictEqual(
  service.exchangeDesktopPairing(db, { id: row.id, secret }, { now: '2026-01-01T00:01:00Z' }),
  { userId: 'u1', deviceId: 'd1' },
);
console.log('gateway desktop pairing service tests passed');
