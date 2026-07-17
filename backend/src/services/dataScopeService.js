'use strict';

function array(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch (_) {
    return value.split(',').map(x => x.trim()).filter(Boolean);
  }
}
const value = (row, ...keys) => keys.map(key => row?.[key]).find(x => x !== undefined && x !== null);
const id = row => value(row, 'id');
const active = row => !row?.deleted_at && !row?.deletedAt && row?.deleted !== true && row?.is_deleted !== 1 && row?.isDeleted !== true;
const ids = rows => new Set(rows.map(id).filter(Boolean).map(String));
const inSet = (set, candidate) => candidate !== undefined && candidate !== null && set.has(String(candidate));
const copyRows = rows => (Array.isArray(rows) ? rows.filter(active).map(row => ({ ...row })) : []);
function pick(row, keys) { const result = {}; for (const key of keys) if (row?.[key] !== undefined) result[key] = row[key]; return result; }
const redactStudent = row => pick(row, ['id', 'name', 'school', 'grade_year', 'grade_current', 'source_type']);
const redactCourse = row => pick(row, ['id', 'name', 'display_name', 'type', 'year', 'semester', 'teacher_id', 'teacherId', 'teacher_name', 'room_id', 'room_name', 'active', 'default_duration_minutes', 'created_at', 'updated_at']);
const redactSchedule = row => pick(row, ['id', 'course_id', 'courseId', 'start_time', 'end_time', 'recurring_rule', 'status', 'room', 'room_id', 'service_type', 'created_at', 'updated_at']);
const redactTeacher = row => pick(row, ['id', 'name', 'subject']);
const redactInstitution = row => pick(row, ['id', 'name']);
const redactRoom = row => pick(row, ['id', 'name', 'display_name', 'displayName']);
const redactSchool = row => pick(row, ['id', 'name']);
const studentLinks = row => [
  ...array(value(row, 'student_ids', 'studentIds')),
  ...array(value(row, 'student_pricings', 'studentPricings')).map(item => typeof item === 'object' ? value(item, 'student_id', 'studentId') : item),
  value(row, 'student_id', 'studentId'),
].filter(Boolean).map(String);

function scopeStudent(snapshot, context) {
  const allowedStudents = new Set(array(context.studentIds || context.linkedStudentIds).map(String));
  const courses = copyRows(snapshot.courses).filter(row => studentLinks(row).some(x => allowedStudents.has(x)));
  const courseIds = ids(courses);
  const schedules = copyRows(snapshot.schedules).filter(row => inSet(courseIds, value(row, 'course_id', 'courseId')) || studentLinks(row).some(x => allowedStudents.has(x)));
  const scheduleIds = ids(schedules);
  const userId = context.userId;
  const teacherIds = new Set(courses.map(row => value(row, 'teacher_id', 'teacherId')).filter(Boolean).map(String));
  const roomIds = new Set([...courses, ...schedules].map(row => value(row, 'room_id', 'roomId')).filter(Boolean).map(String));
  const institutionIds = new Set(courses.map(row => value(row, 'institution_id', 'institutionId')).filter(Boolean).map(String));
  const scopedStudents = copyRows(snapshot.students).filter(row => inSet(allowedStudents, id(row)));
  const schoolIds = new Set(scopedStudents.map(row => value(row, 'school_id', 'schoolId')).filter(Boolean).map(String));
  return withSafePublic(snapshot, {
    redactedForRole: 'student', linkedStudentIds: [...allowedStudents],
    courses: courses.map(redactCourse), schedules: schedules.map(redactSchedule),
    students: scopedStudents.map(redactStudent),
    teachers: copyRows(snapshot.teachers).filter(row => inSet(teacherIds, id(row))).map(redactTeacher),
    rooms: copyRows(snapshot.rooms).filter(row => inSet(roomIds, id(row))).map(redactRoom),
    institutions: copyRows(snapshot.institutions).filter(row => inSet(institutionIds, id(row))).map(redactInstitution),
    schools: copyRows(snapshot.schools).filter(row => inSet(schoolIds, id(row))).map(redactSchool),
    enrollments: copyRows(snapshot.enrollments).filter(row => (inSet(scheduleIds, value(row, 'schedule_id', 'scheduleId')) || inSet(courseIds, value(row, 'course_id', 'courseId'))) && inSet(allowedStudents, value(row, 'student_id', 'studentId'))),
    consumptions: [], payments: [], assetRecords: [], assetCategories: [],
  });
}

