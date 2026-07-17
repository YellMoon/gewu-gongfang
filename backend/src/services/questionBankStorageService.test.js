const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  initQuestionBankStore,
  inspectQuestionBankStore,
  assertQuestionBankWritable,
  scanQuestionBankStores,
  findQuestionBankStore,
  ensureQuestionBankAuthoritySchema,
  bindQuestionBankStoreToDatabase,
  resolveBoundQuestionBankRoot,
  commitQuestionToBoundStore,
  deleteCommittedQuestion,
  restoreCommittedQuestion,
  migrateBoundLegacyQuestions,
} = require('./questionBankStorageService');
const Database = require('better-sqlite3');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-qb-store-'));
const deviceId = 'desktop_host_test';

const manifest = initQuestionBankStore(root, { deviceId });

assert.ok(manifest.storeId.startsWith('qb_'));
assert.strictEqual(manifest.schemaVersion, 1);
assert.strictEqual(manifest.lastMountedByDeviceId, deviceId);
assert.ok(fs.existsSync(path.join(root, 'manifest.json')));
assert.ok(fs.existsSync(path.join(root, 'assets', 'images')));
assert.ok(fs.existsSync(path.join(root, 'assets', 'word-imports')));
assert.ok(fs.existsSync(path.join(root, 'assets', 'exports')));
assert.ok(fs.existsSync(path.join(root, 'backups')));

const inspected = inspectQuestionBankStore(root);
assert.strictEqual(inspected.available, true);
assert.strictEqual(inspected.manifest.storeId, manifest.storeId);

assert.doesNotThrow(() => assertQuestionBankWritable(root, { nodeRole: 'primary-host', deviceId }));
assert.throws(
  () => assertQuestionBankWritable(root, { nodeRole: 'desktop-client', deviceId: 'client_a' }),
  /Only primary-host/
);
assert.throws(
  () => inspectQuestionBankStore(path.join(root, 'missing')),
  /not available/
);

const secondRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-qb-store-second-'));
const missingRoot = path.join(os.tmpdir(), `gewu-qb-store-missing-${Date.now()}`);
const secondManifest = initQuestionBankStore(secondRoot, { deviceId: 'desktop_host_typec' });

const scan = scanQuestionBankStores([missingRoot, root, secondRoot]);
assert.strictEqual(scan.length, 3);
assert.strictEqual(scan[0].available, false);
assert.strictEqual(scan[0].status, 'offline');
assert.strictEqual(scan[1].available, true);
assert.strictEqual(scan[1].manifest.storeId, manifest.storeId);
assert.strictEqual(scan[2].available, true);
assert.strictEqual(scan[2].manifest.storeId, secondManifest.storeId);

const foundByStoreId = findQuestionBankStore([missingRoot, secondRoot], { storeId: secondManifest.storeId });
assert.strictEqual(foundByStoreId.status, 'online');
assert.strictEqual(foundByStoreId.root, secondRoot);

const missingByStoreId = findQuestionBankStore([root], { storeId: secondManifest.storeId });
assert.strictEqual(missingByStoreId.status, 'offline');
assert.strictEqual(missingByStoreId.available, false);

console.log('questionBankStorageService tests passed');

