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

database.closeDatabase();
fs.rmSync(dir, { recursive: true, force: true });
console.log('gateway database authorization tests passed');
