const ADMIN_ROLES = new Set(['super_admin']);
const USER_ROLES = new Set(['visitor', 'student', 'teacher', 'super_admin']);

const ENTITY_SPECS = Object.freeze({
  student: {
    collection: 'students',
    get: 'getStudentById',
    create: 'createStudent',
    update: 'updateStudent',
    delete: 'deleteStudent',
    fields: [
      'name', 'phone', 'parent_phone', 'parent_relation', 'school', 'grade_year',
      'grade_current', 'source_type', 'institution_id', 'is_institution_student',
      'parent_name', 'parent_wechat', 'student_source', 'balance_hours',
      'balance_money', 'notes',
    ],
  },
  course: {
    collection: 'courses',
    get: 'getCourseById',
    create: 'createCourse',
    update: 'updateCourse',
    delete: 'deleteCourse',
    fields: [
      'name', 'year', 'semester', 'display_name', 'type', 'source_type',
      'institution_id', 'price_tuition', 'price_teacher', 'billing_unit',
      'teacher_fee_mode', 'student_pricings', 'room_id', 'room_name', 'teacher_id',
      'teacher_name', 'active', 'default_duration_minutes', 'notes',
    ],
  },
  schedule: {
    collection: 'schedules',
    get: 'getScheduleById',
    create: 'createSchedule',
    update: 'updateSchedule',
    delete: 'deleteSchedule',
    fields: [
      'course_id', 'start_time', 'end_time', 'recurring_rule', 'status', 'room',
      'service_type', 'student_ids', 'student_pricings', 'calculated_tuition',
      'calculated_teacher_fee', 'notes',
    ],
  },
  payment: {
    collection: 'payments',
    get: 'getPaymentById',
    create: 'createPayment',
    update: 'updatePayment',
    delete: 'deletePayment',
    fields: [
      'student_id', 'amount', 'payment_type', 'payment_date', 'payment_method',
      'notes',
    ],
  },
  consumption: {
    collection: 'consumptions',
    get: 'getConsumptionById',
    create: 'createConsumption',
    update: 'updateConsumption',
    delete: 'deleteConsumption',
    fields: [
      'schedule_id', 'student_id', 'hours', 'amount', 'consumption_date', 'notes',
    ],
  },
  teacher: {
    collection: 'teachers',
    get: 'getTeacherById',
    create: 'createTeacher',
    update: 'updateTeacher',
    delete: 'deleteTeacher',
    fields: ['name', 'phone', 'subject', 'hourly_rate', 'notes'],
  },
  grade: {
    collection: 'grades',
    get: 'getGradeById',
    create: 'createGrade',
    delete: 'deleteGrade',
    fields: ['student_id', 'subject', 'score', 'exam_date', 'notes'],
  },
  room: {
    collection: 'rooms',
    get: 'getRoomById',
    create: 'createRoom',
    update: 'updateRoom',
    delete: 'deleteRoom',
    fields: ['name', 'address'],
  },
  institution: {
    collection: 'institutions',
    get: 'getInstitutionById',
    create: 'createInstitution',
    update: 'updateInstitution',
    delete: 'deleteInstitution',
    fields: ['name', 'contact_person', 'contact_phone', 'revenue_share', 'notes'],
  },
});

const QUESTION_FIELDS = Object.freeze([
  'subject', 'subject_id', 'chapter_id', 'type', 'difficulty', 'status',
  'content', 'stem', 'options', 'answer', 'analysis', 'explanation',
  'rich_content', 'knowledge_point_ids', 'model_point_ids', 'taxonomy_ids',
  'source', 'year', 'grade', 'semester', 'exam_type', 'region', 'school',
  'edit_status', 'has_image', 'has_formula',
]);
const TAXONOMY_SYSTEM_FIELDS = Object.freeze(['subject', 'name', 'sort_order']);
const TAXONOMY_NODE_FIELDS = Object.freeze(['system_id', 'parent_id', 'name', 'sort_order']);
const TEACHER_SCHEDULE_FIELDS = new Set([
  'start_time', 'end_time', 'recurring_rule', 'status', 'room', 'service_type',
  'student_ids', 'student_pricings', 'notes',
]);

