const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const jwt = require('jsonwebtoken');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-gateway-authz-'));
process.env.GATEWAY_DB_PATH = path.join(dir, 'gateway.db');
process.env.JWT_SECRET = 'gateway-authorization-test';

const database = require('./db/database');
let db = database.initDatabase();
const now = new Date().toISOString();
db.prepare(`INSERT INTO users (id, phone, name, user_type, status, login_enabled, review_status, is_super_admin_identity, created_at, updated_at)
 VALUES ('legacy-fixed', '137-3225-0653', 'Legacy', 'admin', 1, 1, 'approved', 0, ?, ?)`).run(now, now);
database.closeDatabase();
db = database.initDatabase();
['desktop_pairing_capabilities', 'desktop_pairing_relay_requests'].forEach(table => {
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table), `${table} must exist`);
});
const canonical = db.prepare("SELECT * FROM users WHERE replace(replace(phone, '-', ''), ' ', '') = '13732250653'").get();
assert.strictEqual(canonical.id, 'legacy-fixed');
assert.strictEqual(canonical.user_type, 'super_admin');
assert.strictEqual(canonical.is_super_admin_identity, 1);

const { authMiddleware } = require('./middleware/auth');
const req = { headers: { authorization: `Bearer ${jwt.sign({ id: 'legacy-fixed', user_type: 'admin' }, process.env.JWT_SECRET)}` } };
let status;
const res = { status(code) { status = code; return this; }, json(body) { this.body = body; return this; } };
let hydrated = false;
authMiddleware(req, res, () => { hydrated = true; });
assert.strictEqual(hydrated, true);
assert.strictEqual(req.authz.role, 'super_admin', 'middleware must hydrate canonical role from the database, not JWT claims');

db.prepare(`INSERT INTO users
  (id, phone, name, user_type, status, login_enabled, review_status, teacher_id, auth_version, created_at, updated_at)
  VALUES ('desktop-teacher', '13900000031', 'Desktop Teacher', 'teacher', 1, 1, 'approved', 'teacher-31', 4, ?, ?)`)
  .run(now, now);
const desktopToken = jwt.sign({
  sub: 'desktop-teacher', sid: 'gateway-session-31', device_id: 'gateway-device-31',
  active_role: 'teacher', eligible_roles: ['teacher'], auth_version: 4, credential_version: 2,
  token_use: 'desktop-session', iss: 'gewu-auth', aud: 'gewu-api',
}, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
const desktopReq = { headers: { authorization: `Bearer ${desktopToken}`, 'x-device-id': 'gateway-device-31' } };
let desktopHydrated = false;
authMiddleware(desktopReq, res, () => { desktopHydrated = true; });
assert.strictEqual(desktopHydrated, true);
assert.deepStrictEqual({
  userId: desktopReq.authz.userId,
  deviceId: desktopReq.authz.deviceId,
  activeRole: desktopReq.authz.activeRole,
  teacherId: desktopReq.authz.teacherId,
  sessionId: desktopReq.authz.sessionId,
  authVersion: desktopReq.authz.authVersion,
  credentialVersion: desktopReq.authz.credentialVersion,
  tokenUse: desktopReq.authz.tokenUse,
  clientType: desktopReq.authz.clientType,
}, {
  userId: 'desktop-teacher', deviceId: 'gateway-device-31', activeRole: 'teacher', teacherId: 'teacher-31',
  sessionId: 'gateway-session-31', authVersion: 4, credentialVersion: 2,
  tokenUse: 'desktop-session', clientType: 'desktop',
});
const mismatchedReq = { headers: { authorization: `Bearer ${desktopToken}`, 'x-device-id': 'other-device' } };
let mismatchNext = false; let mismatchStatus = null;
authMiddleware(mismatchedReq, { status(code) { mismatchStatus = code; return this; }, json() { return this; } }, () => { mismatchNext = true; });
assert.strictEqual(mismatchNext, false);
assert.strictEqual(mismatchStatus, 401);

database.closeDatabase();
fs.rmSync(dir, { recursive: true, force: true });
console.log('gateway database authorization tests passed');
