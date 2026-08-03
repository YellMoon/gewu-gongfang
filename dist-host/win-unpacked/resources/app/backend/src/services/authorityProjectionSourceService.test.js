const assert = require('assert');
const Database = require('better-sqlite3');
const { createAuthorityProjectionSourceService } = require('./authorityProjectionSourceService');

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE authority_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE courses (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, teacher_id TEXT,
    student_ids TEXT, price_tuition REAL, price_teacher REAL,
    deleted INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
  );
  CREATE TABLE schedules (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, teacher_id TEXT,
    student_ids TEXT, student_pricings TEXT, calculated_tuition REAL,
    calculated_teacher_fee REAL, deleted INTEGER NOT NULL DEFAULT 0,
    start_time TEXT NOT NULL
  );
  CREATE TABLE questions (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, subject TEXT, type TEXT,
    difficulty INTEGER, storage_state TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE question_contents (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, question_id TEXT NOT NULL,
    stem TEXT NOT NULL, answer TEXT, explanation TEXT, version INTEGER NOT NULL,
    options_json TEXT, rich_content_json TEXT,
    deleted INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
  );
  CREATE TABLE students (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT,
    deleted INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
  );
  CREATE TABLE grades (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, student_id TEXT,
    deleted INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
  );
  CREATE TABLE enrollments (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, student_id TEXT, schedule_id TEXT,
    deleted INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
  );
  CREATE TABLE payments (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, student_id TEXT,
    payment_date TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE consumptions (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, student_id TEXT,
    consumption_date TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE teachers (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
  );
  CREATE TABLE rooms (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
  );
  CREATE TABLE institutions (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
  );
  CREATE TABLE schools (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT,
    deleted INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE taxonomy_systems (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE taxonomy_nodes (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, system_id TEXT, name TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE asset_accounts (
    account_id TEXT PRIMARY KEY, authority_id TEXT NOT NULL, owner_user_id TEXT NOT NULL,
    account_type TEXT NOT NULL, provider TEXT, label TEXT NOT NULL,
    masked_identifier TEXT, balance REAL NOT NULL, currency TEXT NOT NULL,
    status TEXT NOT NULL
  );
  CREATE TABLE personal_asset_records (
    record_id TEXT PRIMARY KEY, authority_id TEXT NOT NULL, owner_user_id TEXT NOT NULL,
    account_id TEXT NOT NULL, record_date TEXT NOT NULL, record_type TEXT NOT NULL,
    category_id TEXT, category_name TEXT, amount REAL NOT NULL, student_id TEXT,
    student_name TEXT, note TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE personal_asset_categories (
    category_id TEXT PRIMARY KEY, authority_id TEXT NOT NULL, owner_user_id TEXT NOT NULL,
    name TEXT NOT NULL, category_type TEXT NOT NULL, color TEXT, status TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE authority_role_applications (
    application_id TEXT PRIMARY KEY, authority_id TEXT NOT NULL, user_id TEXT NOT NULL,
    requested_role TEXT NOT NULL, binding_hint TEXT, status TEXT NOT NULL,
    reviewed_by TEXT, reviewed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE authority_role_bindings (
    binding_id TEXT PRIMARY KEY, authority_id TEXT NOT NULL, user_id TEXT NOT NULL,
    role TEXT NOT NULL, subject_type TEXT, subject_id TEXT, status TEXT NOT NULL,
    grant_version INTEGER NOT NULL, granted_by TEXT, created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL, revoked_at TEXT
  );
`);
db.prepare("INSERT INTO authority_metadata VALUES('database_authority_id','authority-1')").run();
db.prepare(`INSERT INTO students VALUES
  ('student-1','default','Student 1',0,'2026-07-28T00:00:00.000Z')`).run();
db.prepare(`INSERT INTO courses VALUES
  ('course-1','default','teacher-1','["student-1"]',100,50,0,'2026-07-28T00:00:00.000Z'),
  ('course-other','other','teacher-2','[]',200,80,0,'2026-07-28T00:00:00.000Z')`).run();
db.prepare(`INSERT INTO schedules VALUES
  ('schedule-1','default','teacher-1','["student-1"]','{"student-1":100}',100,50,0,'2026-07-29T00:00:00.000Z'),
  ('schedule-deleted','default','teacher-1','["student-1"]','{}',100,50,1,'2026-07-30T00:00:00.000Z')`).run();
db.prepare(`INSERT INTO questions VALUES
  ('question-1','default','\u7269\u7406','single',3,'host_committed',0,'2026-07-28T00:00:00.000Z'),
  ('question-draft','default','\u7269\u7406','single',2,'local_draft',0,'2026-07-29T00:00:00.000Z')`).run();
db.prepare(`INSERT INTO question_contents VALUES
  ('content-old','default','question-1','\u65e7\u9898\u5e72','old answer','old explanation',1,NULL,NULL,0,'2026-07-27T00:00:00.000Z'),
  ('content-new','default','question-1','\u6700\u65b0\u9898\u5e72','secret answer','secret explanation',2,NULL,NULL,0,'2026-07-28T00:00:00.000Z')`).run();
db.prepare(`INSERT INTO asset_accounts VALUES
  ('asset-1','authority-1','user-1','saving_card','Bank','Salary card','****1234',1234,'CNY','active'),
  ('asset-other','authority-2','user-2','saving_card','Bank','Other card','****5678',999,'CNY','active')`).run();
db.prepare(`INSERT INTO personal_asset_categories VALUES
  ('category-1','authority-1','user-1','Food','expense','#123456','active',
   '2026-07-28T00:00:00.000Z','2026-07-28T00:00:00.000Z')`).run();
db.prepare(`INSERT INTO personal_asset_records VALUES
  ('record-1','authority-1','user-1','asset-1','2026-07-28','expense',
   'category-1','Food',88,NULL,NULL,'Lunch','active',
   '2026-07-28T00:00:00.000Z','2026-07-28T00:00:00.000Z')`).run();
db.prepare(`INSERT INTO authority_role_applications VALUES
  ('application-1','authority-1','visitor-1','student','student-optional','pending',
   NULL,NULL,'2026-07-28T00:00:00.000Z','2026-07-28T00:00:00.000Z'),
  ('application-other','authority-2','visitor-2','teacher',NULL,'pending',
   NULL,NULL,'2026-07-28T00:00:00.000Z','2026-07-28T00:00:00.000Z')`).run();
db.prepare(`INSERT INTO authority_role_bindings VALUES
  ('binding-1','authority-1','user-1','super_admin',NULL,NULL,'active',2,'bootstrap',
   '2026-07-28T00:00:00.000Z','2026-07-28T00:00:00.000Z',NULL),
  ('binding-other','authority-2','user-2','admin',NULL,NULL,'active',1,'bootstrap',
   '2026-07-28T00:00:00.000Z','2026-07-28T00:00:00.000Z',NULL)`).run();

const sourceService = createAuthorityProjectionSourceService({ db, tenantId: 'default' });
const source = sourceService.load({ authorityId: 'authority-1' });

assert.deepStrictEqual(source.students.map(item => item.id), ['student-1']);
assert.deepStrictEqual(source.courses.map(item => item.id), ['course-1']);
assert.deepStrictEqual(source.schedules.map(item => item.id), ['schedule-1']);
assert.deepStrictEqual(source.questionPreviews, [{
  id: 'question-1',
  type: 'single',
  subject: '\u7269\u7406',
  difficulty: 3,
  stemPreview: '\u6700\u65b0\u9898\u5e72',
}]);
assert.equal(JSON.stringify(source.questionPreviews).includes('secret answer'), false);
assert.equal(JSON.stringify(source.questionPreviews).includes('secret explanation'), false);
assert.deepStrictEqual(source.assets, [{
  id: 'asset-1',
  ownerUserId: 'user-1',
  accountType: 'saving_card',
  provider: 'Bank',
  label: 'Salary card',
  maskedIdentifier: '****1234',
  balance: 1234,
  currency: 'CNY',
}]);
assert.deepStrictEqual(source.assetRecords.map(item => item.id), ['record-1']);
assert.deepStrictEqual(source.assetCategories.map(item => item.id), ['category-1']);
assert.deepStrictEqual(source.questions.map(item => item.id), ['question-1']);
assert.deepStrictEqual(source.roleApplications.map(item => item.applicationId), ['application-1']);
assert.deepStrictEqual(source.roleGrants.map(item => item.bindingId), ['binding-1']);
assert.throws(
  () => sourceService.load({ authorityId: 'authority-2' }),
  error => error?.code === 'AUTHORITY_PROJECTION_SOURCE_AUTHORITY_MISMATCH'
);

db.close();
console.log('authorityProjectionSourceService tests passed');