const BUSINESS_COMMAND_TYPES = new Set();
for (const [entity, spec] of Object.entries(ENTITY_SPECS)) {
  for (const action of ['create', 'update', 'delete']) {
    if (spec[action]) BUSINESS_COMMAND_TYPES.add(`${entity}.${action}.v1`);
  }
}
for (const entity of ['question', 'taxonomy-system', 'taxonomy-node']) {
  for (const action of ['create', 'update', 'delete']) {
    BUSINESS_COMMAND_TYPES.add(`${entity}.${action}.v1`);
  }
}
for (const type of [
  'personal-asset-record.create.v1',
  'personal-asset-record.update.v1',
  'personal-asset-record.delete.v1',
  'personal-asset-category.create.v1',
  'personal-asset-category.delete.v1',
]) BUSINESS_COMMAND_TYPES.add(type);

function mutationError(code, statusCode = 400) {
  return Object.assign(new Error(code), { code, statusCode });
}

function requiredId(value) {
  const id = String(value || '').trim();
  if (!id) throw mutationError('AUTHORITY_COMMAND_PAYLOAD_INVALID');
  return id;
}

function selectedFields(value, allowedFields, { allowId = false } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw mutationError('AUTHORITY_COMMAND_PAYLOAD_INVALID');
  }
  const allowed = new Set(allowedFields);
  const keys = Object.keys(value);
  if (keys.some(key => !(allowId && key === 'id') && !allowed.has(key))) {
    throw mutationError('AUTHORITY_COMMAND_FIELD_FORBIDDEN', 403);
  }
  const selected = {};
  for (const key of keys) {
    if (allowId && key === 'id') continue;
    if (value[key] !== undefined) selected[key] = value[key];
  }
  if (Object.keys(selected).length === 0) {
    throw mutationError('AUTHORITY_COMMAND_PAYLOAD_INVALID');
  }
  return selected;
}

function isAdmin(scope = {}) {
  return ADMIN_ROLES.has(String(scope.kind || ''));
}

function isAuthorityBusinessCommandAllowed({ type, scope } = {}) {
  const commandType = String(type || '');
  if (!BUSINESS_COMMAND_TYPES.has(commandType)) return false;
  if (commandType.startsWith('personal-asset-')) {
    return USER_ROLES.has(String(scope?.kind || ''));
  }
  if (commandType === 'schedule.update.v1' && scope?.kind === 'teacher') return true;
  return isAdmin(scope);
}

function checkExpectedVersion(row, expectedVersion) {
  const expected = String(expectedVersion || '').trim();
  if (!expected) return;
  const actual = String(row?.row_version ?? row?.updated_at ?? row?.version ?? '').trim();
  if (!actual || actual !== expected) {
    throw mutationError('AUTHORITY_COMMAND_VERSION_CONFLICT', 409);
  }
}

function requireMethod(target, name) {
  if (!target || typeof target[name] !== 'function') {
    throw mutationError('AUTHORITY_COMMAND_DOMAIN_METHOD_REQUIRED', 500);
  }
  return target[name].bind(target);
}

