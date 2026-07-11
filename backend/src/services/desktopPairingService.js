const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const CODES = Object.freeze({ REQUIRED:'PAIRING_INPUT_REQUIRED', NOT_FOUND:'PAIRING_NOT_FOUND',
  NOT_APPROVED:'PAIRING_NOT_APPROVED', EXPIRED:'PAIRING_EXPIRED', SECRET:'PAIRING_SECRET_INVALID', USED:'PAIRING_ALREADY_EXCHANGED' });
function error(code) { const e = new Error(code); e.code = code; return e; }
function normalizePhone(value) { return String(value || '').replace(/\D/g,''); }
function hashSecret(secret) { return crypto.createHash('sha256').update(String(secret || '')).digest('hex'); }
function safeHashEqual(raw, expected) {
  const actual = Buffer.from(hashSecret(raw),'hex'); const stored = Buffer.from(String(expected || ''),'hex');
  return actual.length === stored.length && stored.length === 32 && crypto.timingSafeEqual(actual, stored);
}
function createDesktopPairing(db, input = {}, options = {}) {
  const phone = normalizePhone(input.phone); const deviceId = String(input.deviceId || ''); const secret = String(input.secret || '');
  if (!/^1\d{10}$/.test(phone) || !deviceId || deviceId.length > 128 || String(input.deviceName || '').length > 128 || secret.length < 32 || secret.length > 128) throw error(CODES.REQUIRED);
  const now = options.now || new Date().toISOString(); const expiresAt = options.expiresAt || new Date(Date.parse(now)+10*60*1000).toISOString();
  const pending=db.prepare("SELECT created_at FROM desktop_device_pairings WHERE device_id=? AND status='pending' ORDER BY created_at DESC LIMIT 1").get(deviceId);
  if(pending&&Date.parse(now)-Date.parse(pending.created_at)<5000)throw error('PAIRING_RATE_LIMITED');
  db.prepare("UPDATE desktop_device_pairings SET status='rejected',updated_at=? WHERE device_id=? AND status='pending'").run(now,deviceId);
  const row = { id:uuidv4(), deviceId, deviceName:String(input.deviceName || deviceId), phone,
    secretHash:hashSecret(secret), pairingCode:null, expiresAt };
  const insert=db.prepare(`INSERT INTO desktop_device_pairings
    (id,device_id,device_name,phone,secret_hash,pairing_code,status,expires_at,created_at,updated_at)
    VALUES (?,?,?,?,?,?,'pending',?,?,?)`);
  for(let attempt=0;attempt<5;attempt++){row.pairingCode=String(crypto.randomInt(100000,1000000));try{insert.run(row.id,row.deviceId,row.deviceName,row.phone,row.secretHash,row.pairingCode,row.expiresAt,now,now);break;}catch(e){if(attempt===4||!String(e.code).includes('CONSTRAINT'))throw e;}}
  return { id:row.id, pairingCode:row.pairingCode, expiresAt:row.expiresAt, status:'pending' };
}
function exchangeDesktopPairing(db, input = {}, options = {}) {
  const row = db.prepare('SELECT * FROM desktop_device_pairings WHERE id=?').get(input.id);
  if (!row) throw error(CODES.NOT_FOUND); const now = options.now || new Date().toISOString();
  if (Date.parse(row.expires_at) < Date.parse(now)) throw error(CODES.EXPIRED);
  if (row.exchanged_at) throw error(CODES.USED); if (row.status !== 'approved') throw error(CODES.NOT_APPROVED);
  if (!safeHashEqual(input.secret,row.secret_hash)) throw error(CODES.SECRET);
  const changed = db.prepare('UPDATE desktop_device_pairings SET exchanged_at=?,updated_at=? WHERE id=? AND exchanged_at IS NULL').run(now,now,row.id);
  if (changed.changes !== 1) throw error(CODES.USED);
  return { userId:row.user_id, deviceId:row.device_id };
}
module.exports = { CODES, normalizePhone, hashSecret, createDesktopPairing, exchangeDesktopPairing };
