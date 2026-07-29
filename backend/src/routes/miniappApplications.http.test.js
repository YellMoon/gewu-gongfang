const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

async function requestJson(origin, pathname, token) {
  const response = await fetch(`${origin}${pathname}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'x-idempotency-key': 'retired-miniapp-application-test',
    },
    body: JSON.stringify({ applicationType: 'student', payload: { legacy: true } }),
  });
  return { status: response.status, body: await response.json() };
}

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-retired-miniapp-applications-'));
const previous = {
  dbPath: process.env.DB_PATH,
  readDbPath: process.env.READ_DB_PATH,
  jwtSecret: process.env.JWT_SECRET,
  nodeEnv: process.env.NODE_ENV,
};
process.env.DB_PATH = path.join(workspace, 'applications.db');
process.env.READ_DB_PATH = process.env.DB_PATH;
process.env.JWT_SECRET = 'retired-miniapp-application-test-secret';
process.env.NODE_ENV = 'production';

const { DatabaseService } = require('../database');
const database = new DatabaseService();
const db = database.db;
const now = '2026-07-28T00:00:00.000Z';
db.prepare(`INSERT INTO users
  (id,phone,phone_normalized,name,role,identity_kind,status,login_enabled,
   review_status,auth_version,deleted,created_at,updated_at)
  VALUES('legacy-applicant','13800138000','13800138000','Applicant',
    'pending','unrecognized',1,0,'pending',1,0,?,?)`).run(now, now);

const { createMiniappIdentityService } = require('../services/miniappIdentityService');
const token = createMiniappIdentityService({
  db,
  jwtSecret: process.env.JWT_SECRET,
  now: () => new Date(now),
  uuid: () => 'retired-miniapp-application-session',
}).issueUnrecognizedToken(db.prepare("SELECT * FROM users WHERE id='legacy-applicant'").get()).token;

const databaseModule = require('../database');
databaseModule.getInstance = () => database;
delete require.cache[require.resolve('../app')];
const { createApp } = require('../app');

(async () => {
  const server = createApp().listen(0);
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const retired = await requestJson(origin, '/api/miniapp/applications', token);
    assert.strictEqual(retired.status, 403);
    assert.strictEqual(retired.body.code, 'MINIAPP_VISITOR_SESSION_REQUIRED');
    assert.strictEqual(
      db.prepare('SELECT COUNT(*) AS count FROM miniapp_role_applications').get().count,
      0,
      'the retired direct application path must not write the legacy table',
    );
    console.log('retired miniapp applications route checks passed');
  } finally {
    await new Promise(resolve => server.close(resolve));
    database.close();
    if (previous.dbPath === undefined) delete process.env.DB_PATH;
    else process.env.DB_PATH = previous.dbPath;
    if (previous.readDbPath === undefined) delete process.env.READ_DB_PATH;
    else process.env.READ_DB_PATH = previous.readDbPath;
    if (previous.jwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previous.jwtSecret;
    if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous.nodeEnv;
    fs.rmSync(workspace, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
