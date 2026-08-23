const ENTITY_COLLECTIONS = Object.freeze({
  student: 'students',
  course: 'courses',
  schedule: 'schedules',
  payment: 'payments',
  consumption: 'consumptions',
  teacher: 'teachers',
  grade: 'grades',
  room: 'rooms',
  institution: 'institutions',
  question: 'questions',
  'taxonomy-system': 'taxonomy_systems',
  'taxonomy-node': 'taxonomy_nodes',
  'personal-asset-record': 'assetRecords',
  'personal-asset-category': 'assetCategories',
});
const LOCAL_ONLY_KEYS = Object.freeze([
  'questionBasketIds',
  'questionVersions',
  'importTasks',
  'importTaskItems',
]);

function cacheError(code) {
  return Object.assign(new Error(code), { code });
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function array(value) {
  return Array.isArray(value) ? clone(value) : [];
}

function parsedJson(value, fallback) {
  if (value === undefined || value === null || value === '') return clone(fallback);
  if (typeof value !== 'string') return clone(value);
  try {
    return JSON.parse(value);
  } catch (_error) {
    return clone(fallback);
  }
}

function normalizeCourse(row = {}) {
  return {
    ...clone(row),
    student_pricings: parsedJson(row.student_pricings, []),
    active: row.active === undefined ? true : Boolean(row.active),
  };
}

function normalizeSchedule(row = {}) {
  return {
    ...clone(row),
    student_ids: parsedJson(row.student_ids, []),
    student_pricings: parsedJson(row.student_pricings, []),
  };
}

function normalizeQuestion(row = {}) {
  const question = {
    ...clone(row),
    content: row.content ?? row.stem ?? '',
    stem: row.stem ?? row.content ?? '',
    options: parsedJson(row.options ?? row.options_json, []),
    rich_content: parsedJson(row.rich_content ?? row.rich_content_json, null),
    taxonomy_ids: parsedJson(row.taxonomy_ids ?? row.taxonomy_json, {}),
    sourceDeviceId: row.sourceDeviceId ?? row.source_device_id,
    ownerUserId: row.ownerUserId ?? row.owner_user_id,
    has_image: Boolean(row.has_image),
    has_formula: Boolean(row.has_formula),
  };
  delete question.options_json;
  delete question.rich_content_json;
  delete question.taxonomy_json;
  return question;
}

function normalizeAssetRecord(row = {}) {
  return {
    id: row.id,
    account_id: row.accountId ?? row.account_id,
    date: row.date,
    type: row.type,
    category_id: row.categoryId ?? row.category_id,
    category_name: row.categoryName ?? row.category_name,
    amount: Number(row.amount || 0),
    student_id: row.studentId ?? row.student_id,
    student_name: row.studentName ?? row.student_name,
    note: row.note || undefined,
    created_at: row.createdAt ?? row.created_at,
    updated_at: row.updatedAt ?? row.updated_at,
  };
}

function normalizeAssetCategory(row = {}) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    color: row.color || undefined,
    created_at: row.createdAt ?? row.created_at,
    updated_at: row.updatedAt ?? row.updated_at,
  };
}

function collectionRows(payload, key) {
  if (key === 'taxonomy_systems') return array(payload.taxonomySystems || payload.taxonomy_systems);
  if (key === 'taxonomy_nodes') return array(payload.taxonomyNodes || payload.taxonomy_nodes);
  return array(payload[key]);
}

function normalizeForCollection(collection, record) {
  if (collection === 'courses') return normalizeCourse(record);
  if (collection === 'schedules') return normalizeSchedule(record);
  if (collection === 'questions') return normalizeQuestion(record);
  if (collection === 'assetRecords') return normalizeAssetRecord(record);
  if (collection === 'assetCategories') return normalizeAssetCategory(record);
  return clone(record);
}

