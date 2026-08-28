const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const jwt = require('jsonwebtoken');

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
  return {
    status: response.status,
    contentType: response.headers.get('content-type') || '',
    body: await response.text(),
  };
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

const token = jwt.sign({
  sub: 'legacy-applicant', sid: 'retired-miniapp-application-session', auth_version: 1,
  token_use: 'unrecognized-student', iss: 'gewu-miniapp-auth', aud: 'gewu-miniapp-experience',
}, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });

const databaseModule = require('../database');
databaseModule.getInstance = () => database;
delete require.cache[require.resolve('../app')];
const { createApp } = require('../app');

(async () => {
  const server = createApp().listen(0);
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const retired = await requestJson(origin, '/api/miniapp/applications', token);
    assert.strictEqual(retired.status, 404);
    assert.ok(retired.contentType.includes('text/html'),
      'a retired route must fall through to the normal not-found response instead of a compatibility handler');
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
