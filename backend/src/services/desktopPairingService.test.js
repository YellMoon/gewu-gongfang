const assert = require('assert');
const Database = require('better-sqlite3');
const { createDesktopPairing, exchangeDesktopPairing } = require('./desktopPairingService');

const db = new Database(':memory:');
db.exec(`CREATE TABLE desktop_device_pairings(
  id TEXT PRIMARY KEY, device_id TEXT, device_name TEXT, phone TEXT,
  secret_hash TEXT, pairing_code TEXT, status TEXT, expires_at TEXT,
  approved_by TEXT, user_id TEXT, created_at TEXT, updated_at TEXT, exchanged_at TEXT
)`);

const secret = 'a'.repeat(64);
const started = createDesktopPairing(db, { deviceId: 'd1', deviceName: 'Office PC', secret }, {
  now: '2026-01-01T00:00:00Z',
  expiresAt: '2026-01-01T00:10:00Z',
});
assert.strictEqual(started.status, 'pending');
assert.strictEqual(db.prepare('SELECT phone FROM desktop_device_pairings WHERE id=?').get(started.id).phone, '');
assert.strictEqual(db.prepare('SELECT secret_hash FROM desktop_device_pairings WHERE id=?').get(started.id).secret_hash.length, 64);

for (const forbidden of [
  { phone: '13000000000' },
  { userId: 'u-other' },
  { role: 'super_admin' },
  { teacherId: 'teacher-other' },
]) {
  assert.throws(
    () => createDesktopPairing(db, { deviceId: `forbidden-${Object.keys(forbidden)[0]}`, secret, ...forbidden }),
    error => error.code === 'PAIRING_IDENTITY_NOT_ALLOWED',
  );
}

assert.throws(
  () => exchangeDesktopPairing(db, { id: started.id, secret }, { now: '2026-01-01T00:01:00Z' }),
  error => error.code === 'PAIRING_NOT_APPROVED',
);
db.prepare("UPDATE desktop_device_pairings SET status='approved',user_id='u1' WHERE id=?").run(started.id);
assert.throws(
  () => exchangeDesktopPairing(db, { id: started.id, secret: 'b'.repeat(64) }, { now: '2026-01-01T00:01:00Z' }),
  error => error.code === 'PAIRING_SECRET_INVALID',
);
assert.deepStrictEqual(
  exchangeDesktopPairing(db, { id: started.id, secret }, { now: '2026-01-01T00:01:00Z' }),
  { userId: 'u1', deviceId: 'd1' },
);
assert.throws(
  () => exchangeDesktopPairing(db, { id: started.id, secret }, { now: '2026-01-01T00:01:00Z' }),
  error => error.code === 'PAIRING_ALREADY_EXCHANGED',
);

const expired = createDesktopPairing(db, { deviceId: 'd2', secret }, {
  now: '2026-01-01T00:00:00Z',
  expiresAt: '2026-01-01T00:00:01Z',
});
db.prepare("UPDATE desktop_device_pairings SET status='approved',user_id='u1' WHERE id=?").run(expired.id);
assert.throws(
  () => exchangeDesktopPairing(db, { id: expired.id, secret }, { now: '2026-01-01T00:01:00Z' }),
  error => error.code === 'PAIRING_EXPIRED',
);

console.log('desktop pairing service tests passed');