const db = new Database(':memory:');
db.exec(`
 CREATE TABLE questions (id TEXT PRIMARY KEY, tenant_id TEXT, storage_state TEXT, committed_at TEXT, committed_by_device_id TEXT, deleted INTEGER DEFAULT 0, deleted_at TEXT, updated_at TEXT);
 CREATE TABLE question_contents (id TEXT PRIMARY KEY, question_id TEXT, stem TEXT, answer TEXT, explanation TEXT, options_json TEXT, content_hash TEXT, deleted INTEGER DEFAULT 0, updated_at TEXT);
 CREATE TABLE question_assets (id TEXT PRIMARY KEY, question_id TEXT, file_name TEXT, oss_key TEXT, oss_url TEXT, deleted INTEGER DEFAULT 0, updated_at TEXT);
 CREATE TABLE audit_logs (id TEXT PRIMARY KEY, actor_user_id TEXT, action TEXT, resource_type TEXT, resource_id TEXT, details TEXT, created_at TEXT);
`);
ensureQuestionBankAuthoritySchema(db);
db.prepare("INSERT INTO questions VALUES ('q1','default','local_draft',NULL,NULL,0,NULL,'t')").run();
db.prepare("INSERT INTO question_contents VALUES ('c1','q1','题干','答案','解析','[]','hash',0,'t')").run();
db.prepare("INSERT INTO question_assets VALUES ('a1','q1','pic.txt','inline://pic.txt','data:text/plain;base64,aGVsbG8=',0,'t')").run();
db.prepare("INSERT INTO question_contents VALUES ('c-old','q1','old','','','[]','old',1,'t')").run();
db.prepare("INSERT INTO question_assets VALUES ('a-old','q1','old.txt','inline://old.txt','',1,'t')").run();
const authz = { role: 'super_admin', userId: 'root', userApproved: true, deviceTrusted: true, deviceActive: true, deviceOwnerUserId: 'root', isPrimaryHost: true };
const runtime = { nodeRole: 'primary-host', clientType: 'desktop', tokenUse: 'desktop-session', deviceId: 'host1', tokenDeviceId: 'host1' };
const bound = bindQuestionBankStoreToDatabase({ db, root, authz, runtime });
assert.strictEqual(resolveBoundQuestionBankRoot(db), path.resolve(root), 'exports must use the verified writer-DB binding root');
assert.ok(bound.dbAuthorityId);
assert.strictEqual(inspectQuestionBankStore(root).manifest.authorityDatabaseId, bound.dbAuthorityId);
assert.strictEqual(bindQuestionBankStoreToDatabase({ db, root, authz, runtime }).idempotent, true);
assert.throws(() => bindQuestionBankStoreToDatabase({ db, root: secondRoot, authz: { ...authz, role: 'admin' }, runtime }), /super administrator/);
assert.throws(() => bindQuestionBankStoreToDatabase({ db, root: secondRoot, authz, runtime }), error => error.code === 'QUESTION_BANK_DATABASE_ALREADY_BOUND');

const committed = commitQuestionToBoundStore('q1', { db, tenantId: 'default', authz, runtime });
assert.strictEqual(committed.storageState, 'host_committed');
assert.ok(fs.existsSync(path.join(root, 'questions', 'q1', 'question.json')));
assert.strictEqual(db.prepare("SELECT storage_state FROM questions WHERE id='q1'").get().storage_state, 'host_committed');

const deleted = deleteCommittedQuestion('q1', { db, tenantId: 'default', authz, runtime, operationId: 'op-delete-q1' });
assert.strictEqual(deleted.deleted, true);
assert.strictEqual(db.prepare("SELECT deleted FROM questions WHERE id='q1'").get().deleted, 1);
assert.strictEqual(db.prepare("SELECT deleted FROM question_contents WHERE id='c1'").get().deleted, 1);
assert.strictEqual(db.prepare("SELECT deleted FROM question_assets WHERE id='a1'").get().deleted, 1);
assert.ok(fs.existsSync(path.join(root, '.trash', 'op-delete-q1', 'q1', 'question.json')));
assert.throws(() => restoreCommittedQuestion('q1', { db, tenantId: 'default', authz, runtime: { ...runtime, clientType: 'miniapp' } }), error => error.code === 'HOST_DESKTOP_REQUIRED_FOR_COMMITTED_DELETE');
assert.strictEqual(restoreCommittedQuestion('q1', { db, tenantId: 'default', authz, runtime }).restored, true);
assert.strictEqual(db.prepare("SELECT deleted FROM questions WHERE id='q1'").get().deleted, 0);
assert.strictEqual(db.prepare("SELECT deleted FROM question_contents WHERE id='c1'").get().deleted, 0);
assert.strictEqual(db.prepare("SELECT deleted FROM question_contents WHERE id='c-old'").get().deleted, 1);
assert.strictEqual(db.prepare("SELECT deleted FROM question_assets WHERE id='a-old'").get().deleted, 1);
assert.ok(fs.existsSync(path.join(root, 'questions', 'q1', 'question.json')));