const PUBLIC_TABLES = new Set(['subjects', 'chapters', 'knowledge_points', 'knowledgePoints', 'questions', 'question_contents', 'questionContents', 'question_assets', 'questionAssets', 'question_bank_assets', 'questionBankAssets']);
const PUBLIC_FIELDS = {
  subjects: ['id', 'name', 'code'], chapters: ['id', 'subject_id', 'name', 'sort_order'], knowledge_points: ['id', 'chapter_id', 'name', 'description'], knowledgePoints: ['id', 'chapterId', 'name', 'description'],
  questions: ['id', 'subject_id', 'chapter_id', 'type', 'difficulty', 'source', 'paper_id', 'question_number', 'status', 'created_at', 'updated_at'],
  question_contents: ['id', 'question_id', 'stem', 'answer', 'explanation', 'options_json', 'version'], questionContents: ['id', 'questionId', 'stem', 'answer', 'explanation', 'optionsJson', 'version'],
  question_assets: ['id', 'question_id', 'asset_type', 'type', 'mime_type', 'oss_url', 'url', 'data_url', 'width', 'height', 'alt', 'sort_order'], questionAssets: ['id', 'questionId', 'assetType', 'type', 'mimeType', 'ossUrl', 'url', 'dataUrl', 'width', 'height', 'alt', 'sortOrder'],
  question_bank_assets: ['id', 'question_id', 'asset_type', 'type', 'mime_type', 'oss_url', 'url', 'data_url', 'width', 'height', 'alt'], questionBankAssets: ['id', 'questionId', 'assetType', 'type', 'mimeType', 'ossUrl', 'url', 'dataUrl', 'width', 'height', 'alt'],
};
const SAFE_METADATA = new Set(['version', 'created_at', 'createdAt', 'updated_at', 'updatedAt', 'snapshotType', 'schemaVersion']);
function withSafePublic(snapshot, business) {
  const result = {};
  for (const key of SAFE_METADATA) if (snapshot[key] !== undefined && !Array.isArray(snapshot[key])) result[key] = snapshot[key];
  for (const key of PUBLIC_TABLES) if (Array.isArray(snapshot[key])) result[key] = copyRows(snapshot[key]).map(row => pick(row, PUBLIC_FIELDS[key] || ['id']));
  return Object.assign(result, business);
}

function buildScopedFinancialSnapshot(scoped = {}) {
  const sum = (rows, keys) => {
    const seen = new Set();
    return copyRows(rows).reduce((total, row, index) => {
      const key = id(row) == null ? `row:${index}` : String(id(row));
      if (seen.has(key)) return total;
      seen.add(key);
      const raw = value(row, ...keys);
      if (raw === '' || raw === null || raw === undefined) return total;
      const amount = Number(raw);
      return Number.isFinite(amount) ? total + amount : total;
    }, 0);
  };
  return {
    tuition: sum(scoped.schedules, ['calculated_tuition', 'calculatedTuition']),
    teacherFees: sum(scoped.schedules, ['calculated_teacher_fee', 'calculatedTeacherFee']),
    payments: sum(scoped.payments, ['amount', 'payment_amount', 'paymentAmount']),
    assets: sum(scoped.assetRecords, ['amount', 'value']),
  };
}