function applyDelete(cache, collection, id) {
  if (collection === 'taxonomy_systems') {
    cache.taxonomy_systems = cache.taxonomy_systems.filter(row => String(row.id) !== id);
    cache.taxonomy_nodes = cache.taxonomy_nodes.filter(row => String(row.system_id) !== id);
    for (const question of cache.questions) {
      if (question.taxonomy_ids) delete question.taxonomy_ids[id];
    }
    return;
  }
  if (collection === 'taxonomy_nodes') {
    const removed = new Set([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const node of cache.taxonomy_nodes) {
        if (!removed.has(String(node.id)) && removed.has(String(node.parent_id || ''))) {
          removed.add(String(node.id));
          changed = true;
        }
      }
    }
    cache.taxonomy_nodes = cache.taxonomy_nodes.filter(row => !removed.has(String(row.id)));
    for (const question of cache.questions) {
      for (const systemId of Object.keys(question.taxonomy_ids || {})) {
        question.taxonomy_ids[systemId] = (question.taxonomy_ids[systemId] || [])
          .filter(nodeId => !removed.has(String(nodeId)));
      }
    }
    return;
  }
  cache[collection] = cache[collection].filter(row => String(row.id) !== id);
}

function applyDraft(cache, item) {
  const match = /^(.+)\.(create|update|delete)\.v1$/.exec(String(item?.type || ''));
  if (!match) return;
  const [, entity, action] = match;
  const collection = ENTITY_COLLECTIONS[entity];
  if (!collection || !Array.isArray(cache[collection])) return;
  const payload = item.payload || {};
  if (action === 'create') {
    const record = normalizeForCollection(collection, payload.record || {});
    const id = String(record?.id || '').trim();
    if (!id) return;
    const index = cache[collection].findIndex(row => String(row.id) === id);
    if (index === -1) cache[collection].push(record);
    else cache[collection][index] = { ...cache[collection][index], ...record };
    return;
  }
  const id = String(payload.id || '').trim();
  if (!id) return;
  if (action === 'delete') {
    applyDelete(cache, collection, id);
    return;
  }
  const index = cache[collection].findIndex(row => String(row.id) === id);
  if (index === -1) return;
  cache[collection][index] = normalizeForCollection(collection, {
    ...cache[collection][index],
    ...(payload.changes || {}),
  });
}

export function buildAuthorityBackedBrowserCache({
  projection,
  outbox = [],
  localOnly = {},
} = {}) {
  if (projection?.protocol !== 'gewu.authority-projection.v1'
    || !projection.payload || typeof projection.payload !== 'object'
    || !Number.isSafeInteger(Number(projection.sourceVersion))) {
    throw cacheError('AUTHORITY_PROJECTION_CACHE_INVALID');
  }
  const payload = projection.payload;
  const cache = {
    students: collectionRows(payload, 'students'),
    student_contacts: collectionRows(payload, 'student_contacts'),
    grades: collectionRows(payload, 'grades'),
    courses: collectionRows(payload, 'courses').map(normalizeCourse),
    schedules: collectionRows(payload, 'schedules').map(normalizeSchedule),
    enrollments: collectionRows(payload, 'enrollments'),
    payments: collectionRows(payload, 'payments'),
    consumptions: collectionRows(payload, 'consumptions'),
    institutions: collectionRows(payload, 'institutions'),
    schools: collectionRows(payload, 'schools'),
    rooms: collectionRows(payload, 'rooms'),
    teachers: collectionRows(payload, 'teachers'),
    assetRecords: collectionRows(payload, 'assetRecords').map(normalizeAssetRecord),
    assetCategories: collectionRows(payload, 'assetCategories').map(normalizeAssetCategory),
    questions: collectionRows(payload, 'questions').map(normalizeQuestion),
    taxonomy_systems: collectionRows(payload, 'taxonomy_systems'),
    taxonomy_nodes: collectionRows(payload, 'taxonomy_nodes'),
    knowledgeTree: [],
    modelTree: [],
    taxonomySystems: [],
    taxonomyInitialized: true,
    tags: [],
    questionTagRels: [],
    authorityCacheMetadata: {
      authorityId: projection.authorityId,
      hostEpochId: projection.hostEpochId,
      userId: projection.userId,
      role: projection.role,
      sourceVersion: Number(projection.sourceVersion),
    },
  };
  for (const key of LOCAL_ONLY_KEYS) cache[key] = array(localOnly[key]);
  const pending = array(outbox)
    .filter(item => item && item.status !== 'completed')
    .sort((left, right) => (
      String(left.createdAt || left.updatedAt || '').localeCompare(
        String(right.createdAt || right.updatedAt || ''),
      )
    ));
  for (const item of pending) applyDraft(cache, item);
  return cache;
}

export { cacheError };
