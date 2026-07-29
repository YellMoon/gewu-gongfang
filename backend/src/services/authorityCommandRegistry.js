const SCHEDULE_TEACHER_FIELDS = new Set([
  'start_time',
  'end_time',
  'recurring_rule',
  'status',
  'room',
  'service_type',
  'student_ids',
  'student_pricings',
  'notes',
]);
const SCHEDULE_ADMIN_FIELDS = new Set([
  ...SCHEDULE_TEACHER_FIELDS,
  'course_id',
  'calculated_tuition',
  'calculated_teacher_fee',
]);
const COURSE_ADMIN_FIELDS = new Set([
  'name',
  'year',
  'semester',
  'display_name',
  'type',
  'source_type',
  'institution_id',
  'price_tuition',
  'price_teacher',
  'billing_unit',
  'teacher_fee_mode',
  'room_id',
  'room_name',
  'teacher_id',
  'teacher_name',
  'active',
  'default_duration_minutes',
  'notes',
]);

function registryError(code, statusCode = 403) {
  return Object.assign(new Error(code), { code, statusCode });
}

function filteredChanges(input, allowed) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw registryError('AUTHORITY_COMMAND_PAYLOAD_INVALID', 400);
  }
  const keys = Object.keys(input);
  if (keys.length === 0) throw registryError('AUTHORITY_COMMAND_PAYLOAD_INVALID', 400);
  if (keys.some(key => !allowed.has(key))) {
    throw registryError('AUTHORITY_COMMAND_FIELD_FORBIDDEN');
  }
  return Object.fromEntries(keys.map(key => [key, input[key]]));
}

function isAuthorityAdmin(scope = {}) {
  return scope.kind === 'admin' || scope.kind === 'super_admin';
}

function createAuthorityCommandPolicy() {
  return ({ type, scope } = {}) => {
    if (isAuthorityBusinessCommandAllowed({ type, scope })) return true;
    if (type === 'role-application.submit.v1') {
      return ['visitor', 'student', 'teacher'].includes(scope?.kind);
    }
    if (type === 'role-application.review.v1') return scope?.kind === 'super_admin';
    if (type === 'personal-asset-account.create.v1'
      || type === 'personal-asset-account.update.v1') {
      return ['visitor', 'student', 'teacher', 'admin', 'super_admin'].includes(scope?.kind);
    }
    if (type === 'projection.read.v1') {
      return ['visitor', 'student', 'teacher', 'admin', 'super_admin'].includes(scope?.kind);
    }
    return false;
  };
}

function createAuthorityCommandHandlers({
  database,
  questionBank,
  questionStorageService,
  roleApplicationService,
  personalAssetAccountService,
  personalAssetRecordService,
} = {}) {
  if (!database) {
    throw registryError('AUTHORITY_COMMAND_DATABASE_REQUIRED', 500);
  }
  const handlers = {
    ...createAuthorityBusinessMutationHandlers({
      database,
      questionBank,
      questionStorageService,
      personalAssetRecordService,
    }),
  };
  if (roleApplicationService) {
    handlers['role-application.submit.v1'] = (envelope, authorization = {}) => {
      const requestedRole = String(envelope?.payload?.requestedRole || '').trim();
      if (!requestedRole) throw registryError('AUTHORITY_COMMAND_PAYLOAD_INVALID', 400);
      return roleApplicationService.submit({
        authorityId: envelope.authorityId,
        userId: authorization.scope?.userId,
        requestedRole,
        bindingHint: envelope.payload.bindingHint,
      });
    };
    handlers['role-application.review.v1'] = (envelope, authorization = {}) => {
      const applicationId = String(envelope?.payload?.applicationId || '').trim();
      const decision = String(envelope?.payload?.decision || '').trim();
      if (!applicationId || !['approve', 'reject'].includes(decision)) {
        throw registryError('AUTHORITY_COMMAND_PAYLOAD_INVALID', 400);
      }
      const input = {
        actor: {
          userId: authorization.scope?.userId,
          roles: [authorization.scope?.kind],
        },
        applicationId,
      };
      return decision === 'approve'
        ? roleApplicationService.approve(input)
        : roleApplicationService.reject(input);
    };
  }
  if (personalAssetAccountService) {
    handlers['personal-asset-account.create.v1'] = (envelope, authorization = {}) => (
      personalAssetAccountService.create({
        ...envelope.payload,
        authorityId: envelope.authorityId,
        actor: {
          userId: authorization.scope?.userId,
          roles: [authorization.scope?.kind],
        },
      })
    );
    handlers['personal-asset-account.update.v1'] = (envelope, authorization = {}) => {
      const accountId = String(envelope?.payload?.accountId || '').trim();
      if (!accountId || !envelope.payload.changes) {
        throw registryError('AUTHORITY_COMMAND_PAYLOAD_INVALID', 400);
      }
      return personalAssetAccountService.update({
        actor: {
          userId: authorization.scope?.userId,
          roles: [authorization.scope?.kind],
        },
        accountId,
        changes: envelope.payload.changes,
      });
    };
  }
  return Object.freeze(handlers);
}

module.exports = {
  createAuthorityCommandHandlers,
  createAuthorityCommandPolicy,
  registryError,
};
const {
  createAuthorityBusinessMutationHandlers,
  isAuthorityBusinessCommandAllowed,
} = require('./authorityBusinessMutationService');
