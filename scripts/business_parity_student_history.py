# -*- coding: utf-8 -*-
"""UTF-8: disposable references and exact post-delete history verification."""
import json
import copy
import re
from datetime import datetime
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
           "INSERT INTO business.schedules(id,tenant_id,course_id,start_at,end_at,status,calculated_tuition,calculated_teacher_fee,billing_unit,teacher_fee_mode,teacher_id,teacher_name,service_type,room_display_snapshot,legacy_deleted,created_at,updated_at) SELECT id,tenant_id,id,'2026-09-08T01:00:00Z'::timestamptz,'2026-09-08T02:30:00Z'::timestamptz,1,270,180,1,1,created_by_teacher_id,(SELECT t.name FROM business.teachers t WHERE t.tenant_id=business.students.tenant_id AND t.id=created_by_teacher_id),1,'原上课地址'," + archived + ",now(),now() FROM business.students WHERE id=" + student + "; " +
           "INSERT INTO business.schedule_student_overrides(tenant_id,schedule_id,student_id,attendance_status,tuition,teacher_fee) SELECT tenant_id,id,id,1,180,120 FROM business.students WHERE id=" + student + "; COMMIT;")
    return {**fixture, 'parentsDeleted': parents_deleted}


def read_student_history(db, fixture, include_course_copies=False):
    student = sql_literal(fixture['studentId'])
    fields = ["'student',(SELECT to_jsonb(s) FROM business.students s WHERE id=" + student + ')']
    for table, key in [('courses', 'id'), ('schedules', 'id'), ('course_student_pricings', 'student_id'),
                       ('schedule_student_overrides', 'student_id'), ('payments', 'student_id'), ('consumptions', 'student_id')]:
        if include_course_copies and table == 'schedules': key = 'course_id'
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


def verify_retained_course_actions(before, after, copy_id, student_deleted=False):
    if not isinstance(copy_id,str) or not re.fullmatch(r'[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}',copy_id):
        raise RuntimeError('RETAINED_COURSE_COPY_ID_INVALID')
    other = copy.deepcopy(after)
    for key in ('schedules','schedule_student_overrides'): other[key] = before[key]
    if student_deleted: verify_student_history(before,other,parents_deleted=False)
    else: verify_course_history(before,other)
    if len(after.get('schedules',[])) != 2 or len(after.get('schedule_student_overrides',[])) != 2:
        raise RuntimeError('RETAINED_COURSE_ACTION_ROWS_INVALID')
    original = before['schedules'][0]
    if copy_id == original['id']: raise RuntimeError('RETAINED_COURSE_COPY_ID_INVALID')
    for record_id, day, deleted in [(original['id'],'09',False),(copy_id,'10',True)]:
        rows = [row for row in after['schedules'] if row['id']==record_id]
        if len(rows)!=1: raise RuntimeError('RETAINED_COURSE_ACTION_ROWS_INVALID')
        row=rows[0]
        if not row.get('updated_at') or row['updated_at']==original['updated_at']:
            raise RuntimeError('RETAINED_COURSE_ACTION_VERSION_INVALID')
        for field,hour in [('start_at','01'),('end_at','03')]:
            if datetime.fromisoformat(row[field]) != datetime.fromisoformat('2026-09-'+day+'T'+hour+':00:00+00:00'):
                raise RuntimeError('RETAINED_COURSE_ACTION_TIME_INVALID')
        expected={**original,'id':record_id,'start_at':row['start_at'],'end_at':row['end_at'],
                  'calculated_tuition':360,'calculated_teacher_fee':240,'updated_at':row['updated_at'],'legacy_deleted':deleted}
        if deleted:
            if not row.get('created_at') or row['created_at']==original['created_at']:
                raise RuntimeError('RETAINED_COURSE_COPY_CREATION_INVALID')
            expected['created_at']=row['created_at']
        if row!=expected: raise RuntimeError('RETAINED_COURSE_ACTION_METADATA_CHANGED')
        roster=[p for p in after['schedule_student_overrides'] if p['schedule_id']==record_id]
        expected_roster=[{**p,'schedule_id':record_id} for p in before['schedule_student_overrides']]
        if roster!=expected_roster: raise RuntimeError('RETAINED_COURSE_ACTION_ROSTER_CHANGED')
    return {'originalMovedAndResized':True,'copyDeletedAfterUndo':True,'originalRosterAndRatesRetained':True,'ledgersUnchanged':True,**({'studentRemainsDeleted':True} if student_deleted else {})}
