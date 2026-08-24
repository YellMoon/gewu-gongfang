function businessDraftError(code) {
  return Object.assign(new Error(code), { code });
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function requiredText(value, code) {
  const result = String(value || '').trim();
  if (!result) throw businessDraftError(code);
  return result;
}

function nullable(value) {
  return value === undefined || value === '' ? null : value;
}

function expectedVersion(payload) {
  return requiredText(payload?.expectedVersion, 'CLOUD_BUSINESS_DRAFT_EXPECTED_VERSION_REQUIRED');
}

function studentContacts(record, includeExpectedVersion = false) {
  if (Array.isArray(record.contacts)) {
    return record.contacts.map(contact => ({
      slot: contact.slot,
      relationship: contact.relationship,
      phone: nullable(contact.phone),
      wechat: nullable(contact.wechat),
      ...(includeExpectedVersion
        ? { expectedUpdatedAt: nullable(contact.updated_at ?? contact.expectedUpdatedAt) }
        : {}),
    }));
  }
  const contacts = [];
  const studentPhone = nullable(record.phone);
  if (studentPhone !== null) {
    contacts.push({ slot: 1, relationship: 'student', phone: studentPhone, wechat: null });
  }
  const guardianPhone = nullable(record.parent_phone);
  const guardianWechat = nullable(record.parent_wechat);
  if (guardianPhone !== null || guardianWechat !== null) {
    contacts.push({ slot: 2, relationship: 'guardian', phone: guardianPhone, wechat: guardianWechat });
  }
  return contacts;
}

function studentInput(record, includeContactVersions = false) {
  return {
    name: record.name,
    school: nullable(record.school),
    gradeYear: nullable(record.grade_year),
    gradeCurrent: nullable(record.grade_current),
    institutionId: nullable(record.institution_id),
    parentName: nullable(record.parent_name),
    notes: nullable(record.notes),
    sourceType: nullable(record.source_type),
    studentSource: nullable(record.student_source),
    contacts: studentContacts(record, includeContactVersions),
  };
}

function teacherInput(record) {
  return {
    name: record.name,
    phone: nullable(record.phone),
    subject: nullable(record.subject),
    hourlyRate: nullable(record.hourly_rate),
    notes: nullable(record.notes),
  };
}

function roomInput(record) {
  return { name: record.name, address: nullable(record.address) };
}

function courseInput(record) {
  return {
    name: record.name,
    year: record.year,
    semester: record.semester,
    displayName: record.display_name,
    type: record.type,
    sourceType: record.source_type,
    institutionId: nullable(record.institution_id),
    priceTuition: record.price_tuition,
    priceTeacher: record.price_teacher,
    billingUnit: record.billing_unit,
    teacherFeeMode: record.teacher_fee_mode,
    roomId: record.room_id,
    roomName: nullable(record.room_name),
    teacherId: record.teacher_id,
    teacherName: nullable(record.teacher_name),
    active: record.active,
    defaultDurationMinutes: nullable(record.default_duration_minutes),
    notes: nullable(record.notes),
    pricings: Array.isArray(record.student_pricings)
      ? record.student_pricings.map(item => ({
        studentId: item.student_id,
        tuition: item.tuition,
        teacherFee: item.teacher_fee,
      }))
      : [],
  };
}

function scheduleInput(record) {
  return {
    startAt: record.start_time,
    endAt: record.end_time,
    status: record.status,
    roomDisplay: nullable(record.room),
    tuition: record.calculated_tuition,
    teacherFee: record.calculated_teacher_fee,
    notes: nullable(record.notes),
  };
}

function callInput(baseUrl, sessionToken, values) {
  return {
    baseUrl,
    currentSession: { token: sessionToken, offline: false },
    ...values,
  };
}

function stableCloudRejection(error) {
  const code = String(error?.code || '');
  if (code === 'CLOUD_BUSINESS_DRAFT_TYPE_RESTRICTED') return code;
  return /^CLOUD_BUSINESS_[A-Z0-9_]*(CONFLICT|ACCESS_DENIED|RELATION_INVALID|REFERENCED|INPUT_INVALID|NAME_EXISTS)$/.test(code)
    ? code
    : null;
}

export function createDesktopCloudBusinessDraftAdapter({
  cloudClient,
  baseUrl,
  sha256,
  now = () => new Date().toISOString(),
} = {}) {
  if (!cloudClient || typeof cloudClient !== 'object' || typeof sha256 !== 'function') {
    throw businessDraftError('CLOUD_BUSINESS_DRAFT_ADAPTER_CONFIG_REQUIRED');
  }
  const normalizedBaseUrl = requiredText(baseUrl, 'CLOUD_BUSINESS_AUTHORITY_UNAVAILABLE').replace(/\/+$/, '');

  function createCommand(draft) {
    if (!draft || typeof draft !== 'object' || !draft.id || !draft.type || !draft.payload) {
      throw businessDraftError('CLOUD_BUSINESS_DRAFT_INVALID');
    }
    return Object.freeze({
      commandId: draft.id,
      payloadHash: sha256(stableJson({ type: draft.type, payload: draft.payload })),
      type: draft.type,
      payload: draft.payload,
    });
  }

  async function dispatch(command, sessionToken) {
    const payload = command.payload || {};
    const createRecord = payload.record || {};
    const updateRecord = payload.changes || {};
    switch (command.type) {
      case 'student.create.v1':
        return cloudClient.createCloudStudentRecord(callInput(normalizedBaseUrl, sessionToken, {
          studentId: requiredText(createRecord.id, 'CLOUD_BUSINESS_DRAFT_RECORD_ID_REQUIRED'),
          ...studentInput(createRecord),
        }));
      case 'student.update.v1':
        return cloudClient.updateCloudStudentRecord(callInput(normalizedBaseUrl, sessionToken, {
          studentId: requiredText(payload.id, 'CLOUD_BUSINESS_DRAFT_RECORD_ID_REQUIRED'),
          expectedUpdatedAt: expectedVersion(payload),
          ...studentInput(updateRecord, true),
        }));
      case 'student.delete.v1':
        return cloudClient.deleteCloudStudent(callInput(normalizedBaseUrl, sessionToken, {
          studentId: requiredText(payload.id, 'CLOUD_BUSINESS_DRAFT_RECORD_ID_REQUIRED'),
          expectedUpdatedAt: expectedVersion(payload),
        }));
      case 'teacher.create.v1':
        return cloudClient.createCloudTeacher(callInput(normalizedBaseUrl, sessionToken, {
          teacherId: requiredText(createRecord.id, 'CLOUD_BUSINESS_DRAFT_RECORD_ID_REQUIRED'),
          ...teacherInput(createRecord),
        }));
      case 'teacher.update.v1':
        return cloudClient.updateCloudTeacher(callInput(normalizedBaseUrl, sessionToken, {
          teacherId: requiredText(payload.id, 'CLOUD_BUSINESS_DRAFT_RECORD_ID_REQUIRED'),
          expectedUpdatedAt: expectedVersion(payload),
          ...teacherInput(updateRecord),
        }));
      case 'teacher.delete.v1':
        return cloudClient.deleteCloudTeacher(callInput(normalizedBaseUrl, sessionToken, {
          teacherId: requiredText(payload.id, 'CLOUD_BUSINESS_DRAFT_RECORD_ID_REQUIRED'),
          expectedUpdatedAt: expectedVersion(payload),
        }));
      case 'room.create.v1':
        return cloudClient.createCloudRoom(callInput(normalizedBaseUrl, sessionToken, {
          roomId: requiredText(createRecord.id, 'CLOUD_BUSINESS_DRAFT_RECORD_ID_REQUIRED'),
          ...roomInput(createRecord),
        }));
      case 'room.update.v1':
        return cloudClient.updateCloudRoom(callInput(normalizedBaseUrl, sessionToken, {
          roomId: requiredText(payload.id, 'CLOUD_BUSINESS_DRAFT_RECORD_ID_REQUIRED'),
          expectedUpdatedAt: expectedVersion(payload),
          ...roomInput(updateRecord),
        }));
      case 'room.delete.v1':
        return cloudClient.deleteCloudRoom(callInput(normalizedBaseUrl, sessionToken, {
          roomId: requiredText(payload.id, 'CLOUD_BUSINESS_DRAFT_RECORD_ID_REQUIRED'),
          expectedUpdatedAt: expectedVersion(payload),
        }));
      case 'course.create.v1':
        return cloudClient.createCloudCourse(callInput(normalizedBaseUrl, sessionToken, {
          courseId: requiredText(createRecord.id, 'CLOUD_BUSINESS_DRAFT_RECORD_ID_REQUIRED'),
          ...courseInput(createRecord),
        }));
      case 'course.update.v1':
        return cloudClient.updateCloudCourse(callInput(normalizedBaseUrl, sessionToken, {
          courseId: requiredText(payload.id, 'CLOUD_BUSINESS_DRAFT_RECORD_ID_REQUIRED'),
          expectedUpdatedAt: expectedVersion(payload),
          ...courseInput(updateRecord),
        }));
      case 'course.delete.v1':
        return cloudClient.deleteCloudCourse(callInput(normalizedBaseUrl, sessionToken, {
          courseId: requiredText(payload.id, 'CLOUD_BUSINESS_DRAFT_RECORD_ID_REQUIRED'),
          expectedUpdatedAt: expectedVersion(payload),
        }));
      case 'schedule.update.v1':
        return cloudClient.updateCloudSchedule(callInput(normalizedBaseUrl, sessionToken, {
          scheduleId: requiredText(payload.id, 'CLOUD_BUSINESS_DRAFT_RECORD_ID_REQUIRED'),
          expectedUpdatedAt: expectedVersion(payload),
          ...scheduleInput(updateRecord),
        }));
      default:
        throw businessDraftError('CLOUD_BUSINESS_DRAFT_TYPE_RESTRICTED');
    }
  }

  async function submit(command, { sessionToken } = {}) {
    const token = requiredText(sessionToken, 'DESKTOP_CLOUD_SESSION_REQUIRED');
    let status = 'committed';
    let result;
    try {
      result = await dispatch(command, token);
    } catch (error) {
      const rejectionCode = stableCloudRejection(error);
      if (!rejectionCode) throw error;
      status = 'rejected';
      result = { error: { code: rejectionCode } };
    }
    return Object.freeze({
      commandId: command.commandId,
      payloadHash: command.payloadHash,
      status,
      result,
      resultHash: sha256(stableJson(result)),
      completedAt: now(),
    });
  }

  return Object.freeze({ createCommand, submit });
}

export { businessDraftError };
