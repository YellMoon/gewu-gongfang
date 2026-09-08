"""Synthetic ledger fixtures, guarded to an existing disposable UI database only."""
import re
from apply_cloud_postgres_migrations import sql_literal


def seed_student_balance(db, target):
    if not re.fullmatch(r'gewu_ui_shadow_[a-f0-9]{16}', target or ''):
        raise RuntimeError('ISOLATED_SHADOW_REQUIRED')
    if db.run('SELECT current_database()').strip() != target:
        raise RuntimeError('ISOLATED_SHADOW_REQUIRED')
    teacher = db.run("SELECT profile_id FROM business.miniapp_cloud_role_grants WHERE account_id='e2e-account-teacher-e2e-role-test-0f0cc7fdd4e0476f99166b8fd9cfca8f' AND role='teacher' AND status='active'").strip()
    if not re.fullmatch(r'[A-Za-z0-9._-]{1,128}', teacher):
        raise RuntimeError('ISOLATED_TEST_TEACHER_REQUIRED')
    prefix = 'balance-' + target[-16:]
    fixture = {'studentId': prefix, 'hiddenStudentId': prefix + '-hidden', 'name': '余额核验学生',
               'hoursPaymentId': prefix + '-hours', 'tuitionPaymentId': prefix + '-tuition',
               'consumptionId': prefix + '-consumption'}
    q = sql_literal
    db.run("BEGIN; SET LOCAL ROLE vnext_pg17_business_owner; DO $$ BEGIN IF current_database()<>" + q(target) +
           " THEN RAISE EXCEPTION 'ISOLATED_SHADOW_REQUIRED'; END IF; END $$; " +
           "INSERT INTO business.students(id,tenant_id,name,created_by_teacher_id,legacy_is_institution_student,legacy_source_type,legacy_deleted,created_at,updated_at) SELECT " +
           q(prefix) + ",tenant_id," + q(fixture['name']) + ",id,false,1,false,now(),now() FROM business.teachers WHERE id=" + q(teacher) + "; " +
           "INSERT INTO business.students(id,tenant_id,name,legacy_is_institution_student,legacy_source_type,legacy_deleted,created_at,updated_at) SELECT " +
           q(fixture['hiddenStudentId']) + ",tenant_id,'隔离范围学生',false,1,false,now(),now() FROM business.teachers WHERE id=" + q(teacher) + "; " +
           "INSERT INTO business.payments(id,tenant_id,student_id,amount,payment_type,payment_date) SELECT x.id,s.tenant_id,s.id,x.amount,x.kind,'2026-09-08'::date FROM business.students s CROSS JOIN (VALUES (" +
           q(fixture['hoursPaymentId']) + ",12,2),(" + q(fixture['tuitionPaymentId']) + ",1200,1)) x(id,amount,kind) WHERE s.id=" + q(prefix) + "; " +
           "INSERT INTO business.consumptions(id,tenant_id,student_id,schedule_id,hours,amount,consumption_date) SELECT " + q(fixture['consumptionId']) +
           ",tenant_id,id," + q(prefix + '-historical-lesson') + ",1.5,180,'2026-09-08'::date FROM business.students WHERE id=" + q(prefix) + "; COMMIT;")
    return fixture
