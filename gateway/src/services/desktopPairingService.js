const crypto = require('crypto');
const CODES = { REQUIRED:'PAIRING_INPUT_REQUIRED', IDENTITY:'PAIRING_IDENTITY_NOT_ALLOWED', NOT_FOUND:'PAIRING_NOT_FOUND', NOT_APPROVED:'PAIRING_NOT_APPROVED', EXPIRED:'PAIRING_EXPIRED', SECRET:'PAIRING_SECRET_INVALID', USED:'PAIRING_ALREADY_EXCHANGED' };
const error = code => Object.assign(new Error(code), { code });
const normalizePhone = value => String(value || '').replace(/\D/g, '');
const hashSecret = secret => crypto.createHash('sha256').update(String(secret || '')).digest('hex');

function createDesktopPairing(db, input = {}, options = {}) {
  if (['phone', 'userId', 'role', 'teacherId'].some(key => Object.hasOwn(input, key))) throw error(CODES.IDENTITY);
  const deviceId = String(input.deviceId || '');
  const secret = String(input.secret || '');
  if (!deviceId || deviceId.length > 128 || String(input.deviceName || '').length > 128 || secret.length < 32 || secret.length > 128) throw error(CODES.REQUIRED);
  const now = options.now || new Date().toISOString();
  const expiresAt = options.expiresAt || new Date(Date.parse(now) + 600000).toISOString();
  const pending = db.prepare("SELECT created_at FROM desktop_device_pairings WHERE device_id=? AND status='pending' ORDER BY created_at DESC LIMIT 1").get(deviceId);
  if (pending && Date.parse(now) - Date.parse(pending.created_at) < 5000) throw error('PAIRING_RATE_LIMITED');
  db.prepare("UPDATE desktop_device_pairings SET status='rejected',updated_at=? WHERE device_id=? AND status='pending'").run(now, deviceId);
  const id = crypto.randomUUID();
  const insert = db.prepare("INSERT INTO desktop_device_pairings(id,device_id,device_name,phone,secret_hash,pairing_code,status,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?,'pending',?,?,?)");
  let pairingCode;
  for (let attempt = 0; attempt < 5; attempt++) {
    pairingCode = String(crypto.randomInt(100000, 1000000));
    try { insert.run(id, deviceId, input.deviceName || deviceId, null, hashSecret(secret), pairingCode, expiresAt, now, now); break; }
    catch (caught) { if (attempt === 4 || !String(caught.code).includes('CONSTRAINT')) throw caught; }
  }
  return { id, pairingCode, expiresAt, status:'pending' };
}

function exchangeDesktopPairing(db, input = {}, options = {}) {
  const row = db.prepare('SELECT * FROM desktop_device_pairings WHERE id=?').get(input.id);
  if (!row) throw error(CODES.NOT_FOUND);
  const now = options.now || new Date().toISOString();
  if (Date.parse(row.expires_at) < Date.parse(now)) throw error(CODES.EXPIRED);
  if (row.exchanged_at) throw error(CODES.USED);
  if (row.status !== 'approved') throw error(CODES.NOT_APPROVED);
  const actual = Buffer.from(hashSecret(input.secret), 'hex');
  const expected = Buffer.from(row.secret_hash, 'hex');
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) throw error(CODES.SECRET);
  const changed = db.prepare('UPDATE desktop_device_pairings SET exchanged_at=?,updated_at=? WHERE id=? AND exchanged_at IS NULL').run(now, now, row.id);
  if (changed.changes !== 1) throw error(CODES.USED);
  return { userId:row.user_id, deviceId:row.device_id };
}
module.exports = { CODES, normalizePhone, hashSecret, createDesktopPairing, exchangeDesktopPairing };
