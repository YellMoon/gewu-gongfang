function array(value) {
  return Array.isArray(value) ? value : [];
}

function ids(value) {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch (_error) {
      // Legacy comma-separated values remain valid migration input.
    }
    return value.split(',').map(item => item.trim()).filter(Boolean);
  }
  return [];
}

function questionPreview(row = {}) {
  return {
    id: String(row.id || ''),
    type: row.type || undefined,
    subject: row.subject || undefined,
    difficulty: row.difficulty || undefined,
    stemPreview: String(row.stemPreview || row.stem || '').slice(0, 240),
  };
}

function assetProjection(row = {}) {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId || row.owner_user_id,
    accountType: row.accountType || row.account_type,
    provider: row.provider,
    label: row.label,
    maskedIdentifier: row.maskedIdentifier || row.masked_identifier,
    balance: row.balance,
    currency: row.currency,
  };
}

function belongsToUser(row = {}, userId) {
  const expectedUserId = String(userId || '').trim();
  const ownerUserId = String(row.ownerUserId || row.owner_user_id || '').trim();
  return Boolean(expectedUserId && ownerUserId && ownerUserId === expectedUserId);
}

function unboundSubjectProjection({
  questions,
  assets,
  assetRecords,
  assetCategories,
}, userId) {
  return {
    questionPreviews: questions.slice(0, 10),
    schedules: [],
    courses: [],
    assets: assets.filter(asset => belongsToUser(asset, userId)),
    students: [],
    grades: [],
    enrollments: [],
    payments: [],
    consumptions: [],
    teachers: [],
    rooms: [],
    institutions: [],
    schools: [],
    questions: [],
    taxonomySystems: [],
    taxonomyNodes: [],
    assetRecords: assetRecords.filter(row => belongsToUser(row, userId)),
    assetCategories: assetCategories.filter(row => belongsToUser(row, userId)),
  };
}

function studentCourseProjection(course = {}) {
  const {
    lessonPay,
    lesson_pay,
    teacherCompensation,
    teacher_compensation,
    calculatedTeacherFee,
    calculated_teacher_fee,
    studentIds,
    student_ids,
    studentPricings,
    student_pricings,
    ...safe
  } = course;
  return safe;
}

function studentScheduleProjection(schedule = {}) {
  const {
    studentIds,
    student_ids,
    studentPricings,
    student_pricings,
    calculatedTeacherFee,
    calculated_teacher_fee,
    teacherCompensation,
    teacher_compensation,
    lessonPay,
    lesson_pay,
    ...safe
  } = schedule;
  return safe;
}

