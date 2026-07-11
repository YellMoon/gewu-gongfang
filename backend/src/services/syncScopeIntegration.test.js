const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseService } = require('../database');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-sync-scope-'));
process.env.DB_PATH = path.join(dir, 'test.db');
process.env.READ_DB_PATH = process.env.DB_PATH;
const db = new DatabaseService();
try {
  const now = '2026-07-11T00:00:00.000Z';
  db.db.prepare('INSERT INTO teachers (id,name,created_at,updated_at) VALUES (?,?,?,?)').run('t1','T1',now,now);
  db.db.prepare('INSERT INTO teachers (id,name,created_at,updated_at) VALUES (?,?,?,?)').run('t2','T2',now,now);
  db.db.prepare('INSERT INTO courses (id,name,display_name,type,source_type,teacher_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run('c1','C1','C1',1,1,'t1',now,now);
  db.db.prepare('INSERT INTO courses (id,name,display_name,type,source_type,teacher_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run('c2','C2','C2',1,1,'t2',now,now);
  const scoped = db.getScopedChangeQueueSince(0, { tenantId:'default', deviceId:'server', clientId:'d1',
    authz:{ kind:'teacher', userId:'u1', teacherId:'t1', deviceId:'d1' } });
  assert(scoped.changes.some(x => x.table === 'courses' && x.data.id === 'c1'));
  assert(!scoped.changes.some(x => x.table === 'courses' && x.data.id === 'c2'));
  assert.throws(() => db.getScopedChangeQueueSince(0, { tenantId:'default' }), e => e.code === 'AUTHORIZATION_CONTEXT_REQUIRED');

  db.registerSyncDevice('d1');
  const issued = db.issueSyncAuthorization('d1', { actorUserId:'u1', actorTeacherId:'t1' });
  assert.strictEqual(db.verifySyncAuthorization('d1', issued.token, { actorUserId:'u2', actorTeacherId:'t1' }), false);
  assert.ok(db.verifySyncAuthorization('d1', issued.token, { actorUserId:'u1', actorTeacherId:'t1' }));

  const denied = db.applySyncChanges([{ id:'evil', table:'courses', action:'update', data:{id:'c2',teacher_id:'t2'}, updatedAt:now }],
    { tenantId:'default', deviceId:'d1', authz:{kind:'teacher',userId:'u1',teacherId:'t1',deviceId:'d1'} });
  assert.strictEqual(denied.applied, 0);
  assert.strictEqual(db.db.prepare('SELECT name FROM courses WHERE id=?').get('c2').name, 'C2');
  assert.strictEqual(db.db.prepare('SELECT reason_code FROM sync_rejections WHERE operation_id=?').get('evil').reason_code, 'TEACHER_SCOPE_VIOLATION');
  const applied = db.applySyncChanges([{ id:'good', table:'courses', action:'update', data:{id:'c1',teacher_id:'t1',name:'C1 updated'}, updatedAt:'2026-07-12T00:00:00.000Z' }],
    { tenantId:'default', deviceId:'d1', authz:{kind:'teacher',userId:'u1',teacherId:'t1',deviceId:'d1'} });
  assert.strictEqual(applied.applied, 1);
  assert.deepStrictEqual(db.db.prepare('SELECT updated_by_user_id, source_device_id, source_operation_id FROM sync_record_provenance WHERE table_name=? AND record_id=?').get('courses','c1'),
    { updated_by_user_id:'u1', source_device_id:'d1', source_operation_id:'good' });
  console.log('sync scope integration tests passed');
} finally { db.close(); fs.rmSync(dir,{recursive:true,force:true}); }
