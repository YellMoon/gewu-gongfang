const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseService } = require('../database');
const { createMiniappWechatBindingService } = require('./miniappWechatBindingService');

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-miniapp-wechat-binding-'));
const previous = {
  dbPath: process.env.DB_PATH,
  readDbPath: process.env.READ_DB_PATH,
  nodeEnv: process.env.NODE_ENV,
};
process.env.DB_PATH = path.join(workspace, 'binding.db');
process.env.READ_DB_PATH = process.env.DB_PATH;
process.env.NODE_ENV = 'production';

let database;
try {
  database = new DatabaseService();
  const db = database.db;
  const now = '2026-07-23T08:00:00.000Z';
  const insertUser = db.prepare(`INSERT INTO users
    (id, phone, phone_normalized, name, role, identity_kind, status, login_enabled,
     review_status, auth_version, is_super_admin_identity, deleted, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, 1, 'approved', 1, ?, 0, ?, ?)`);
  insertUser.run('formal-user', '13800138000', '13800138000', 'Formal User', 'teacher', 'teacher', 0, now, now);
  insertUser.run('second-user', '13900139000', '13900139000', 'Second User', 'student', 'student', 0, now, now);
  insertUser.run('third-user', '13600136000', '13600136000', 'Third User', 'student', 'student', 0, now, now);
  insertUser.run('ordinary-admin', '13500135000', '13500135000', 'Ordinary Admin', 'admin', 'admin', 0, now, now);

  const superAdmin = db.prepare("SELECT * FROM users WHERE id='miniapp-admin-13732250653'").get();
  const normalAdmin = db.prepare("SELECT * FROM users WHERE id='ordinary-admin'").get();
  let sequence = 0;
  const service = createMiniappWechatBindingService({
    db,
    now: () => new Date(now),
    uuid: () => `binding-${++sequence}`,
  });

  const first = service.requestBinding({
    targetUserId: 'formal-user',
    phone: '138 0013 8000',
    openid: 'openid-new',
    unionid: 'unionid-new',
  });
  assert.deepStrictEqual(
    [first.status, first.revision, first.phoneMasked, first.targetName],
    ['submitted', 1, '138****8000', 'Formal User'],
  );
  assert.strictEqual(service.requestBinding({
    targetUserId: 'formal-user',
    phone: '13800138000',
    openid: 'openid-new',
  }).id, first.id, 'identical active requests should be idempotent');

  const listed = service.list({ status: 'submitted' });
  assert.strictEqual(listed.items.length, 1);
  assert.strictEqual(listed.items[0].phoneMasked, '138****8000');
  assert.ok(!JSON.stringify(listed).includes('13800138000'), 'review projections must not expose full phones');
  assert.ok(!JSON.stringify(listed).includes('openid-new'), 'review projections must not expose candidate openids');

  assert.throws(
    () => service.approve({ actor: normalAdmin, requestId: first.id, expectedRevision: 1 }),
    error => error.code === 'WECHAT_BINDING_REVIEW_FORBIDDEN',
  );
  assert.throws(
    () => service.approve({ actor: superAdmin, requestId: first.id, expectedRevision: 2 }),
    error => error.code === 'WECHAT_BINDING_REVISION_CONFLICT',
  );

  const approved = service.approve({
    actor: superAdmin,
    requestId: first.id,
    expectedRevision: 1,
  });
  assert.deepStrictEqual([approved.status, approved.revision], ['approved', 2]);
  assert.deepStrictEqual(
    db.prepare("SELECT wechat_openid, wechat_unionid, auth_version FROM users WHERE id='formal-user'").get(),
    { wechat_openid: 'openid-new', wechat_unionid: 'unionid-new', auth_version: 2 },
  );
  assert.deepStrictEqual(
    service.approve({ actor: superAdmin, requestId: first.id, expectedRevision: 1 }),
    approved,
    'replayed approval should return the existing terminal result',
  );
  assert.strictEqual(
    db.prepare("SELECT action FROM authorization_audit_log ORDER BY rowid DESC LIMIT 1").get().action,
    'approve_wechat_binding',
  );

  assert.throws(
    () => service.requestBinding({
      targetUserId: 'second-user',
      phone: '13900139000',
      openid: 'openid-new',
    }),
    error => error.code === 'WECHAT_BINDING_REQUEST_CONFLICT',
    'an openid already bound to a user cannot request another target',
  );

  const second = service.requestBinding({
    targetUserId: 'second-user',
    phone: '13900139000',
    openid: 'openid-second',
  });
  assert.throws(
    () => service.requestBinding({
      targetUserId: 'second-user',
      phone: '13900139000',
      openid: 'openid-third',
    }),
    error => error.code === 'WECHAT_BINDING_REQUEST_CONFLICT',
    'a target user can have only one active request',
  );
  db.prepare("UPDATE users SET phone_normalized='13900139001', phone='13900139001' WHERE id='second-user'").run();
  assert.throws(
    () => service.approve({ actor: superAdmin, requestId: second.id, expectedRevision: 1 }),
    error => error.code === 'WECHAT_BINDING_TARGET_CHANGED',
  );
  assert.strictEqual(
    db.prepare('SELECT status FROM miniapp_wechat_binding_requests WHERE id=?').get(second.id).status,
    'submitted',
    'failed approval must leave the request untouched',
  );

  const third = service.requestBinding({
    targetUserId: 'third-user',
    phone: '13600136000',
    openid: 'openid-third',
  });
  const rejected = service.reject({
    actor: superAdmin,
    requestId: third.id,
    expectedRevision: 1,
    reason: 'identity could not be confirmed',
  });
  assert.deepStrictEqual([rejected.status, rejected.revision], ['rejected', 2]);
  assert.strictEqual(
    db.prepare('SELECT review_note FROM miniapp_wechat_binding_requests WHERE id=?').get(third.id).review_note,
    'identity could not be confirmed',
  );
  assert.strictEqual(
    db.prepare("SELECT action FROM authorization_audit_log ORDER BY rowid DESC LIMIT 1").get().action,
    'reject_wechat_binding',
  );

  console.log('miniapp wechat binding service checks passed');
} finally {
  try { database?.close(); } catch (_error) {}
  if (previous.dbPath === undefined) delete process.env.DB_PATH;
  else process.env.DB_PATH = previous.dbPath;
  if (previous.readDbPath === undefined) delete process.env.READ_DB_PATH;
  else process.env.READ_DB_PATH = previous.readDbPath;
  if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previous.nodeEnv;
  try { fs.rmSync(workspace, { recursive: true, force: true }); } catch (_error) {}
}
