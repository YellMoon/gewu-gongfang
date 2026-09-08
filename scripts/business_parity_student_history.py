# -*- coding: utf-8 -*-
"""UTF-8: disposable references and exact post-delete history verification."""
import json
import copy
from apply_cloud_postgres_migrations import sql_literal
from business_parity_student_balance import seed_student_balance


def seed_student_history(db, target, parents_deleted=True):
    if type(parents_deleted) is not bool:
        raise ValueError('STUDENT_REFERENCE_STATE_INVALID')
    fixture = seed_student_balance(db, target)
    q = sql_literal
    student = q(fixture['studentId'])
    archived = 'true' if parents_deleted else 'false'
    db.run("BEGIN; SET LOCAL ROLE vnext_pg17_business_owner; DO $$ BEGIN IF current_database()<>" + q(target) +
           " THEN RAISE EXCEPTION 'ISOLATED_SHADOW_REQUIRED'; END IF; END $$; " +
           "INSERT INTO business.courses(id,tenant_id,name,display_name,course_type,legacy_source_type,price_tuition,price_teacher,billing_unit,teacher_fee_mode,teacher_id,room_name_snapshot,legacy_active,legacy_deleted,created_at,updated_at) SELECT id,tenant_id,'历史课程核验','历史课程核验',1,1,180,120,1,1,created_by_teacher_id,'原上课地址',true," + archived + ",now(),now() FROM business.students WHERE id=" + student + "; " +
           "INSERT INTO business.course_student_pricings(tenant_id,course_id,student_id,tuition,teacher_fee) SELECT tenant_id,id,id,180,120 FROM business.students WHERE id=" + student + "; " +
           "INSERT INTO business.schedules(id,tenant_id,course_id,start_at,end_at,status,calculated_tuition,calculated_teacher_fee,billing_unit,teacher_fee_mode,teacher_id,room_display_snapshot,legacy_deleted,created_at,updated_at) SELECT id,tenant_id,id,'2026-09-08T01:00:00Z'::timestamptz,'2026-09-08T02:30:00Z'::timestamptz,1,270,180,1,1,created_by_teacher_id,'原上课地址'," + archived + ",now(),now() FROM business.students WHERE id=" + student + "; " +
           "INSERT INTO business.schedule_student_overrides(tenant_id,schedule_id,student_id,attendance_status,tuition,teacher_fee) SELECT tenant_id,id,id,1,180,120 FROM business.students WHERE id=" + student + "; COMMIT;")
    return {**fixture, 'parentsDeleted': parents_deleted}


def read_student_history(db, fixture):
    student = sql_literal(fixture['studentId'])
    fields = ["'student',(SELECT to_jsonb(s) FROM business.students s WHERE id=" + student + ')']
    for table, key in [('courses', 'id'), ('schedules', 'id'), ('course_student_pricings', 'student_id'),
                       ('schedule_student_overrides', 'student_id'), ('payments', 'student_id'), ('consumptions', 'student_id')]:
        fields.append(sql_literal(table) + ",COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text) FROM business." + table + ' r WHERE ' + key + '=' + student + "),'[]'::jsonb)")
    return json.loads(db.run('SELECT jsonb_build_object(' + ','.join(fields) + ')').strip())


def verify_student_history(before, after, parents_deleted=True):
    if not before.get('student') or before['student'].get('legacy_deleted') is not False:
        raise RuntimeError('STUDENT_HISTORY_BASELINE_INVALID')
    if not after.get('student') or after['student'].get('legacy_deleted') is not True:
        raise RuntimeError('STUDENT_DELETE_NOT_PERSISTED')
    version = after['student'].get('updated_at')
    if not version or version == before['student'].get('updated_at'):
        raise RuntimeError('STUDENT_DELETE_VERSION_UNCHANGED')
    expected = {**before, 'student': {**before['student'], 'legacy_deleted': True, 'updated_at': version}}
    if after != expected:
        raise RuntimeError('STUDENT_DELETE_HISTORY_CHANGED')
    for key, count in [('courses', 1), ('schedules', 1), ('course_student_pricings', 1), ('schedule_student_overrides', 1), ('payments', 2), ('consumptions', 1)]:
        if len(before.get(key, [])) != count:
            raise RuntimeError('STUDENT_HISTORY_BASELINE_INVALID')
    if any(before[key][0].get('legacy_deleted') is not parents_deleted for key in ('courses', 'schedules')):
        raise RuntimeError('STUDENT_HISTORY_BASELINE_INVALID')
    return {'studentSoftDeleted': True, 'historicalRecordsUnchanged': True, 'versionChanged': True, 'referencesArchived': parents_deleted}


def verify_course_history(before, after):
    for key, count in [('courses', 1), ('schedules', 1), ('course_student_pricings', 1), ('schedule_student_overrides', 1), ('payments', 2), ('consumptions', 1)]:
        if len(before.get(key, [])) != count:
            raise RuntimeError('COURSE_HISTORY_BASELINE_INVALID')
    if before['courses'][0].get('legacy_deleted') is not False or before['schedules'][0].get('legacy_deleted') is not False:
        raise RuntimeError('COURSE_HISTORY_BASELINE_INVALID')
    if len(after.get('courses', [])) != 1 or after['courses'][0].get('legacy_deleted') is not True:
        raise RuntimeError('COURSE_DELETE_NOT_PERSISTED')
    version = after['courses'][0].get('updated_at')
    if not version or version == before['courses'][0].get('updated_at'):
        raise RuntimeError('COURSE_DELETE_VERSION_UNCHANGED')
    expected = copy.deepcopy(before)
    expected['courses'][0].update(legacy_deleted=True, updated_at=version)
    if after != expected:
        raise RuntimeError('COURSE_DELETE_HISTORY_CHANGED')
    return {'courseSoftDeleted': True, 'historicalRecordsUnchanged': True, 'versionChanged': True, 'lessonsStillActive': True}