function scopeTeacher(snapshot, context) {
  const teacherId = context.teacherId;
  if (!teacherId) return {};
  const courses = copyRows(snapshot.courses).filter(row => String(value(row, 'teacher_id', 'teacherId') || '') === String(teacherId));
  const courseIds = ids(courses);
  const schedules = copyRows(snapshot.schedules).filter(row => inSet(courseIds, value(row, 'course_id', 'courseId')));
  const scheduleIds = ids(schedules);
  const enrollmentRows = copyRows(snapshot.enrollments).filter(row => inSet(courseIds, value(row, 'course_id', 'courseId')) || inSet(scheduleIds, value(row, 'schedule_id', 'scheduleId')));
  const studentIds = new Set([...courses, ...schedules, ...enrollmentRows].flatMap(studentLinks));
  const students = copyRows(snapshot.students).filter(row => inSet(studentIds, id(row)));
  const institutionIds = new Set(courses.map(row => value(row, 'institution_id', 'institutionId')).filter(Boolean).map(String));
  const roomIds = new Set([...courses, ...schedules].map(row => value(row, 'room_id', 'roomId')).filter(Boolean).map(String));
  const schoolIds = new Set(students.map(row => value(row, 'school_id', 'schoolId')).filter(Boolean).map(String));
  const result = withSafePublic(snapshot, {
    courses: courses.map(row => pick(row, ['id', 'name', 'display_name', 'type', 'year', 'semester', 'teacher_id', 'teacherId', 'institution_id', 'room_id', 'active', 'billing_unit', 'teacher_fee_mode', 'price_tuition', 'price_teacher', 'student_ids', 'student_pricings'])),
    schedules: schedules.map(row => pick(row, ['id', 'course_id', 'courseId', 'start_time', 'end_time', 'status', 'room_id', 'service_type', 'student_ids', 'student_pricings', 'calculated_tuition', 'calculated_teacher_fee'])),
    students: students.map(redactStudent), enrollments: enrollmentRows,
    consumptions: copyRows(snapshot.consumptions).filter(row => inSet(scheduleIds, value(row, 'schedule_id', 'scheduleId')) || inSet(courseIds, value(row, 'course_id', 'courseId'))),
    payments: copyRows(snapshot.payments).filter(row => inSet(courseIds, value(row, 'course_id', 'courseId')) || inSet(scheduleIds, value(row, 'schedule_id', 'scheduleId'))),
    institutions: copyRows(snapshot.institutions).filter(row => inSet(institutionIds, id(row))).map(redactInstitution),
    rooms: copyRows(snapshot.rooms).filter(row => inSet(roomIds, id(row))).map(redactRoom),
    schools: copyRows(snapshot.schools).filter(row => inSet(schoolIds, id(row))).map(redactSchool),
    teachers: copyRows(snapshot.teachers).filter(row => String(id(row)) === String(teacherId)).map(redactTeacher),
    assetRecords: copyRows(snapshot.assetRecords || snapshot.asset_records).filter(row => String(value(row, 'owner_user_id', 'ownerUserId') || '') === String(context.userId || '')),
    assetCategories: copyRows(snapshot.assetCategories || snapshot.asset_categories),
  });
  result.scopedFinancials = buildScopedFinancialSnapshot(result);
  return result;
}

function scopeBusinessSnapshot(snapshot = {}, context = {}) {
  if (context.kind === 'admin' || context.kind === 'all') return { ...snapshot, ...Object.fromEntries(Object.entries(snapshot).map(([k, v]) => [k, Array.isArray(v) ? v.map(x => ({ ...x })) : v])) };
  if (context.kind === 'teacher') return scopeTeacher(snapshot, context);
  if (context.kind === 'student') return scopeStudent(snapshot, context);
  return {};
}

function scopeError(code, message) { const error = new Error(message); error.code = code; return error; }
function assertRecordReadable(table, record, context, lookup = {}) {
  if (context.kind === 'admin' || context.kind === 'all') return true;
  if (context.kind !== 'teacher') throw scopeError('DATA_SCOPE_UNRESOLVED', `scope unresolved for ${table}`);
  if (table === 'courses') {
    if (String(value(record, 'teacher_id', 'teacherId') || '') === String(context.teacherId)) return true;
    throw scopeError('TEACHER_SCOPE_VIOLATION', 'course belongs to another teacher');
  }
  if (['schedules', 'enrollments', 'consumptions', 'payments'].includes(table)) {
    let courseId = value(record, 'course_id', 'courseId');
    const scheduleId = value(record, 'schedule_id', 'scheduleId');
    if (scheduleId) {
      const schedule = (lookup.schedules || []).find(row => String(id(row)) === String(scheduleId));
      if (!schedule) throw scopeError('DATA_SCOPE_UNRESOLVED', `schedule ownership unresolved for ${table}`);
      const scheduleCourseId = value(schedule, 'course_id', 'courseId');
      if (courseId && String(courseId) !== String(scheduleCourseId)) throw scopeError('TEACHER_SCOPE_VIOLATION', 'record course conflicts with schedule course');
      courseId = scheduleCourseId;
    }
    const course = (lookup.courses || []).find(row => String(id(row)) === String(courseId));
    if (!course) throw scopeError('DATA_SCOPE_UNRESOLVED', `course ownership unresolved for ${table}`);
    return assertRecordReadable('courses', course, context, lookup);
  }
  if (['assetRecords', 'asset_records'].includes(table)) {
    const owner = value(record, 'owner_user_id', 'ownerUserId');
    if (!owner) throw scopeError('DATA_SCOPE_UNRESOLVED', 'asset owner unresolved');
    if (String(owner) === String(context.userId)) return true;
    throw scopeError('TEACHER_SCOPE_VIOLATION', 'asset belongs to another user');
  }
  if (['questions', 'subjects', 'chapters', 'knowledge_points', 'question_assets'].includes(table)) return true;
  throw scopeError('DATA_SCOPE_UNRESOLVED', `scope unresolved for ${table}`);
}
function assertRecordWritable(table, record, context, lookup = {}) { return assertRecordReadable(table, record, context, lookup); }

module.exports = { scopeBusinessSnapshot, buildScopedFinancialSnapshot, assertRecordReadable, assertRecordWritable };
