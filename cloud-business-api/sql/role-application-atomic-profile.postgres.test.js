'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createDisposablePg17Runtime, withVNextPg17SyntheticQuery } = require('../../shared/vnext-pg17/disposableRuntime');

const sql = name => fs.readFileSync(path.join(__dirname, name), 'utf8');
const BASE_SQL = sql('20260826-cloud-role-applications.sql');
const LEAST_PRIVILEGE_SQL = sql('20260826-zz-role-application-least-privilege.sql');
const NEW_PROFILE_MODE_SQL = sql('20260826-zzz-role-application-new-profile-mode.sql');
const ATOMIC_PROFILE_SQL = sql('20260901-role-application-atomic-profile.sql');
const FAMILY_MEMBER_CANONICAL_ROLE_SQL = sql('20260901-zz-family-member-canonical-role.sql');
const hash = character => character.repeat(64);

(async () => {
  const runtime = createDisposablePg17Runtime();
  await runtime.start();
  const handle = await runtime.createIsolatedHandle();
  try {
    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
      await facade.query('CREATE SCHEMA business AUTHORIZATION vnext_pg17_business_owner');
      await facade.query('GRANT USAGE ON SCHEMA business TO vnext_pg17_writer');
      await facade.query('SET ROLE vnext_pg17_business_owner');
      await facade.query('CREATE TABLE business.miniapp_cloud_accounts (account_id text PRIMARY KEY,phone_hmac char(64) NOT NULL UNIQUE,status text NOT NULL)');
      await facade.query('CREATE TABLE business.miniapp_cloud_role_grants (account_id text NOT NULL,role text NOT NULL,status text NOT NULL,profile_type text NULL,profile_id text NULL,student_relationship text NULL,updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),PRIMARY KEY(account_id,role))');
      await facade.query('CREATE TABLE business.teachers (id text PRIMARY KEY,tenant_id text NOT NULL,name text NOT NULL,phone_legacy text NULL,subject text NULL,hourly_rate numeric NULL,notes text NULL,legacy_deleted boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),updated_at timestamptz NOT NULL DEFAULT transaction_timestamp())');
      await facade.query('CREATE TABLE business.students (id text PRIMARY KEY,tenant_id text NOT NULL,name text NOT NULL,phone_legacy text NULL,legacy_is_institution_student boolean NOT NULL DEFAULT false,legacy_deleted boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),updated_at timestamptz NOT NULL DEFAULT transaction_timestamp())');
      await facade.query("CREATE TABLE business.student_contact_directory (contact_id text PRIMARY KEY,student_id text NOT NULL REFERENCES business.students(id),contact_slot smallint NOT NULL,relationship text NOT NULL,phone_value text NOT NULL,phone_hmac char(64) NULL,wechat_handle text NULL,status text NOT NULL,created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),UNIQUE(student_id,contact_slot))");
      await facade.query("CREATE FUNCTION business.miniapp_cloud_role_grant_profile_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$");
      await facade.query("CREATE FUNCTION business.miniapp_cloud_student_access_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$");
      await facade.query(BASE_SQL);
      await facade.query(LEAST_PRIVILEGE_SQL);
      await facade.query(NEW_PROFILE_MODE_SQL);
      await facade.query(ATOMIC_PROFILE_SQL);
      const accounts = [
        ['account-super-admin', hash('0')], ['account-existing', hash('a')], ['account-new-teacher', hash('b')],
        ['account-new-student', hash('c')], ['account-family', hash('d')], ['account-name-conflict', hash('e')],
        ['account-phone-conflict', hash('f')], ['account-id-conflict', hash('1')], ['account-rollback', hash('2')],
        ['account-family-invalid', hash('3')], ['account-family-v4', hash('4')],
      ];
      for (const [accountId, phoneHmac] of accounts) {
        await facade.query('INSERT INTO business.miniapp_cloud_accounts(account_id,phone_hmac,status) VALUES ($1,$2,\'active\')', [accountId, phoneHmac]);
      }
      await facade.query("INSERT INTO business.miniapp_cloud_role_grants(account_id,role,status,profile_type,profile_id) VALUES ('account-super-admin','super_admin','active',NULL,NULL)");
      await facade.query("INSERT INTO business.teachers(id,tenant_id,name,phone_legacy) VALUES ('teacher-existing','tenant-1','Existing Teacher','13800000000'),('teacher-phone-conflict','tenant-1','Phone Owner','13800000005'),('teacher-id-conflict','tenant-1','Id Owner','13800000009')");
      await facade.query("INSERT INTO business.students(id,tenant_id,name,phone_legacy) VALUES ('student-existing','tenant-1','Existing Student','13800000003')");
      await facade.query("INSERT INTO business.student_contact_directory(contact_id,student_id,contact_slot,relationship,phone_value,phone_hmac,status) VALUES ('student-existing-self','student-existing',1,'student','13800000003',$1,'active'),('student-existing-guardian','student-existing',2,'guardian','13800000004',$2,'active'),('student-existing-guardian-v4','student-existing',3,'guardian','13800000010',$3,'active')", [hash('3'), hash('d'), hash('4')]);
      await facade.query(`CREATE FUNCTION business.test_role_grant_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.account_id='account-rollback' THEN RAISE EXCEPTION 'TEST_GRANT_FAILURE' USING ERRCODE='P0001'; END IF;
        RETURN NEW; END; $$`);
      await facade.query('CREATE TRIGGER test_role_grant_failure BEFORE INSERT OR UPDATE ON business.miniapp_cloud_role_grants FOR EACH ROW EXECUTE FUNCTION business.test_role_grant_failure()');
      await facade.query(`CREATE FUNCTION business.test_role_state(p_profile_id text,p_account_id text,p_application_id text) RETURNS jsonb
        LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$ SELECT jsonb_build_object(
          'teacherCount',(SELECT count(*)::int FROM business.teachers WHERE id=p_profile_id),
          'studentCount',(SELECT count(*)::int FROM business.students WHERE id=p_profile_id),
          'contactRelationship',(SELECT relationship FROM business.student_contact_directory WHERE student_id=p_profile_id ORDER BY contact_slot LIMIT 1),
          'contactPhoneHmac',(SELECT phone_hmac::text FROM business.student_contact_directory WHERE student_id=p_profile_id ORDER BY contact_slot LIMIT 1),
          'grantRole',(SELECT role FROM business.miniapp_cloud_role_grants WHERE account_id=p_account_id AND status='active'),
          'grantRelationship',(SELECT student_relationship FROM business.miniapp_cloud_role_grants WHERE account_id=p_account_id AND status='active'),
          'applicationStatus',(SELECT status FROM business.cloud_role_applications WHERE application_id=p_application_id)
        ) $$`);
      await facade.query('REVOKE EXECUTE ON FUNCTION business.test_role_state(text,text,text) FROM PUBLIC');
      await facade.query('GRANT EXECUTE ON FUNCTION business.test_role_state(text,text,text) TO vnext_pg17_identity_verifier');
      await facade.query('RESET ROLE');
    });

    await withVNextPg17SyntheticQuery(handle, 'writer', async facade => {
      await assert.rejects(
        () => facade.query('SELECT * FROM business.vnext_submit_cloud_role_application_v3($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,transaction_timestamp())', ['tenant-1', 'account-new-teacher', 'denied', 'denied', 'teacher', 'new', 'Denied', '13800000001', hash('b'), 'denied-profile']),
        error => error?.code === '42501',
      );
    });

    await withVNextPg17SyntheticQuery(handle, 'identity-verifier', async facade => {
      await assert.rejects(
        () => facade.query('SELECT * FROM business.vnext_submit_cloud_role_application_v3($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,transaction_timestamp())', ['tenant-1', 'account-new-teacher', 'wrong-phone', 'wrong-phone', 'teacher', 'new', 'Wrong Phone', '13800000001', hash('f'), 'wrong-phone-profile']),
        error => error?.message === 'VNEXT_ROLE_APPLICATION_VERIFIED_PHONE_REQUIRED',
      );

      await facade.query('SELECT * FROM business.vnext_submit_cloud_role_application_v3($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,transaction_timestamp())', ['tenant-1', 'account-existing', 'application-existing', 'key-existing', 'teacher', 'existing', 'Existing Teacher', '13800000000', hash('a'), null]);
      const existingTeacher = await facade.query("SELECT * FROM business.vnext_review_cloud_role_application_v3('tenant-1','account-super-admin','application-existing','approved',NULL,transaction_timestamp())");
      assert.strictEqual(existingTeacher.rows[0].profile_id, 'teacher-existing', 'existing profiles must resolve from name and verified phone without an internal id input');

      const teacherSubmit = ['tenant-1', 'account-new-teacher', 'application-new-teacher', 'key-new-teacher', 'teacher', 'new', 'New Teacher', '13800000001', hash('b'), 'teacher-new-1'];
      const submitted = await facade.query('SELECT * FROM business.vnext_submit_cloud_role_application_v3($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,transaction_timestamp())', teacherSubmit);
      assert.strictEqual(submitted.rows[0].status, 'submitted');
      const retried = await facade.query('SELECT * FROM business.vnext_submit_cloud_role_application_v3($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,transaction_timestamp())', ['tenant-1', 'account-new-teacher', 'different-application', 'key-new-teacher', 'teacher', 'new', 'New Teacher', '13800000001', hash('b'), 'different-profile']);
      assert.strictEqual(retried.rows[0].application_id, 'application-new-teacher');
      await assert.rejects(
        () => facade.query('SELECT * FROM business.vnext_submit_cloud_role_application_v3($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,transaction_timestamp())', ['tenant-1', 'account-new-teacher', 'different-application', 'key-new-teacher', 'teacher', 'new', 'Changed Name', '13800000001', hash('b'), 'different-profile']),
        error => error?.message === 'VNEXT_ROLE_APPLICATION_IDEMPOTENCY_CONFLICT',
      );
      const approvedTeacher = await facade.query("SELECT * FROM business.vnext_review_cloud_role_application_v3('tenant-1','account-super-admin','application-new-teacher','approved',NULL,transaction_timestamp())");
      assert.strictEqual(approvedTeacher.rows[0].profile_id, 'teacher-new-1');
      const repeatedApproval = await facade.query("SELECT * FROM business.vnext_review_cloud_role_application_v3('tenant-1','account-super-admin','application-new-teacher','approved',NULL,transaction_timestamp())");
      assert.strictEqual(repeatedApproval.rows[0].profile_id, 'teacher-new-1');
      const teacherState = await facade.query("SELECT business.test_role_state('teacher-new-1','account-new-teacher','application-new-teacher') AS state");
      assert.strictEqual(teacherState.rows[0].state.teacherCount, 1);

      await facade.query('SELECT * FROM business.vnext_submit_cloud_role_application_v3($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,transaction_timestamp())', ['tenant-1', 'account-new-student', 'application-new-student', 'key-new-student', 'student', 'new', 'New Student', '13800000002', hash('c'), 'student-new-1']);
      const approvedStudent = await facade.query("SELECT * FROM business.vnext_review_cloud_role_application_v3('tenant-1','account-super-admin','application-new-student','approved',NULL,transaction_timestamp())");
      assert.strictEqual(approvedStudent.rows[0].profile_id, 'student-new-1');
      const studentState = await facade.query("SELECT business.test_role_state('student-new-1','account-new-student','application-new-student') AS state");
      assert.strictEqual(studentState.rows[0].state.contactRelationship, 'student');
      assert.strictEqual(studentState.rows[0].state.contactPhoneHmac, hash('c'));

      await facade.query('SELECT * FROM business.vnext_submit_cloud_role_application_v3($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,transaction_timestamp())', ['tenant-1', 'account-family', 'application-family', 'key-family', 'family_member', 'existing', 'Existing Student', '13800000004', hash('d'), null]);
      const family = await facade.query("SELECT * FROM business.vnext_review_cloud_role_application_v3('tenant-1','account-super-admin','application-family','approved',NULL,transaction_timestamp())");
      assert.strictEqual(family.rows[0].profile_id, 'student-existing');
      const familyState = await facade.query("SELECT business.test_role_state('student-existing','account-family','application-family') AS state");
      assert.strictEqual(familyState.rows[0].state.grantRole, 'student');
      assert.strictEqual(familyState.rows[0].state.grantRelationship, 'guardian');

      await facade.query('SELECT * FROM business.vnext_submit_cloud_role_application_v3($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,transaction_timestamp())', ['tenant-1', 'account-name-conflict', 'application-name-conflict', 'key-name-conflict', 'teacher', 'new', 'New Teacher', '13800000006', hash('e'), 'teacher-name-conflict']);
      await assert.rejects(
        () => facade.query("SELECT * FROM business.vnext_review_cloud_role_application_v3('tenant-1','account-super-admin','application-name-conflict','approved',NULL,transaction_timestamp())"),
        error => error?.message === 'VNEXT_ROLE_APPLICATION_PROFILE_NAME_CONFLICT',
      );
      await facade.query('SELECT * FROM business.vnext_submit_cloud_role_application_v3($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,transaction_timestamp())', ['tenant-1', 'account-phone-conflict', 'application-phone-conflict', 'key-phone-conflict', 'teacher', 'new', 'Other Teacher', '13800000005', hash('f'), 'teacher-phone-new']);
      await assert.rejects(
        () => facade.query("SELECT * FROM business.vnext_review_cloud_role_application_v3('tenant-1','account-super-admin','application-phone-conflict','approved',NULL,transaction_timestamp())"),
        error => error?.message === 'VNEXT_ROLE_APPLICATION_PROFILE_PHONE_CONFLICT',
      );
      await facade.query('SELECT * FROM business.vnext_submit_cloud_role_application_v3($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,transaction_timestamp())', ['tenant-1', 'account-id-conflict', 'application-id-conflict', 'key-id-conflict', 'teacher', 'new', 'Other Id', '13800000007', hash('1'), 'teacher-id-conflict']);
      await assert.rejects(
        () => facade.query("SELECT * FROM business.vnext_review_cloud_role_application_v3('tenant-1','account-super-admin','application-id-conflict','approved',NULL,transaction_timestamp())"),
        error => error?.message === 'VNEXT_ROLE_APPLICATION_PROFILE_ID_CONFLICT',
      );

      await facade.query('SELECT * FROM business.vnext_submit_cloud_role_application_v3($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,transaction_timestamp())', ['tenant-1', 'account-rollback', 'application-rollback', 'key-rollback', 'teacher', 'new', 'Rollback Teacher', '13800000008', hash('2'), 'teacher-rollback']);
      await assert.rejects(
        () => facade.query("SELECT * FROM business.vnext_review_cloud_role_application_v3('tenant-1','account-super-admin','application-rollback','approved',NULL,transaction_timestamp())"),
        error => error?.message === 'TEST_GRANT_FAILURE',
      );
      const rollbackState = await facade.query("SELECT business.test_role_state('teacher-rollback','account-rollback','application-rollback') AS state");
      assert.strictEqual(rollbackState.rows[0].state.teacherCount, 0);
      assert.strictEqual(rollbackState.rows[0].state.applicationStatus, 'submitted');

      await facade.query('SELECT * FROM business.vnext_submit_cloud_role_application_v3($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,transaction_timestamp())', ['tenant-1', 'account-family-invalid', 'application-family-invalid', 'key-family-invalid', 'family_member', 'existing', 'Existing Student', '13800000003', hash('3'), null]);
      await assert.rejects(
        () => facade.query("SELECT * FROM business.vnext_review_cloud_role_application_v3('tenant-1','account-super-admin','application-family-invalid','approved',NULL,transaction_timestamp())"),
        error => error?.message === 'VNEXT_ROLE_APPLICATION_GUARDIAN_RELATION_REQUIRED',
      );
    });

    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
      await facade.query(FAMILY_MEMBER_CANONICAL_ROLE_SQL);
      const migrated = await facade.query("SELECT role,profile_type,student_relationship FROM business.miniapp_cloud_role_grants WHERE account_id='account-family'");
      assert.deepStrictEqual(migrated.rows[0], { role: 'family_member', profile_type: 'student', student_relationship: 'guardian' });
    });
    await withVNextPg17SyntheticQuery(handle, 'identity-verifier', async facade => {
      await facade.query('SELECT * FROM business.vnext_submit_cloud_role_application_v3($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,transaction_timestamp())', ['tenant-1', 'account-family-v4', 'application-family-v4', 'key-family-v4', 'family_member', 'existing', 'Existing Student', '13800000010', hash('4'), null]);
      const familyV4 = await facade.query("SELECT * FROM business.vnext_review_cloud_role_application_v4('tenant-1','account-super-admin','application-family-v4','approved',NULL,transaction_timestamp())");
      assert.strictEqual(familyV4.rows[0].profile_id, 'student-existing');
      const familyV4State = await facade.query("SELECT business.test_role_state('student-existing','account-family-v4','application-family-v4') AS state");
      assert.strictEqual(familyV4State.rows[0].state.grantRole, 'family_member');
      assert.strictEqual(familyV4State.rows[0].state.grantRelationship, 'guardian');
    });
  } finally {
    await runtime.disposeHandle(handle).catch(() => {});
    await runtime.stop().catch(() => {});
  }
  console.log('role application atomic profile PostgreSQL checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
