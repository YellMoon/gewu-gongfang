"""UTF-8: isolated refresh fixture; original snapshots are restored after explicit undo."""
import copy
import re
from apply_cloud_postgres_migrations import sql_literal
from business_parity_student_history import seed_student_history

def seed_course_refresh(db,target):
    if not re.fullmatch(r'gewu_ui_shadow_[a-f0-9]{16}',target) or db.run('SELECT current_database()').strip()!=target:
        raise RuntimeError('ISOLATED_SHADOW_REQUIRED')
    fixture=seed_student_history(db,target,parents_deleted=False)
    record=sql_literal(fixture['studentId'])
    commands=["BEGIN; SET LOCAL ROLE vnext_pg17_business_owner; DO $$ BEGIN IF current_database()<>"+sql_literal(target)+" THEN RAISE EXCEPTION 'ISOLATED_SHADOW_REQUIRED'; END IF; END $$;",
              "UPDATE business.courses SET billing_unit=2,teacher_fee_mode=2,price_tuition=220,price_teacher=160,room_name_snapshot='更新后上课地址' WHERE id="+record+";",
              "UPDATE business.course_student_pricings SET tuition=220,teacher_fee=160 WHERE course_id="+record+";",
              "UPDATE business.schedules SET calculated_tuition=0,calculated_teacher_fee=0,notes='原课次备注' WHERE id="+record+";",
              "UPDATE business.schedule_student_overrides SET attendance_status=4 WHERE schedule_id="+record+";"]
    for suffix,start,end in [('early','2026-09-07T15:00:00Z','2026-09-07T15:30:00Z'),('late','2026-09-08T15:00:00Z','2026-09-08T15:30:00Z'),('next','2026-09-09T01:00:00Z','2026-09-09T02:30:00Z')]:
        new_id=sql_literal(fixture['studentId']+'-'+suffix)
        commands.append("INSERT INTO business.schedules SELECT (jsonb_populate_record(NULL::business.schedules,to_jsonb(s)||jsonb_build_object('id',"+new_id+",'start_at',"+sql_literal(start)+",'end_at',"+sql_literal(end)+"))).* FROM business.schedules s WHERE id="+record+";")
        commands.append("INSERT INTO business.schedule_student_overrides(tenant_id,schedule_id,student_id,attendance_status,tuition,teacher_fee) SELECT tenant_id,"+new_id+",student_id,attendance_status,tuition,teacher_fee FROM business.schedule_student_overrides WHERE schedule_id="+record+";")
    db.run(' '.join(commands)+" COMMIT;")
    return {**fixture,'refreshIds':[fixture['studentId'],fixture['studentId']+'-late'],'outsideIds':[fixture['studentId']+'-early',fixture['studentId']+'-next']}

def verify_course_refresh_history(before,after,ids):
    original={row['id']:row for row in before['schedules']}
    final={row['id']:row for row in after['schedules']}
    if not ids or len(ids)!=len(set(ids)) or not set(ids)<=set(original) or set(final)!=set(original):
        raise RuntimeError('REFRESH_HISTORY_TARGETS_INVALID')
    expected=copy.deepcopy(before)
    for row in expected['schedules']:
        if row['id'] in ids:
            version=final[row['id']].get('updated_at')
            if not version or version==row.get('updated_at'):raise RuntimeError('REFRESH_HISTORY_VERSION_UNCHANGED')
            row['updated_at']=version
    if after!=expected:raise RuntimeError('REFRESH_HISTORY_DRIFT')
    return {'undoRestoredOriginalSnapshots':True,'outsideRangeUnchanged':True,'courseDefaultsUnchanged':True,'originalRosterAndRatesRetained':True,'ledgersUnchanged':True}
