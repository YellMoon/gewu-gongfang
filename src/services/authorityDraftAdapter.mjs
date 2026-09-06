function draftError(code) {
  return Object.assign(new Error(code), { code });
}

const COLLECTIONS = Object.freeze({
  students: {
    entity: 'student',
    fields: [
      'name', 'phone', 'parent_phone', 'parent_relation', 'school', 'grade_year',
      'grade_current', 'source_type', 'institution_id', 'is_institution_student',
      'parent_name', 'parent_wechat', 'student_source', 'balance_hours',
      'balance_money', 'notes', 'contacts',
    ],
  },
  courses: {
    entity: 'course',
    fields: [
      'name', 'year', 'semester', 'display_name', 'type', 'source_type',
      'institution_id', 'price_tuition', 'price_teacher', 'billing_unit',
      'teacher_fee_mode', 'student_pricings', 'room_id', 'room_name', 'teacher_id',
      'teacher_name', 'active', 'default_duration_minutes', 'notes',
    ],
  },
  schedules: {
    entity: 'schedule',
    fields: [
      'course_id', 'start_time', 'end_time', 'recurring_rule', 'status', 'room',
      'service_type', 'student_ids', 'student_pricings', 'calculated_tuition',
      'calculated_teacher_fee', 'notes',
    ],
  },
  payments: {
    entity: 'payment',
    fields: [
      'student_id', 'amount', 'payment_type', 'payment_date', 'payment_method',
      'notes',
    ],
  },
  consumptions: {
    entity: 'consumption',
    fields: [
      'schedule_id', 'student_id', 'hours', 'amount', 'consumption_date', 'notes',
    ],
  },
  teachers: {
    entity: 'teacher',
    fields: [
      'name', 'phone', 'subject', 'hourly_rate', 'notes',
    ],
  },
  grades: {
    entity: 'grade',
    fields: [
      'student_id', 'subject', 'score', 'exam_date', 'notes',
    ],
  },
  rooms: {
    entity: 'room',
    fields: [
      'name', 'address',
    ],
  },
  institutions: {
    entity: 'institution',
    fields: [
      'name', 'contact_person', 'contact_phone', 'revenue_share', 'notes',
    ],
  },
  schools: {
    entity: 'school',
    fields: ['name', 'count'],
  },
  assetRecords: {
    entity: 'personal-asset-record',
    fields: [
      'account_id', 'date', 'type', 'category_id', 'category_name', 'amount',
      'student_id', 'student_name', 'note',
    ],
  },
  assetCategories: {
    entity: 'personal-asset-category',
    fields: ['name', 'type', 'color'],
  },
  questions: {
    entity: 'question',
    fields: [
      'subject', 'subject_id', 'chapter_id', 'type', 'difficulty', 'status',
      'content', 'stem', 'options', 'answer', 'analysis', 'explanation',
      'rich_content', 'knowledge_point_ids', 'model_point_ids', 'taxonomy_ids',
      'source', 'year', 'grade', 'semester', 'exam_type', 'region', 'school',
      'edit_status', 'has_image', 'has_formula',
      'import_task_id', 'import_item_id', 'import_item_index', 'import_content_hash',
    ],
  },
  taxonomy_systems: {
    entity: 'taxonomy-system',
    fields: ['subject', 'name', 'sort_order'],
  },
  taxonomy_nodes: {
    entity: 'taxonomy-node',
    fields: [
      'system_id', 'parent_id', 'name', 'sort_order',
    ],
  },
});

function requiredId(value) {
  const id = String(value || '').trim();
  if (!id || id.length > 128) throw draftError('AUTHORITY_DRAFT_RECORD_ID_INVALID');
  return id;
}

function selectedFields(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw draftError('AUTHORITY_DRAFT_VALUE_INVALID');
  }
  const selected = {};
  for (const field of allowed) {
    if (Object.prototype.hasOwnProperty.call(value, field)
      && value[field] !== undefined) {
      selected[field] = JSON.parse(JSON.stringify(value[field]));
    }
  }
  return selected;
}

function appendExpectedVersion(payload, definition, baseVersion) {
  if (definition.entity === 'question') {
    if (Number.isSafeInteger(baseVersion) && baseVersion > 0) payload.expectedVersion = baseVersion;
    return;
  }
  const expectedVersion = String(baseVersion || '').trim();
  if (expectedVersion) payload.expectedVersion = expectedVersion;
}

/**
 * @param {{
 *   collection?: string;
 *   action?: string;
 *   recordId?: string;
 *   value?: Record<string, unknown>;
 *   baseVersion?: string | number | null;
 * }} input
 */
export function createAuthorityDraftFromLocalMutation({
  collection,
  action,
  recordId,
  value = {},
  baseVersion = null,
} = {}) {
  const definition = COLLECTIONS[String(collection || '')];
  if (!definition) throw draftError('AUTHORITY_DRAFT_COLLECTION_UNSUPPORTED');
  const normalizedAction = String(action || '').trim();
  if (!['create', 'update', 'delete'].includes(normalizedAction)) {
    throw draftError('AUTHORITY_DRAFT_ACTION_UNSUPPORTED');
  }
  const id = requiredId(recordId);
  let payload;
  if (normalizedAction === 'delete') {
    payload = { id };
    appendExpectedVersion(payload, definition, baseVersion);
    if (definition.entity === 'taxonomy-system' || definition.entity === 'taxonomy-node') {
      if (definition.entity === 'taxonomy-node') payload.systemId = requiredId(value?.system_id);
      const confirmation = value?._taxonomy_delete_confirmation;
      const expectedAffectedQuestionCount = Number(
        confirmation?.expected_affected_question_count,
      );
      if (confirmation?.confirmed === true
        && Number.isInteger(expectedAffectedQuestionCount)
        && expectedAffectedQuestionCount >= 0) {
        payload.confirmation = {
          confirmed: true,
          expectedAffectedQuestionCount,
        };
      }
    }
  } else {
    const fields = selectedFields(value, definition.fields);
    if (Object.keys(fields).length === 0) {
      throw draftError('AUTHORITY_DRAFT_FIELDS_EMPTY');
    }
    if (normalizedAction === 'create') {
      payload = { record: { id, ...fields } };
    } else {
      payload = { id, changes: fields };
      appendExpectedVersion(payload, definition, baseVersion);
    }
  }
  return Object.freeze({
    type: `${definition.entity}.${normalizedAction}.v1`,
    payload: Object.freeze(payload),
    preview: Object.freeze({
      title: `${definition.entity}.${normalizedAction}`,
      summary: id,
    }),
  });
}

export { draftError };
