"""UTF-8: validate only exact UI-created resource/course/lesson IDs in the disposable cloud database."""
import json
import re


def read_resource_maintenance(db, ui, creator):
    keys=('institutionId','roomId','studentId','courseId','scheduleId')
    ids={key:ui.get(key) for key in keys}
    if any(not isinstance(value,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}',value) for value in [*ids.values(),creator]):
        raise ValueError('RESOURCE_MAINTENANCE_EXACT_IDS_REQUIRED')
    institution,room,student,course,lesson=(ids[key] for key in keys)
    value=json.loads(db.run(f"""SELECT jsonb_build_object(
      'institution',(SELECT jsonb_build_object('name',name,'creator',created_by_teacher_id,'deleted',legacy_deleted) FROM business.institutions WHERE id='{institution}'),
      'room',(SELECT jsonb_build_object('name',name,'address',address_legacy,'creator',created_by_teacher_id,'deleted',legacy_deleted) FROM business.rooms WHERE id='{room}'),
      'student',(SELECT jsonb_build_object('name',name,'institution',institution_id,'deleted',legacy_deleted) FROM business.students WHERE id='{student}'),
      'link',(SELECT student_id FROM business.institution_billing_students WHERE institution_id='{institution}'),
      'course',(SELECT jsonb_build_object('name',display_name,'institution',institution_id,'room',legacy_room_id,'roomName',room_name_snapshot,'teacher',teacher_id,'minutes',default_duration_minutes,'tuition',price_tuition,'fee',price_teacher,'deleted',legacy_deleted) FROM business.courses WHERE id='{course}'),
      'schedule',(SELECT jsonb_build_object('course',course_id,'roomName',room_display_snapshot,'teacher',teacher_id,'tuition',calculated_tuition,'fee',calculated_teacher_fee,'deleted',legacy_deleted) FROM business.schedules WHERE id='{lesson}'),
      'attendance',(SELECT jsonb_agg(jsonb_build_object('student',student_id,'status',attendance_status,'tuition',tuition,'fee',teacher_fee)) FROM business.schedule_student_overrides WHERE schedule_id='{lesson}')
    )"""))
    expected={
        'institution':{'name':'春禾机构改名','creator':creator,'deleted':True},
        'room':{'name':'东湖三楼','address':'东湖路三号','creator':creator,'deleted':True},
        'student':{'name':'春禾机构改名学生','institution':institution,'deleted':False},'link':student,
        'course':{'name':'初二物理','institution':institution,'room':room,'roomName':'东湖上课点','teacher':creator,'minutes':90,'tuition':180,'fee':120,'deleted':False},
        'schedule':{'course':course,'roomName':'东湖上课点','teacher':creator,'tuition':270,'fee':180,'deleted':False},
        'attendance':[{'student':student,'status':1,'tuition':180,'fee':120}],
    }
    if value!=expected: raise RuntimeError('RESOURCE_MAINTENANCE_DATABASE_READBACK_MISMATCH')
    return {'actual':value,'expected':expected,'verified':True}