function createAuthorityBusinessMutationHandlers({
  database,
  questionBank,
  questionStorageService,
  personalAssetRecordService,
  tenantId = 'default',
} = {}) {
  if (!database) throw mutationError('AUTHORITY_COMMAND_DATABASE_REQUIRED', 500);
  const tenantOptions = Object.freeze({ tenantId, authorityCommand: true });
  const handlers = {};

  for (const [entity, spec] of Object.entries(ENTITY_SPECS)) {
    if (spec.create) {
      handlers[`${entity}.create.v1`] = (envelope, authorization = {}) => {
        if (!isAdmin(authorization.scope)) {
          throw mutationError('AUTHORITY_COMMAND_SCOPE_FORBIDDEN', 403);
        }
        const record = envelope?.payload?.record;
        const id = requiredId(record?.id);
        const fields = selectedFields(record, spec.fields, { allowId: true });
        const result = requireMethod(database, spec.create)({ id, ...fields }, tenantOptions);
        if (String(result?.id || '') !== id) {
          throw mutationError('AUTHORITY_COMMAND_CREATE_ID_MISMATCH', 500);
        }
        return result;
      };
    }
    if (spec.update) {
      handlers[`${entity}.update.v1`] = (envelope, authorization = {}) => {
        const scope = authorization.scope || {};
        if (entity !== 'schedule' || scope.kind !== 'teacher') {
          if (!isAdmin(scope)) throw mutationError('AUTHORITY_COMMAND_SCOPE_FORBIDDEN', 403);
        }
        const id = requiredId(envelope?.payload?.id);
        const read = requireMethod(database, spec.get);
        const existing = read(id, tenantOptions);
        if (!existing) throw mutationError('AUTHORITY_COMMAND_TARGET_NOT_FOUND', 404);
        checkExpectedVersion(existing, envelope.payload.expectedVersion);
        const fields = entity === 'schedule' && scope.kind === 'teacher'
          ? [...TEACHER_SCHEDULE_FIELDS]
          : spec.fields;
        const changes = selectedFields(envelope.payload.changes, fields);
        if (entity === 'schedule' && scope.kind === 'teacher') {
          const course = requireMethod(database, 'getCourseById')(existing.course_id, tenantOptions);
          if (!course || String(course.teacher_id || '') !== String(scope.teacherId || '')) {
            throw mutationError('AUTHORITY_COMMAND_SCOPE_FORBIDDEN', 403);
          }
        }
        return requireMethod(database, spec.update)(id, changes, tenantOptions);
      };
    }
    if (spec.delete) {
      handlers[`${entity}.delete.v1`] = (envelope, authorization = {}) => {
        if (!isAdmin(authorization.scope)) {
          throw mutationError('AUTHORITY_COMMAND_SCOPE_FORBIDDEN', 403);
        }
        const id = requiredId(envelope?.payload?.id);
        const existing = requireMethod(database, spec.get)(id, tenantOptions);
        if (!existing) throw mutationError('AUTHORITY_COMMAND_TARGET_NOT_FOUND', 404);
        checkExpectedVersion(existing, envelope.payload.expectedVersion);
        return { id, deleted: Boolean(requireMethod(database, spec.delete)(id, tenantOptions)) };
      };
    }
  }

  const sqlite = database.db || database;
  for (const action of ['create', 'update', 'delete']) {
    handlers[`question.${action}.v1`] = (envelope, authorization = {}) => {
      if (!isAdmin(authorization.scope)) {
        throw mutationError('AUTHORITY_COMMAND_SCOPE_FORBIDDEN', 403);
      }
      if (!questionBank) throw mutationError('AUTHORITY_QUESTION_SERVICE_REQUIRED', 500);
      if (!questionStorageService) {
        throw mutationError('AUTHORITY_QUESTION_STORAGE_SERVICE_REQUIRED', 500);
      }
      const internalCredential = requireMethod(
        questionStorageService,
        'createTrustedAuthorityExecutorStorageContext',
      )({ envelope, authorization });
      if (action === 'create') {
        const id = requiredId(envelope?.payload?.record?.id);
        const fields = selectedFields(envelope.payload.record, QUESTION_FIELDS, { allowId: true });
        const result = requireMethod(questionBank, 'createQuestion')(
          sqlite,
          { id, ...fields },
          tenantId,
          { deviceId: envelope.actor?.deviceId, userId: authorization.scope?.userId },
        );
        if (String(result?.id || '') !== id) {
          throw mutationError('AUTHORITY_COMMAND_CREATE_ID_MISMATCH', 500);
        }
        const storage = requireMethod(questionStorageService, 'commitQuestionToBoundStore')(
          id,
          {
            db: sqlite,
            tenantId,
            operationId: envelope.commandId,
            internalCredential,
          },
        );
        return { ...storage, question: result };
      }
      const id = requiredId(envelope?.payload?.id);
      const existing = requireMethod(questionBank, 'getQuestion')(sqlite, id, tenantId);
      if (!existing) throw mutationError('AUTHORITY_COMMAND_TARGET_NOT_FOUND', 404);
      checkExpectedVersion(existing, envelope.payload.expectedVersion);
      if (action === 'update') {
        const changes = selectedFields(envelope.payload.changes, QUESTION_FIELDS);
        if (existing.storage_state === 'host_committed') {
          return requireMethod(questionStorageService, 'updateCommittedQuestion')(
            id,
            {
              db: sqlite,
              tenantId,
              payload: changes,
              operationId: envelope.commandId,
              internalCredential,
            },
          );
        }
        return requireMethod(questionBank, 'updateQuestion')(sqlite, id, changes, tenantId);
      }
      if (existing.storage_state === 'host_committed') {
        return requireMethod(questionStorageService, 'deleteCommittedQuestion')(
          id,
          {
            db: sqlite,
            tenantId,
            operationId: envelope.commandId,
            internalCredential,
          },
        );
      }
      return {
        id,
        deleted: Boolean(requireMethod(questionBank, 'deleteQuestion')(
          sqlite,
          id,
          tenantId,
          {
            userApproved: true,
            deviceId: envelope.actor?.deviceId,
            userId: authorization.scope?.userId,
            sourceDeviceId: existing.source_device_id,
            ownerUserId: existing.owner_user_id,
            storageState: existing.storage_state || 'local_draft',
          },
        )),
      };
    };
  }

  for (const entity of ['taxonomy-system', 'taxonomy-node']) {
    const fields = entity === 'taxonomy-system' ? TAXONOMY_SYSTEM_FIELDS : TAXONOMY_NODE_FIELDS;
    for (const action of ['create', 'update', 'delete']) {
      handlers[`${entity}.${action}.v1`] = (envelope, authorization = {}) => {
        if (!isAdmin(authorization.scope)) {
          throw mutationError('AUTHORITY_COMMAND_SCOPE_FORBIDDEN', 403);
        }
        if (!questionBank) throw mutationError('AUTHORITY_QUESTION_SERVICE_REQUIRED', 500);
        if (action === 'create') {
          const id = requiredId(envelope?.payload?.record?.id);
          const record = selectedFields(envelope.payload.record, fields, { allowId: true });
          const result = entity === 'taxonomy-system'
            ? requireMethod(questionBank, 'createTaxonomySystem')(sqlite, { id, ...record }, tenantId)
            : requireMethod(questionBank, 'createTaxonomyNode')(
              sqlite,
              requiredId(record.system_id),
              { id, ...record },
              tenantId,
            );
          if (String(result?.id || '') !== id) {
            throw mutationError('AUTHORITY_COMMAND_CREATE_ID_MISMATCH', 500);
          }
          return result;
        }
        const id = requiredId(envelope?.payload?.id);
        const row = sqlite.prepare(
          `SELECT * FROM ${entity === 'taxonomy-system' ? 'taxonomy_systems' : 'taxonomy_nodes'}
           WHERE id=? AND tenant_id=? AND deleted=0`
        ).get(id, tenantId);
        if (!row) throw mutationError('AUTHORITY_COMMAND_TARGET_NOT_FOUND', 404);
        checkExpectedVersion(row, envelope.payload.expectedVersion);
        if (action === 'update') {
          const changes = selectedFields(envelope.payload.changes, fields);
          return entity === 'taxonomy-system'
            ? requireMethod(questionBank, 'updateTaxonomySystem')(sqlite, id, changes, tenantId)
            : requireMethod(questionBank, 'updateTaxonomyNode')(
              sqlite,
              row.system_id,
              id,
              changes,
              tenantId,
            );
        }
        const confirmation = envelope.payload.confirmation || {};
        const options = {
          confirmed: confirmation.confirmed === true,
          expectedAffectedQuestionCount: Number(confirmation.expectedAffectedQuestionCount),
          actor: authorization.scope?.userId,
        };
        return entity === 'taxonomy-system'
          ? requireMethod(questionBank, 'deleteTaxonomySystem')(sqlite, id, tenantId, options)
          : requireMethod(questionBank, 'deleteTaxonomyNode')(
            sqlite,
            row.system_id,
            id,
            tenantId,
            options,
          );
      };
    }
  }

  for (const [type, method] of Object.entries({
    'personal-asset-record.create.v1': 'create',
    'personal-asset-record.update.v1': 'update',
    'personal-asset-record.delete.v1': 'delete',
    'personal-asset-category.create.v1': 'createCategory',
    'personal-asset-category.delete.v1': 'deleteCategory',
  })) {
    handlers[type] = (envelope, authorization = {}) => {
      if (!USER_ROLES.has(String(authorization.scope?.kind || ''))) {
        throw mutationError('AUTHORITY_COMMAND_SCOPE_FORBIDDEN', 403);
      }
      if (!personalAssetRecordService) {
        throw mutationError('AUTHORITY_ASSET_RECORD_SERVICE_REQUIRED', 500);
      }
      return requireMethod(personalAssetRecordService, method)({
        ...envelope.payload,
        authorityId: envelope.authorityId,
        actor: {
          userId: authorization.scope?.userId,
          roles: [authorization.scope?.kind],
        },
      });
    };
  }

  return Object.freeze(handlers);
}

module.exports = {
  BUSINESS_COMMAND_TYPES,
  createAuthorityBusinessMutationHandlers,
  isAuthorityBusinessCommandAllowed,
  mutationError,
};