db.prepare("INSERT INTO questions VALUES ('q2','default','host_committed','t','host1',0,NULL,'t')").run();
db.prepare("INSERT INTO question_contents VALUES ('c2','q2','x','','','[]','h',0,'t')").run();
assert.throws(() => deleteCommittedQuestion('q2', { db, tenantId: 'default', authz, runtime: { ...runtime, clientType: 'miniapp' } }), error => error.code === 'HOST_DESKTOP_REQUIRED_FOR_COMMITTED_DELETE');
assert.strictEqual(db.prepare("SELECT deleted FROM questions WHERE id='q2'").get().deleted, 0);
db.prepare("INSERT INTO questions VALUES ('q3','default','local_draft',NULL,NULL,0,NULL,'t')").run();
db.prepare("INSERT INTO question_contents VALUES ('c3','q3','rollback','','','[]','h',0,'t')").run();
commitQuestionToBoundStore('q3', { db, tenantId: 'default', authz, runtime });
db.exec("CREATE TRIGGER fail_q3_delete BEFORE UPDATE OF deleted ON question_contents WHEN OLD.question_id='q3' AND NEW.deleted=1 BEGIN SELECT RAISE(ABORT,'forced rollback'); END;");
assert.throws(() => deleteCommittedQuestion('q3', { db, tenantId: 'default', authz, runtime, operationId: 'op-fail-q3' }), /forced rollback/);
assert.strictEqual(db.prepare("SELECT deleted FROM questions WHERE id='q3'").get().deleted, 0);
assert.strictEqual(db.prepare("SELECT deleted FROM question_contents WHERE id='c3'").get().deleted, 0);
assert.ok(fs.existsSync(path.join(root, 'questions', 'q3', 'question.json')), 'failed delete must restore files');
db.exec('DROP TRIGGER fail_q3_delete');
deleteCommittedQuestion('q3', { db, tenantId: 'default', authz, runtime, operationId: 'op-delete-q3' });
db.exec("CREATE TRIGGER fail_q3_restore BEFORE UPDATE OF deleted ON question_contents WHEN OLD.question_id='q3' AND NEW.deleted=0 BEGIN SELECT RAISE(ABORT,'forced restore rollback'); END;");
assert.throws(() => restoreCommittedQuestion('q3', { db, tenantId: 'default', authz, runtime }), /forced restore rollback/);
assert.strictEqual(db.prepare("SELECT deleted FROM questions WHERE id='q3'").get().deleted, 1);
assert.ok(fs.existsSync(path.join(root, '.trash', 'op-delete-q3', 'q3', 'question.json')), 'failed restore must return files to trash');
db.close();

const conflictingDb = new Database(':memory:');
ensureQuestionBankAuthoritySchema(conflictingDb);
assert.throws(() => bindQuestionBankStoreToDatabase({ db: conflictingDb, root, authz, runtime }), error => error.code === 'QUESTION_BANK_STORE_ALREADY_BOUND');
conflictingDb.close();

const db2 = new Database(':memory:');
db2.exec("CREATE TABLE questions (id TEXT PRIMARY KEY, tenant_id TEXT, storage_state TEXT, committed_at TEXT, committed_by_device_id TEXT, deleted INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT)");
ensureQuestionBankAuthoritySchema(db2);
const legacyDir = path.join(secondRoot, 'questions', 'legacy-q'); fs.mkdirSync(legacyDir, { recursive: true });
fs.writeFileSync(path.join(legacyDir, 'question.json'), JSON.stringify({ id: 'legacy-q' }), 'utf8');
db2.prepare("INSERT INTO questions VALUES ('legacy-q','default','local_draft',NULL,NULL,0,'2000-01-01T00:00:00.000Z','t')").run();
const secondBinding = bindQuestionBankStoreToDatabase({ db: db2, root: secondRoot, authz, runtime });
assert.notStrictEqual(secondBinding.dbAuthorityId, bound.dbAuthorityId, 'each database must have a distinct authority id');
assert.deepStrictEqual(migrateBoundLegacyQuestions({ db: db2, root: secondRoot, authz, runtime }), { migrated: 1, alreadyApplied: false });
assert.deepStrictEqual(migrateBoundLegacyQuestions({ db: db2, root: secondRoot, authz, runtime }), { migrated: 0, alreadyApplied: true });
assert.strictEqual(db2.prepare("SELECT storage_state FROM questions WHERE id='legacy-q'").get().storage_state, 'host_committed');
db2.close();

const linkRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-qb-link-'));
const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-qb-outside-'));
initQuestionBankStore(linkRoot, { deviceId });
let linkCreated = false;
try {
  fs.rmSync(path.join(linkRoot, 'questions'), { recursive: true, force: true });
  fs.symlinkSync(outsideRoot, path.join(linkRoot, 'questions'), process.platform === 'win32' ? 'junction' : 'dir');
  linkCreated = true;
} catch (error) { if (!['EPERM', 'EACCES'].includes(error.code)) throw error; }
if (linkCreated) {
  const linkDb = new Database(':memory:');
  ensureQuestionBankAuthoritySchema(linkDb);
  assert.throws(() => bindQuestionBankStoreToDatabase({ db: linkDb, root: linkRoot, authz, runtime }), error => error.code === 'QUESTION_BANK_REPARSE_POINT_REJECTED');
  assert.strictEqual(fs.existsSync(path.join(outsideRoot, 'escape')), false);
  linkDb.close();
}
