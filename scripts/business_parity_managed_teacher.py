"""UTF-8: read back only the exact UI-created records in the disposable cloud database."""
import json
import re


def read_managed_teacher(db, ui, creator):
    ids = {key: ui.get(key, '') for key in ('teacherId', 'studentId', 'courseId', 'scheduleId')}
    for value in ids.values():
        if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', value):
            raise ValueError('MANAGED_TEACHER_EXACT_IDS_REQUIRED')
    # Existing cloud profile identifiers are opaque IDs, not necessarily UUIDs; never interpolate this into SQL.
    if not isinstance(creator, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', creator):
        raise ValueError('MANAGED_TEACHER_CREATOR_REQUIRED')
    teacher, student, course, lesson = (ids[key] for key in ('teacherId', 'studentId', 'courseId', 'scheduleId'))
    value = json.loads(db.run(f"""SELECT jsonb_build_object(
      'teacher',(SELECT jsonb_build_object('id',t.id,'name',t.name,'creator',t.created_by_teacher_id,'claimed',t.account_claimed,'rate',t.hourly_rate) FROM business.teachers t WHERE t.id='{teacher}' AND t.legacy_deleted=false),
      'student',(SELECT jsonb_build_object('id',s.id,'name',s.name,'school',s.school_legacy) FROM business.students s WHERE s.id='{student}' AND s.legacy_deleted=false),
      'course',(SELECT jsonb_build_object('id',c.id,'teacher',c.teacher_id,'name',c.display_name,'minutes',c.default_duration_minutes,'room',c.room_name_snapshot,'tuition',c.price_tuition,'fee',c.price_teacher) FROM business.courses c WHERE c.id='{course}' AND c.legacy_deleted=false),
      'schedule',(SELECT jsonb_build_object('id',s.id,'course',s.course_id,'teacher',s.teacher_id,'tuition',s.calculated_tuition,'fee',s.calculated_teacher_fee) FROM business.schedules s WHERE s.id='{lesson}' AND s.legacy_deleted=false),
      'pricings',(SELECT jsonb_agg(jsonb_build_object('student',p.student_id,'tuition',p.tuition,'fee',p.teacher_fee)) FROM business.course_student_pricings p WHERE p.course_id='{course}'),
      'attendance',(SELECT jsonb_agg(jsonb_build_object('student',o.student_id,'status',o.attendance_status,'tuition',o.tuition,'fee',o.teacher_fee)) FROM business.schedule_student_overrides o WHERE o.schedule_id='{lesson}'),
      'grants',(SELECT count(*) FROM business.miniapp_cloud_role_grants WHERE profile_type='teacher' AND profile_id='{teacher}')
    )"""))
    expected = {
        'teacher': {'id': teacher, 'name': '周启明', 'creator': creator, 'claimed': False, 'rate': 120},
        'student': {'id': student, 'name': '林小禾', 'school': '春禾中学'},
        'course': {'id': course, 'teacher': teacher, 'name': '初二物理', 'minutes': 90, 'room': '东湖上课点', 'tuition': 180, 'fee': 120},
        'schedule': {'id': lesson, 'course': course, 'teacher': teacher, 'tuition': 270, 'fee': 180},
        'pricings': [{'student': student, 'tuition': 180, 'fee': 120}],
        'attendance': [{'student': student, 'status': 1, 'tuition': 180, 'fee': 120}],
        'grants': 0,
    }
    if value != expected:
        raise RuntimeError('MANAGED_TEACHER_DATABASE_READBACK_MISMATCH')
    return {'actual': value, 'expected': expected, 'verified': True}
