const assert = require('assert');

(async () => {
  const {
    createDesktopCloudBusinessDraftAdapter,
    restrictedCloudBusinessDraftTypes,
  } = await import('./desktopCloudBusinessDraft.mjs');

  const calls = [];
  const cloudClient = new Proxy({}, {
    get(_target, method) {
      return async input => {
        calls.push({ method: String(method), input });
        return { id: input.studentId || input.teacherId || input.roomId || input.courseId || input.scheduleId, updatedAt: '2026-08-24T01:00:00.000Z' };
      };
    },
  });
  const adapter = createDesktopCloudBusinessDraftAdapter({
    cloudClient,
    baseUrl: 'https://business.example',
    sha256: value => `hash:${value}`,
    now: () => '2026-08-24T01:00:01.000Z',
  });

  const studentCreateDraft = {
    id: 'draft-student-create',
    type: 'student.create.v1',
    payload: {
      record: {
        id: 'student-1', name: 'Student One', phone: '13700000001', parent_phone: '13700000002',
        parent_wechat: 'guardian-wx', school: 'School', grade_year: 2024, grade_current: 'G2',
        institution_id: null, parent_name: 'Guardian', notes: 'note', source_type: 1, student_source: 'direct',
      },
    },
  };
  const studentCommand = adapter.createCommand(studentCreateDraft);
  assert.strictEqual(studentCommand.commandId, studentCreateDraft.id);
  assert.strictEqual(studentCommand.payload, studentCreateDraft.payload);
  assert.match(studentCommand.payloadHash, /^hash:/);
  const studentReceipt = await adapter.submit(studentCommand, { sessionToken: 'desktop-session-token' });
  assert.strictEqual(calls[0].method, 'createCloudStudentRecord');
  assert.deepStrictEqual(calls[0].input, {
    baseUrl: 'https://business.example', currentSession: { token: 'desktop-session-token', offline: false },
    studentId: 'student-1', name: 'Student One', school: 'School', gradeYear: 2024, gradeCurrent: 'G2',
    institutionId: null, parentName: 'Guardian', notes: 'note', sourceType: 1, studentSource: 'direct',
    contacts: [
      { slot: 1, relationship: 'student', phone: '13700000001', wechat: null },
      { slot: 2, relationship: 'guardian', phone: '13700000002', wechat: 'guardian-wx' },
    ],
  });
  assert.deepStrictEqual(studentReceipt, {
    commandId: studentCommand.commandId,
    payloadHash: studentCommand.payloadHash,
    status: 'committed',
    result: { id: 'student-1', updatedAt: '2026-08-24T01:00:00.000Z' },
    resultHash: 'hash:{"id":"student-1","updatedAt":"2026-08-24T01:00:00.000Z"}',
    completedAt: '2026-08-24T01:00:01.000Z',
  });

  const studentUpdate = adapter.createCommand({
    id: 'draft-student-update', type: 'student.update.v1',
    payload: { id: 'student-1', expectedVersion: '2026-08-24T00:00:00.000Z', changes: {
      ...studentCreateDraft.payload.record,
      contacts: [{
        slot: 1, relationship: 'student', phone: '13700000001', wechat: null,
        updated_at: '2026-08-23T00:00:00.000Z',
      }],
    } },
  });
  await adapter.submit(studentUpdate, { sessionToken: 'desktop-session-token' });
  assert.strictEqual(calls[1].method, 'updateCloudStudentRecord');
  assert.strictEqual(calls[1].input.expectedUpdatedAt, '2026-08-24T00:00:00.000Z');
  assert.deepStrictEqual(calls[1].input.contacts, [{
    slot: 1, relationship: 'student', phone: '13700000001', wechat: null,
    expectedUpdatedAt: '2026-08-23T00:00:00.000Z',
  }]);

  const studentDelete = adapter.createCommand({
    id: 'draft-student-delete', type: 'student.delete.v1',
    payload: { id: 'student-1', expectedVersion: '2026-08-24T00:00:00.000Z' },
  });
  await adapter.submit(studentDelete, { sessionToken: 'desktop-session-token' });
  assert.strictEqual(calls[2].method, 'deleteCloudStudent');
  assert.strictEqual(calls[2].input.expectedUpdatedAt, '2026-08-24T00:00:00.000Z');

  const teacherRecord = { id: 'teacher-1', name: 'Teacher One', phone: '13700000003', subject: 'Physics', hourly_rate: 60, notes: null };
  await adapter.submit(adapter.createCommand({
    id: 'draft-teacher-create', type: 'teacher.create.v1', payload: { record: teacherRecord },
  }), { sessionToken: 'desktop-session-token' });
  assert.strictEqual(calls.at(-1).method, 'createCloudTeacher');
  assert.deepStrictEqual(calls.at(-1).input, {
    baseUrl: 'https://business.example', currentSession: { token: 'desktop-session-token', offline: false },
    teacherId: 'teacher-1', name: 'Teacher One', phone: '13700000003', subject: 'Physics', hourlyRate: 60, notes: null,
  });
  await adapter.submit(adapter.createCommand({
    id: 'draft-teacher-update', type: 'teacher.update.v1',
    payload: { id: 'teacher-1', expectedVersion: '2026-08-23T00:00:00.000Z', changes: teacherRecord },
  }), { sessionToken: 'desktop-session-token' });
  assert.strictEqual(calls.at(-1).method, 'updateCloudTeacher');
  assert.strictEqual(calls.at(-1).input.expectedUpdatedAt, '2026-08-23T00:00:00.000Z');
  await adapter.submit(adapter.createCommand({
    id: 'draft-teacher-delete', type: 'teacher.delete.v1',
    payload: { id: 'teacher-1', expectedVersion: '2026-08-23T00:00:00.000Z' },
  }), { sessionToken: 'desktop-session-token' });
  assert.strictEqual(calls.at(-1).method, 'deleteCloudTeacher');

  const roomRecord = { id: 'room-1', name: 'Room One', address: 'Address One' };
  await adapter.submit(adapter.createCommand({
    id: 'draft-room-create', type: 'room.create.v1', payload: { record: roomRecord },
  }), { sessionToken: 'desktop-session-token' });
  assert.strictEqual(calls.at(-1).method, 'createCloudRoom');
  await adapter.submit(adapter.createCommand({
    id: 'draft-room-update', type: 'room.update.v1',
    payload: { id: 'room-1', expectedVersion: '2026-08-23T00:00:00.000Z', changes: roomRecord },
  }), { sessionToken: 'desktop-session-token' });
  assert.strictEqual(calls.at(-1).method, 'updateCloudRoom');
  assert.strictEqual(calls.at(-1).input.address, 'Address One');
  await adapter.submit(adapter.createCommand({
    id: 'draft-room-delete', type: 'room.delete.v1',
    payload: { id: 'room-1', expectedVersion: '2026-08-23T00:00:00.000Z' },
  }), { sessionToken: 'desktop-session-token' });
  assert.strictEqual(calls.at(-1).method, 'deleteCloudRoom');

  const institutionRecord = { id: 'institution-1', name: 'Institution One', contact_person: 'Contact', contact_phone: '13700000004', revenue_share: 30, notes: null };
  await adapter.submit(adapter.createCommand({ id: 'draft-institution-create', type: 'institution.create.v1', payload: { record: institutionRecord } }), { sessionToken: 'desktop-session-token' });
  assert.strictEqual(calls.at(-1).method, 'createCloudInstitution');
  await adapter.submit(adapter.createCommand({ id: 'draft-institution-update', type: 'institution.update.v1', payload: { id: 'institution-1', expectedVersion: '2026-08-23T00:00:00.000Z', changes: institutionRecord } }), { sessionToken: 'desktop-session-token' });
  assert.strictEqual(calls.at(-1).method, 'updateCloudInstitution');
  await adapter.submit(adapter.createCommand({ id: 'draft-institution-delete', type: 'institution.delete.v1', payload: { id: 'institution-1', expectedVersion: '2026-08-23T00:00:00.000Z' } }), { sessionToken: 'desktop-session-token' });
  assert.strictEqual(calls.at(-1).method, 'deleteCloudInstitution');

  const schoolRecord = { id: 'school-1', name: 'School One', count: 3 };
  await adapter.submit(adapter.createCommand({ id: 'draft-school-create', type: 'school.create.v1', payload: { record: schoolRecord } }), { sessionToken: 'desktop-session-token' });
  assert.strictEqual(calls.at(-1).method, 'createCloudSchool');
  await adapter.submit(adapter.createCommand({ id: 'draft-school-update', type: 'school.update.v1', payload: { id: 'school-1', expectedVersion: '2026-08-23T00:00:00.000Z', changes: schoolRecord } }), { sessionToken: 'desktop-session-token' });
  assert.strictEqual(calls.at(-1).method, 'updateCloudSchool');
  await adapter.submit(adapter.createCommand({ id: 'draft-school-delete', type: 'school.delete.v1', payload: { id: 'school-1', expectedVersion: '2026-08-23T00:00:00.000Z' } }), { sessionToken: 'desktop-session-token' });
  assert.strictEqual(calls.at(-1).method, 'deleteCloudSchool');

  assert.deepStrictEqual(Object.keys(restrictedCloudBusinessDraftTypes).sort(), [
    'consumption.create.v1', 'consumption.delete.v1', 'consumption.update.v1',
    'grade.create.v1', 'grade.delete.v1',
    'payment.create.v1', 'payment.delete.v1', 'payment.update.v1',
    'personal-asset-category.create.v1', 'personal-asset-category.delete.v1',
    'personal-asset-record.create.v1', 'personal-asset-record.delete.v1', 'personal-asset-record.update.v1',
  ]);
  for (const type of Object.keys(restrictedCloudBusinessDraftTypes)) {
    const action = type.split('.')[1];
    const payload = action === 'create' ? { record: { id: `restricted-${type}` } } : { id: `restricted-${type}`, ...(action === 'update' || action === 'delete' ? { expectedVersion: '2026-08-24T00:00:00.000Z', changes: { notes: null } } : {}) };
    const receipt = await adapter.submit(adapter.createCommand({ id: `draft-${type}`, type, payload }), { sessionToken: 'desktop-session-token' });
    assert.strictEqual(receipt.status, 'rejected');
    assert.deepStrictEqual(receipt.result, { error: { code: 'CLOUD_BUSINESS_DRAFT_TYPE_RESTRICTED' } });
  }

  const courseRecord = {
    id: 'course-1', name: 'Physics', year: 2026, semester: 'Fall', display_name: 'Physics Fall', type: 1,
    source_type: 1, institution_id: null, price_tuition: 100, price_teacher: 60, billing_unit: 1,
    teacher_fee_mode: 1, room_id: 'room-1', room_name: 'Room One', teacher_id: 'teacher-1',
    teacher_name: 'Teacher One', active: true, default_duration_minutes: 90, notes: null,
    student_pricings: [{ student_id: 'student-1', tuition: 100, teacher_fee: 60 }],
  };
  await adapter.submit(adapter.createCommand({
    id: 'draft-course-create', type: 'course.create.v1', payload: { record: courseRecord },
  }), { sessionToken: 'desktop-session-token' });
  assert.strictEqual(calls.at(-1).method, 'createCloudCourse');
  assert.strictEqual(calls.at(-1).input.displayName, 'Physics Fall');

  const courseUpdate = adapter.createCommand({
    id: 'draft-course-update', type: 'course.update.v1',
    payload: { id: 'course-1', expectedVersion: '2026-08-24T00:00:00.000Z', changes: courseRecord },
  });
  await adapter.submit(courseUpdate, { sessionToken: 'desktop-session-token' });
  assert.strictEqual(calls.at(-1).method, 'updateCloudCourse');
  assert.strictEqual(calls.at(-1).input.courseId, 'course-1');
  assert.strictEqual(calls.at(-1).input.expectedUpdatedAt, '2026-08-24T00:00:00.000Z');
  assert.strictEqual(calls.at(-1).input.displayName, 'Physics Fall');
  assert.deepStrictEqual(calls.at(-1).input.pricings, [{ studentId: 'student-1', tuition: 100, teacherFee: 60 }]);
  await adapter.submit(adapter.createCommand({
    id: 'draft-course-delete', type: 'course.delete.v1',
    payload: { id: 'course-1', expectedVersion: '2026-08-23T00:00:00.000Z' },
  }), { sessionToken: 'desktop-session-token' });
  assert.strictEqual(calls.at(-1).method, 'deleteCloudCourse');

  const scheduleUpdate = adapter.createCommand({
    id: 'draft-schedule-update', type: 'schedule.update.v1',
    payload: { id: 'schedule-1', expectedVersion: '2026-08-24T00:00:00.000Z', changes: {
      start_time: '2026-08-25T01:00:00.000Z', end_time: '2026-08-25T02:00:00.000Z', status: 1,
      room: 'Room One', calculated_tuition: 100, calculated_teacher_fee: 60, notes: null,
    } },
  });
  await adapter.submit(scheduleUpdate, { sessionToken: 'desktop-session-token' });
  assert.strictEqual(calls.at(-1).method, 'updateCloudSchedule');
  assert.deepStrictEqual(calls.at(-1).input, {
    baseUrl: 'https://business.example', currentSession: { token: 'desktop-session-token', offline: false },
    scheduleId: 'schedule-1', expectedUpdatedAt: '2026-08-24T00:00:00.000Z',
    startAt: '2026-08-25T01:00:00.000Z', endAt: '2026-08-25T02:00:00.000Z', status: 1,
    roomDisplay: 'Room One', tuition: 100, teacherFee: 60, notes: null,
  });

  const scheduleRecord = {
    id: 'schedule-2', course_id: 'course-1', start_time: '2026-08-26T01:00:00.000Z',
    end_time: '2026-08-26T02:00:00.000Z', recurring_rule: null, status: 1, room: 'Room One',
    service_type: 1, calculated_tuition: 100, calculated_teacher_fee: 60, notes: null,
    student_pricings: [{ student_id: 'student-1', status: 1, tuition: 100, teacher_fee: 60 }],
  };
  await adapter.submit(adapter.createCommand({
    id: 'draft-schedule-create', type: 'schedule.create.v1', payload: { record: scheduleRecord },
  }), { sessionToken: 'desktop-session-token' });
  assert.strictEqual(calls.at(-1).method, 'createCloudSchedule');
  assert.deepStrictEqual(calls.at(-1).input, {
    baseUrl: 'https://business.example', currentSession: { token: 'desktop-session-token', offline: false },
    scheduleId: 'schedule-2', courseId: 'course-1', startAt: '2026-08-26T01:00:00.000Z',
    endAt: '2026-08-26T02:00:00.000Z', recurringRule: null, status: 1, roomDisplay: 'Room One',
    serviceType: 1, tuition: 100, teacherFee: 60, notes: null,
    pricings: [{ studentId: 'student-1', attendanceStatus: 1, tuition: 100, teacherFee: 60 }],
  });
  await adapter.submit(adapter.createCommand({
    id: 'draft-schedule-delete', type: 'schedule.delete.v1',
    payload: { id: 'schedule-2', expectedVersion: '2026-08-24T03:00:00.000Z' },
  }), { sessionToken: 'desktop-session-token' });
  assert.strictEqual(calls.at(-1).method, 'deleteCloudSchedule');
  assert.strictEqual(calls.at(-1).input.expectedUpdatedAt, '2026-08-24T03:00:00.000Z');
  await assert.rejects(
    () => adapter.submit(adapter.createCommand({ id: 'draft-no-version', type: 'room.update.v1', payload: { id: 'room-1', changes: { name: 'Room' } } }), { sessionToken: 'desktop-session-token' }),
    error => error?.code === 'CLOUD_BUSINESS_DRAFT_EXPECTED_VERSION_REQUIRED',
  );
  await assert.rejects(
    () => adapter.submit(courseUpdate, {}),
    error => error?.code === 'DESKTOP_CLOUD_SESSION_REQUIRED',
  );

  const conflictAdapter = createDesktopCloudBusinessDraftAdapter({
    cloudClient: {
      updateCloudCourse: async () => {
        throw Object.assign(new Error('CLOUD_BUSINESS_COURSE_CONFLICT'), { code: 'CLOUD_BUSINESS_COURSE_CONFLICT' });
      },
    },
    baseUrl: 'https://business.example',
    sha256: value => `hash:${value}`,
    now: () => '2026-08-24T02:00:00.000Z',
  });
  const conflictReceipt = await conflictAdapter.submit(courseUpdate, { sessionToken: 'desktop-session-token' });
  assert.strictEqual(conflictReceipt.status, 'rejected');
  assert.deepStrictEqual(conflictReceipt.result, { error: { code: 'CLOUD_BUSINESS_COURSE_CONFLICT' } });
  const duplicateRoomAdapter = createDesktopCloudBusinessDraftAdapter({
    cloudClient: {
      createCloudRoom: async () => {
        throw Object.assign(new Error('CLOUD_BUSINESS_ROOM_NAME_EXISTS'), { code: 'CLOUD_BUSINESS_ROOM_NAME_EXISTS' });
      },
    },
    baseUrl: 'https://business.example',
    sha256: value => `hash:${value}`,
  });
  const duplicateRoomReceipt = await duplicateRoomAdapter.submit(
    adapter.createCommand({ id: 'draft-room-duplicate', type: 'room.create.v1', payload: { record: roomRecord } }),
    { sessionToken: 'desktop-session-token' },
  );
  assert.strictEqual(duplicateRoomReceipt.status, 'rejected');
  assert.deepStrictEqual(duplicateRoomReceipt.result, { error: { code: 'CLOUD_BUSINESS_ROOM_NAME_EXISTS' } });
  const networkAdapter = createDesktopCloudBusinessDraftAdapter({
    cloudClient: { updateCloudCourse: async () => { throw Object.assign(new Error('network'), { code: 'ECONNRESET' }); } },
    baseUrl: 'https://business.example',
    sha256: value => `hash:${value}`,
  });
  await assert.rejects(
    () => networkAdapter.submit(courseUpdate, { sessionToken: 'desktop-session-token' }),
    error => error?.code === 'ECONNRESET',
  );

  console.log('desktop cloud business draft checks passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
