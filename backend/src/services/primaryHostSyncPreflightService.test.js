const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const {
  runRelayQueueReadPreview,
  runScopedSyncReadPreview,
} = require('./primaryHostSyncPreflightService');

const db = new Database(':memory:');
db.exec(fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8'));
for (const [name, ddl] of [
  ['attempt', 'INTEGER NOT NULL DEFAULT 0'],
  ['max_attempts', 'INTEGER NOT NULL DEFAULT 3'],
  ['next_attempt_at', 'TEXT'],
  ['deadline_at', 'TEXT'],
  ['result_expires_at', 'TEXT'],
]) {
  if (!db.prepare('PRAGMA table_info(miniapp_tasks)').all().some(column => column.name === name)) {
    db.exec(`ALTER TABLE miniapp_tasks ADD COLUMN ${name} ${ddl}`);
  }
}
const now = '2026-07-18T08:00:00.000Z';
db.prepare(`INSERT INTO users
  (id,phone,name,role,status,login_enabled,review_status,auth_version,is_super_admin_identity,deleted,created_at,updated_at)
  VALUES ('preflight-user','13000000001','Preflight User','super_admin',1,1,'approved',4,0,0,?,?)`).run(now, now);
db.prepare(`INSERT INTO desktop_device_authorizations
  (id,device_id,device_name,device_kind,user_id,public_key,key_fingerprint,status,source_challenge_id,
   last_phone_verified_at,phone_reverify_due_at,credential_version,row_version,created_at,updated_at)
  VALUES ('preflight-authorization','preflight-device','Preflight Device','desktop-client','preflight-user',
    'public-key',?,'active','source-challenge',?,'2026-08-18T08:00:00.000Z',7,1,?,?)`)
  .run('a'.repeat(64), now, now, now);
db.prepare(`INSERT INTO desktop_sessions
  (sid,user_id,device_id,authorization_id,active_role,eligible_roles_json,auth_version,credential_version,
   status,issued_at,expires_at,row_version,created_at,updated_at)
  VALUES ('preflight-session','preflight-user','preflight-device','preflight-authorization','super_admin',
    '["super_admin"]',4,7,'active',?,'2026-07-18T09:00:00.000Z',1,?,?)`).run(now, now, now);

const actor = {
  userId: 'preflight-user', deviceId: 'preflight-device', authorizationId: 'preflight-authorization',
  sessionId: 'preflight-session', activeRole: 'super_admin', eligibleRoles: ['super_admin'],
  authVersion: 4, credentialVersion: 7,
};

const insertSubject = db.prepare(`INSERT INTO subjects
  (id,name,created_at,updated_at) VALUES (?,?,?,?)`);
db.transaction(() => {
  for (let index = 0; index < 150; index += 1) {
    insertSubject.run(`preflight-subject-${index}`, `Subject ${index}`, now, now);
  }
})();

const before = db.prepare('SELECT total_changes() value').get().value;
const scoped = runScopedSyncReadPreview({ db, actorContext: actor, now: new Date(now) });
assert.strictEqual(scoped.status, 'ok');
assert.ok(scoped.tablesChecked >= 10);
assert.strictEqual(scoped.actor.userId, actor.userId);
assert.strictEqual(scoped.sourceRowCounts.subjects, 150);
assert.strictEqual(scoped.visibleRowCounts.subjects, 150);
assert.strictEqual(scoped.sampledRowCounts.subjects, 100,
  'scope preflight must inspect a bounded sample instead of materializing an entire table');
assert.strictEqual(scoped.maxRowsPerTable, 100);
const relay = runRelayQueueReadPreview({
  db, actorContext: actor, targetDeviceId: actor.deviceId, now: new Date(now),
});
assert.strictEqual(relay.status, 'ok');
assert.strictEqual(relay.protocolVersion, 2);
assert.strictEqual(db.prepare('SELECT total_changes() value').get().value, before, 'preflight must execute zero writes');

assert.throws(
  () => runScopedSyncReadPreview({
    db, actorContext: { ...actor, credentialVersion: 8 }, now: new Date(now),
  }),
  error => error.code === 'PRIMARY_HOST_PREFLIGHT_ACTOR_MISMATCH'
);

db.exec('DROP TABLE courses');
assert.throws(
  () => runScopedSyncReadPreview({ db, actorContext: actor, now: new Date(now) }),
  error => error.code === 'PRIMARY_HOST_SYNC_PREVIEW_SCHEMA_INCOMPATIBLE'
);

db.exec('DROP TABLE miniapp_tasks');
assert.throws(
  () => runRelayQueueReadPreview({
    db, actorContext: actor, targetDeviceId: actor.deviceId, now: new Date(now),
  }),
  error => error.code === 'PRIMARY_HOST_RELAY_PREFLIGHT_SCHEMA_INCOMPATIBLE'
);

db.close();
console.log('primary host sync preflight service checks passed');