function projectAuthorityData(scope = {}, source = {}) {
  const kind = String(scope.kind || 'visitor');
  const questions = array(source.questionPreviews || source.question_previews).map(questionPreview);
  const schedules = array(source.schedules);
  const courses = array(source.courses);
  const assets = array(source.assets).map(assetProjection);
  const students = array(source.students);
  const grades = array(source.grades);
  const enrollments = array(source.enrollments);
  const payments = array(source.payments);
  const consumptions = array(source.consumptions);
  const teachers = array(source.teachers);
  const rooms = array(source.rooms);
  const institutions = array(source.institutions);
  const schools = array(source.schools);
  const fullQuestions = array(source.questions);
  const taxonomySystems = array(source.taxonomySystems || source.taxonomy_systems);
  const taxonomyNodes = array(source.taxonomyNodes || source.taxonomy_nodes);
  const assetRecords = array(source.assetRecords || source.asset_records);
  const assetCategories = array(source.assetCategories || source.asset_categories);
  const roleApplications = array(source.roleApplications || source.role_applications);
  const roleGrants = array(source.roleGrants || source.role_grants);
  if (kind === 'visitor') return {
    questionPreviews: questions.slice(0, 10),
    schedules: [],
    courses: [],
    assets: assets.filter(asset => belongsToUser(asset, scope.userId)),
    assetRecords: assetRecords.filter(row => belongsToUser(row, scope.userId)),
    assetCategories: assetCategories.filter(row => belongsToUser(row, scope.userId)),
  };
  if (kind === 'student') {
    const studentId = String(scope.studentId || '').trim();
    if (!studentId) {
      return unboundSubjectProjection({ questions, assets, assetRecords, assetCategories }, scope.userId);
    }
    const allowedSchedules = schedules
      .filter(schedule => ids(schedule.studentIds || schedule.student_ids).includes(studentId));
    const allowedCourseIds = new Set(
      allowedSchedules.map(schedule => String(schedule.courseId || schedule.course_id || '')),
    );
    const allowedCourses = courses.filter(course => (
      ids(course.studentIds || course.student_ids).includes(studentId)
      || allowedCourseIds.has(String(course.id || ''))
    ));
    return {
      questionPreviews: questions,
      schedules: allowedSchedules.map(studentScheduleProjection),
      courses: allowedCourses.map(studentCourseProjection),
      assets: assets.filter(asset => belongsToUser(asset, scope.userId)),
      students: students.filter(student => String(student.id || '') === studentId),
      grades: grades.filter(grade => String(grade.student_id || grade.studentId || '') === studentId),
      enrollments: enrollments.filter(row => String(row.student_id || row.studentId || '') === studentId),
      payments: payments.filter(payment => String(payment.student_id || payment.studentId || '') === studentId),
      consumptions: consumptions.filter(row => String(row.student_id || row.studentId || '') === studentId),
      teachers: [],
      rooms: [],
      institutions: [],
      schools: [],
      questions: [],
      taxonomySystems: [],
      taxonomyNodes: [],
      assetRecords: assetRecords.filter(row => belongsToUser(row, scope.userId)),
      assetCategories: assetCategories.filter(row => belongsToUser(row, scope.userId)),
    };
  }
  if (kind === 'teacher') {
    const teacherId = String(scope.teacherId || '').trim();
    if (!teacherId) {
      return unboundSubjectProjection({ questions, assets, assetRecords, assetCategories }, scope.userId);
    }
    const allowedCourses = courses.filter(course => String(course.teacherId || course.teacher_id || '') === teacherId);
    const allowedCourseIds = new Set(allowedCourses.map(course => String(course.id || '')));
    const allowedSchedules = schedules.filter(schedule => (
      String(schedule.teacherId || schedule.teacher_id || '') === teacherId
      || allowedCourseIds.has(String(schedule.courseId || schedule.course_id || ''))
    ));
    const allowedStudentIds = new Set([
      ...allowedCourses.flatMap(course => ids(course.studentIds || course.student_ids)),
      ...allowedSchedules.flatMap(schedule => ids(schedule.studentIds || schedule.student_ids)),
    ]);
    const allowedScheduleIds = new Set(allowedSchedules.map(schedule => String(schedule.id || '')));
    return {
      questionPreviews: questions,
      schedules: allowedSchedules,
      courses: allowedCourses,
      assets: assets.filter(asset => belongsToUser(asset, scope.userId)),
      students: students.filter(student => allowedStudentIds.has(String(student.id || ''))),
      grades: grades.filter(grade => allowedStudentIds.has(String(grade.student_id || grade.studentId || ''))),
      enrollments: enrollments.filter(row => (
        allowedStudentIds.has(String(row.student_id || row.studentId || ''))
        && allowedScheduleIds.has(String(row.schedule_id || row.scheduleId || ''))
      )),
      payments: payments.filter(row => (
        allowedCourseIds.has(String(row.courseId || row.course_id || ''))
        || allowedScheduleIds.has(String(row.scheduleId || row.schedule_id || ''))
      )),
      consumptions: consumptions.filter(row => allowedScheduleIds.has(String(row.schedule_id || row.scheduleId || ''))),
      teachers: teachers.filter(teacher => String(teacher.id || '') === teacherId),
      rooms,
      institutions: [],
      schools,
      questions: [],
      taxonomySystems: [],
      taxonomyNodes: [],
      assetRecords: assetRecords.filter(row => belongsToUser(row, scope.userId)),
      assetCategories: assetCategories.filter(row => belongsToUser(row, scope.userId)),
    };
  }
  const adminProjection = {
    questionPreviews: questions,
    schedules,
    courses,
    assets,
    students,
    grades,
    enrollments,
    payments,
    consumptions,
    teachers,
    rooms,
    institutions,
    schools,
    questions: fullQuestions,
    taxonomySystems,
    taxonomyNodes,
    assetRecords,
    assetCategories,
  };
  if (kind === 'super_admin') {
    return {
      ...adminProjection,
      roleApplications,
      roleGrants,
    };
  }
  if (kind === 'admin') {
    return adminProjection;
  }
  return {
    questionPreviews: [],
    schedules: [],
    courses: [],
    assets: [],
    assetRecords: [],
    assetCategories: [],
  };
}

module.exports = {
  assetProjection,
  projectAuthorityData,
  questionPreview,
  studentCourseProjection,
  studentScheduleProjection,
};
