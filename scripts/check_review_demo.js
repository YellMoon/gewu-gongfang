'use strict';

const { validateReviewExperienceCode } = require('./check_miniapp_review_readiness');

const DOCX_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const PDF_SIGNATURE = Buffer.from('%PDF', 'ascii');
const ROLES = Object.freeze(['admin', 'student']);
const EXPECTED_CAPABILITIES = Object.freeze(['review-demo:read', 'question-bank:view', 'review-demo:paper-export']);
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_ARTIFACT_BYTES = 16 * 1024 * 1024;

const SNAPSHOT_ALLOWED_FIELDS = Object.freeze({
  students: ['id', 'name', 'school', 'grade_year', 'grade_current', 'source_type', 'institution_id', 'balance_hours', 'balance_money', 'created_at', 'updated_at'],
  teachers: ['id', 'name', 'subject', 'hourly_rate', 'created_at', 'updated_at'],
  institutions: ['id', 'name', 'revenue_share', 'created_at'],
  schools: ['id', 'name', 'count', 'created_at', 'updated_at'],
  rooms: ['id', 'name', 'address', 'count', 'created_at', 'updated_at'],
  courses: ['id', 'name', 'display_name', 'type', 'source_type', 'year', 'semester', 'teacher_id', 'teacher_name', 'institution_id', 'room_id', 'room_name', 'price_tuition', 'price_teacher', 'billing_unit', 'teacher_fee_mode', 'student_ids', 'student_pricings', 'active', 'default_duration_minutes', 'created_at', 'updated_at'],
  schedules: ['id', 'course_id', 'start_time', 'end_time', 'status', 'room_id', 'room', 'service_type', 'student_ids', 'student_pricings', 'calculated_tuition', 'calculated_teacher_fee', 'created_at', 'updated_at'],
  enrollments: ['id', 'schedule_id', 'student_id', 'hours_consumed', 'status', 'created_at'],
  consumptions: ['id', 'schedule_id', 'student_id', 'hours', 'amount', 'consumption_date', 'created_at'],
  payments: ['id', 'student_id', 'amount', 'payment_type', 'payment_date', 'payment_method', 'notes', 'created_at'],
  assetRecords: ['id', 'name', 'amount', 'category_id', 'type', 'date', 'notes', 'created_at'],
  assetCategories: ['id', 'name', 'type', 'color'],
  questions: ['id', 'type', 'status', 'difficulty', 'stemPreview'],
});

const ADMIN_SNAPSHOT_IDS = Object.freeze({
  students: ['review-demo-student', 'review-demo-student-2'],
  teachers: ['review-demo-teacher'],
  institutions: ['review-demo-institution'],
  schools: ['review-demo-school'],
  rooms: ['review-demo-room'],
  courses: ['review-demo-course', 'review-demo-course-2'],
  schedules: ['review-demo-schedule', 'review-demo-schedule-2'],
  enrollments: ['review-demo-enrollment', 'review-demo-enrollment-2'],
  consumptions: ['review-demo-consumption'],
  payments: ['review-demo-payment'],
  assetRecords: ['review-demo-asset'],
  assetCategories: ['review-demo-asset-category'],
  questions: ['review-q-1', 'review-q-2', 'review-q-3', 'review-q-4'],
});

const STUDENT_SNAPSHOT_IDS = Object.freeze({
  ...ADMIN_SNAPSHOT_IDS,
  students: ['review-demo-student'],
  courses: ['review-demo-course'],
  schedules: ['review-demo-schedule'],
  enrollments: ['review-demo-enrollment'],
  consumptions: [],
  payments: [],
  assetRecords: [],
  assetCategories: [],
});

class SmokeFailure extends Error {
  constructor(message) {
    super(message);
    this.name = 'SmokeFailure';
  }
}

function fail(message) {
  throw new SmokeFailure(message);
}

function requireCondition(value, message) {
  if (!value) fail(message);
}

function loadSmokeConfig(env = process.env) {
  const rawBaseUrl = String(env.MINIAPP_REVIEW_BASE_URL || '').trim();
  const rawRealBaseUrl = String(env.MINIAPP_REAL_API_BASE_URL || '').trim();
  const codeValidation = validateReviewExperienceCode(env);
  let parsed;
  let parsedReal;
  try {
    parsed = new URL(rawBaseUrl);
    parsedReal = new URL(rawRealBaseUrl);
  } catch (_error) {
    throw new SmokeFailure('review smoke configuration is invalid');
  }
  const baseUrl = rawBaseUrl.replace(/\/+$/, '');
  const realBaseUrl = rawRealBaseUrl.replace(/\/+$/, '');
  const validUrl = parsed.protocol === 'https:'
    && Boolean(parsed.hostname)
    && !parsed.username
    && !parsed.password
    && !parsed.search
    && !parsed.hash
    && baseUrl === parsed.origin;
  const validRealUrl = (
    parsedReal.protocol === 'https:'
    && Boolean(parsedReal.hostname)
    && !parsedReal.username
    && !parsedReal.password
    && !parsedReal.search
    && !parsedReal.hash
    && parsedReal.origin === parsed.origin
    && realBaseUrl === `${parsed.origin}/scheduling`
  );
  if (!validUrl || !validRealUrl || !codeValidation.ok) {
    throw new SmokeFailure('review smoke configuration is invalid');
  }
  return {
    baseUrl,
    realBaseUrl,
    experienceCode: String(env.MINIAPP_REVIEW_EXPERIENCE_CODE),
  };
}

function sanitizeFailure(error) {
  if (error instanceof SmokeFailure) return `review demo smoke failed: ${error.message}`;
  return 'review demo smoke failed: unexpected error';
}

function endpoint(baseUrl, route) {
  return `${baseUrl}${route.startsWith('/') ? route : `/${route}`}`;
}

function boundedRequest(options = {}) {
  return { ...options, signal: options.signal || AbortSignal.timeout(REQUEST_TIMEOUT_MS) };
}

async function readBoundedBody(response, maximumBytes, step) {
  const reader = response?.body?.getReader?.();
  requireCondition(reader && typeof reader.read === 'function' && typeof reader.cancel === 'function', `${step}: streaming response body required`);
  const rawLength = response.headers?.get?.('content-length');
  if (rawLength !== null && rawLength !== undefined && rawLength !== '') {
    requireCondition(/^\d+$/.test(String(rawLength)), `${step}: invalid content length`);
    const declaredLength = Number(rawLength);
    requireCondition(Number.isSafeInteger(declaredLength), `${step}: invalid content length`);
    if (declaredLength > maximumBytes) {
      try { await reader.cancel(); } catch (_error) { /* best effort */ }
      try { reader.releaseLock?.(); } catch (_error) { /* best effort */ }
      fail(`${step}: response body exceeds limit`);
    }
  }

  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value || []);
      total += chunk.length;
      if (total > maximumBytes) {
        try { await reader.cancel(); } catch (_error) { /* best effort */ }
        fail(`${step}: response body exceeds limit`);
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof SmokeFailure) throw error;
    try { await reader.cancel(); } catch (_error) { /* best effort */ }
    fail(`${step}: response body read failed`);
  } finally {
    try { reader.releaseLock?.(); } catch (_error) { /* best effort */ }
  }
  return Buffer.concat(chunks, total);
}

async function readBoundedJsonBody(response, step) {
  return readBoundedBody(response, MAX_JSON_BYTES, step);
}

async function readBoundedArtifactBody(response, step) {
  return readBoundedBody(response, MAX_ARTIFACT_BYTES, step);
}

async function safeJson(response, step) {
  try {
    const contentType = String(response.headers?.get?.('content-type') || '').split(';')[0].trim().toLowerCase();
    requireCondition(contentType === 'application/json', `${step}: invalid JSON content type`);
    const bytes = await readBoundedJsonBody(response, step);
    const body = JSON.parse(bytes.toString('utf8'));
    requireCondition(body && typeof body === 'object' && !Array.isArray(body), `${step}: invalid JSON contract`);
    return body;
  } catch (error) {
    if (error instanceof SmokeFailure) throw error;
    fail(`${step}: invalid JSON contract`);
  }
}

async function requestJson(fetchImpl, baseUrl, route, options, expectedStatus, step) {
  let response;
  try {
    response = await fetchImpl(endpoint(baseUrl, route), boundedRequest(options));
  } catch (_error) {
    fail(`${step}: network request failed`);
  }
  requireCondition(response && Number(response.status) === expectedStatus, `${step}: unexpected HTTP status`);
  return safeJson(response, step);
}

function authHeaders(token, json = false) {
  return {
    authorization: `Bearer ${token}`,
    ...(json ? { 'content-type': 'application/json' } : {}),
  };
}

function assertNoSensitiveKeys(value, step) {
  const forbidden = new Set(['phone', 'phone_normalized', 'openid', 'unionid', 'id_card', 'identity_card']);
  const visit = current => {
    if (Array.isArray(current)) return current.forEach(visit);
    if (!current || typeof current !== 'object') return;
    for (const [key, nested] of Object.entries(current)) {
      requireCondition(!forbidden.has(String(key).toLowerCase()), `${step}: sensitive field present`);
      visit(nested);
    }
  };
  visit(value);
}

function assertNoSensitiveValues(value, step) {
  const visit = current => {
    if (Array.isArray(current)) return current.forEach(visit);
    if (current && typeof current === 'object') return Object.values(current).forEach(visit);
    if (typeof current !== 'string') return;
    requireCondition(!/(?:^|\D)1[3-9]\d{9}(?:\D|$)/.test(current), `${step}: phone-like value present`);
    requireCondition(!/(?:^|\D)\d{17}[\dXx](?:\D|$)/.test(current), `${step}: identity-like value present`);
  };
  visit(value);
}

function assertAllowedFields(item, collection, step) {
  requireCondition(item && typeof item === 'object' && !Array.isArray(item), `${step}: invalid item`);
  const allowed = new Set(SNAPSHOT_ALLOWED_FIELDS[collection]);
  for (const key of Object.keys(item)) {
    requireCondition(allowed.has(key), `${step}: unexpected field`);
  }
}

function assertExactIds(items, expectedIds, step) {
  const actualIds = items.map(item => item?.id);
  requireCondition(JSON.stringify(actualIds) === JSON.stringify(expectedIds), `${step}: deterministic ids mismatch`);
}

function assertReference(collection, id, allowedIds, step) {
  requireCondition(typeof id === 'string' && allowedIds.has(id), `${step}: invalid ${collection} reference`);
}

function assertStudentPricings(items, studentIds, step) {
  requireCondition(Array.isArray(items), `${step}: student pricings missing`);
  for (const pricing of items) {
    requireCondition(pricing && typeof pricing === 'object' && !Array.isArray(pricing), `${step}: invalid student pricing`);
    const keys = Object.keys(pricing);
    requireCondition(keys.every(key => ['student_id', 'tuition', 'teacher_fee', 'status'].includes(key)), `${step}: unexpected student pricing field`);
    requireCondition(pricing.status === 1, `${step}: invalid student pricing status`);
    assertReference('student', pricing.student_id, studentIds, step);
  }
}

function assertLoginContract(body, role) {
  const data = body.data;
  requireCondition(body.success === true && data && typeof data === 'object', `${role} login: invalid response`);
  requireCondition(typeof data.token === 'string' && data.token.length > 20, `${role} login: token missing`);
  requireCondition(data.role === role, `${role} login: role mismatch`);
  requireCondition(data.user?.user_type === role, `${role} login: user role mismatch`);
  requireCondition(data.user?.is_review_demo === true && data.user?.read_only === true, `${role} login: review flags missing`);
  requireCondition(String(data.user?.id || '').startsWith(`review-demo:${role}:`), `${role} login: synthetic identity mismatch`);
  requireCondition(Boolean(data.user?.review_demo_session_id), `${role} login: session id missing`);
  if (role === 'student') {
    requireCondition(data.user.student_id === 'review-demo-student', 'student login: linked sample mismatch');
    requireCondition(
      Array.isArray(data.user.linked_student_ids)
        && data.user.linked_student_ids.length === 1
        && data.user.linked_student_ids[0] === 'review-demo-student',
      'student login: linked sample scope mismatch',
    );
  }
  return { token: data.token, user: data.user };
}

function assertPermissions(body, role, user) {
  const capabilities = Array.isArray(body.capabilities) ? body.capabilities : [];
  const expected = new Set([...EXPECTED_CAPABILITIES, `review-demo:${role}`]);
  requireCondition(capabilities.length === expected.size && capabilities.every(value => expected.has(value)), `${role} permissions: capability mismatch`);
  const identity = body.identity;
  requireCondition(identity?.id === user.id && identity?.role === role, `${role} permissions: identity mismatch`);
  requireCondition(identity?.tenant_id === 'default', `${role} permissions: tenant mismatch`);
  requireCondition(identity?.review_status === 'approved' && identity?.status === 1, `${role} permissions: account state mismatch`);
  requireCondition(identity?.active === true && identity?.login_enabled === 1, `${role} permissions: active state mismatch`);
  requireCondition(identity?.is_review_demo === true && identity?.read_only === true, `${role} permissions: review flags missing`);
  requireCondition(identity?.review_demo_session_id === user.review_demo_session_id, `${role} permissions: session mismatch`);
  if (role === 'student') {
    requireCondition(identity.student_id === 'review-demo-student', 'student permissions: linked sample mismatch');
    requireCondition(
      Array.isArray(identity.linked_student_ids)
        && identity.linked_student_ids.length === 1
        && identity.linked_student_ids[0] === 'review-demo-student',
      'student permissions: linked sample scope mismatch',
    );
  }
}

function assertSnapshot(body, role) {
  requireCondition(body.success === true && body.snapshot?.version === 'review-demo-v1', `${role} snapshot: review version missing`);
  requireCondition(body.snapshot.id === `review-demo-${role}`, `${role} snapshot: scope id mismatch`);
  const payload = body.snapshot.payload;
  requireCondition(payload && typeof payload === 'object', `${role} snapshot: payload missing`);
  assertNoSensitiveKeys(payload, `${role} snapshot`);
  assertNoSensitiveValues(payload, `${role} snapshot`);

  const expectedIds = role === 'student' ? STUDENT_SNAPSHOT_IDS : ADMIN_SNAPSHOT_IDS;
  const expectedCollections = Object.keys(SNAPSHOT_ALLOWED_FIELDS);
  requireCondition(
    JSON.stringify(Object.keys(payload)) === JSON.stringify(expectedCollections),
    `${role} snapshot: collection whitelist mismatch`,
  );
  for (const collection of expectedCollections) {
    requireCondition(Array.isArray(payload[collection]), `${role} snapshot: ${collection} must be an array`);
    assertExactIds(payload[collection], expectedIds[collection], `${role} snapshot: ${collection}`);
    for (const item of payload[collection]) assertAllowedFields(item, collection, `${role} snapshot: ${collection}`);
  }

  const studentIds = new Set(expectedIds.students);
  const teacherIds = new Set(expectedIds.teachers);
  const institutionIds = new Set(expectedIds.institutions);
  const roomIds = new Set(expectedIds.rooms);
  const courseIds = new Set(expectedIds.courses);
  const scheduleIds = new Set(expectedIds.schedules);
  const categoryIds = new Set(expectedIds.assetCategories);

  for (const course of payload.courses) {
    requireCondition(course.active === true, `${role} snapshot: invalid course status`);
    assertReference('teacher', course.teacher_id, teacherIds, `${role} snapshot: course`);
    assertReference('institution', course.institution_id, institutionIds, `${role} snapshot: course`);
    assertReference('room', course.room_id, roomIds, `${role} snapshot: course`);
    requireCondition(Array.isArray(course.student_ids) && course.student_ids.length > 0, `${role} snapshot: course student scope missing`);
    course.student_ids.forEach(id => assertReference('student', id, studentIds, `${role} snapshot: course`));
    assertStudentPricings(course.student_pricings, studentIds, `${role} snapshot: course`);
  }
  const expectedScheduleStatus = role === 'student'
    ? { 'review-demo-schedule': 1 }
    : { 'review-demo-schedule': 1, 'review-demo-schedule-2': 2 };
  for (const schedule of payload.schedules) {
    requireCondition(schedule.status === expectedScheduleStatus[schedule.id], `${role} snapshot: invalid schedule status`);
    assertReference('course', schedule.course_id, courseIds, `${role} snapshot: schedule`);
    assertReference('room', schedule.room_id, roomIds, `${role} snapshot: schedule`);
    requireCondition(Array.isArray(schedule.student_ids) && schedule.student_ids.length > 0, `${role} snapshot: schedule student scope missing`);
    schedule.student_ids.forEach(id => assertReference('student', id, studentIds, `${role} snapshot: schedule`));
    assertStudentPricings(schedule.student_pricings, studentIds, `${role} snapshot: schedule`);
  }
  const expectedEnrollmentStatus = role === 'student'
    ? { 'review-demo-enrollment': 1 }
    : { 'review-demo-enrollment': 1, 'review-demo-enrollment-2': 2 };
  for (const enrollment of payload.enrollments) {
    requireCondition(enrollment.status === expectedEnrollmentStatus[enrollment.id], `${role} snapshot: invalid enrollment status`);
    assertReference('schedule', enrollment.schedule_id, scheduleIds, `${role} snapshot: enrollment`);
    assertReference('student', enrollment.student_id, studentIds, `${role} snapshot: enrollment`);
  }
  for (const consumption of payload.consumptions) {
    assertReference('schedule', consumption.schedule_id, scheduleIds, `${role} snapshot: consumption`);
    assertReference('student', consumption.student_id, studentIds, `${role} snapshot: consumption`);
  }
  for (const payment of payload.payments) assertReference('student', payment.student_id, studentIds, `${role} snapshot: payment`);
  for (const asset of payload.assetRecords) assertReference('asset category', asset.category_id, categoryIds, `${role} snapshot: asset`);
  for (const question of payload.questions) {
    requireCondition(question.status === 'published', `${role} snapshot: invalid question status`);
    requireCondition(String(question.stemPreview || '').includes('\u3010\u793a\u4f8b\u3011'), `${role} snapshot: unsanitized question`);
  }

  if (role === 'student') {
    requireCondition(payload.students[0].id === 'review-demo-student', 'student snapshot: linked sample scope mismatch');
    for (const schedule of payload.schedules) {
      requireCondition(schedule.student_ids.includes('review-demo-student'), 'student snapshot: schedule scope mismatch');
    }
  }
}

function assertQuestionPreview(body, role) {
  requireCondition(body.success === true && body.sandboxAvailable === true, `${role} questions: sandbox unavailable`);
  requireCondition(body.hostAvailable === false && body.targetHostDeviceId === null && body.hostBaseUrl === null, `${role} questions: real host leaked`);
  requireCondition(body.reviewDemoRole === role, `${role} questions: role scope mismatch`);
  requireCondition(Array.isArray(body.questions) && body.questions.length > 0, `${role} questions: examples missing`);
  for (const question of body.questions) {
    requireCondition(String(question.id || '').startsWith('review-q-'), `${role} questions: non-demo id`);
    for (const forbidden of ['answer', 'knowledgePoint', 'explanation', 'options']) {
      requireCondition(!(forbidden in question), `${role} questions: private answer field present`);
    }
  }
  return body.questions.map(question => question.id).slice(0, 2);
}

async function createSandboxTask(context, taskType, questionIds) {
  const body = await requestJson(
    context.fetchImpl,
    context.baseUrl,
    '/api/review-demo/tasks',
    {
      method: 'POST',
      headers: authHeaders(context.token, true),
      body: JSON.stringify({
        taskType,
        payload: {
          title: `Review ${context.role} smoke`,
          questionIds,
          answerPosition: 'end',
          formulaMode: taskType === 'paper-export-pdf' ? 'latex-vector' : 'word-native',
        },
      }),
    },
    200,
    `${context.role} ${taskType} create`,
  );
  requireCondition(body.success === true && body.task?.status === 'completed' && body.task?.id, `${context.role} ${taskType}: create contract mismatch`);
  const result = await requestJson(
    context.fetchImpl,
    context.baseUrl,
    `/api/review-demo/tasks/${encodeURIComponent(body.task.id)}/result`,
    { method: 'GET', headers: authHeaders(context.token) },
    200,
    `${context.role} ${taskType} read`,
  );
  requireCondition(result.success === true && result.task?.id === body.task.id && result.task?.status === 'completed', `${context.role} ${taskType}: read contract mismatch`);
  return result.task;
}

async function downloadArtifact(context, task, signature, expectedType, label) {
  const artifactId = task.result?.artifactId;
  requireCondition(Boolean(artifactId), `${context.role} ${label}: artifact id missing`);
  requireCondition(task.result.downloadPath === `/api/review-demo/artifacts/${artifactId}`, `${context.role} ${label}: download path mismatch`);
  let response;
  try {
    response = await context.fetchImpl(
      endpoint(context.baseUrl, `/api/review-demo/artifacts/${encodeURIComponent(artifactId)}`),
      boundedRequest({ method: 'GET', headers: authHeaders(context.token) }),
    );
  } catch (_error) {
    fail(`${context.role} ${label}: network request failed`);
  }
  requireCondition(response?.status === 200, `${context.role} ${label}: unexpected HTTP status`);
  requireCondition(String(response.headers?.get?.('content-type') || '').split(';')[0] === expectedType, `${context.role} ${label}: content type mismatch`);
  let bytes;
  try {
    bytes = await readBoundedArtifactBody(response, `${context.role} ${label}`);
  } catch (_error) {
    fail(`${context.role} ${label}: download failed`);
  }
  requireCondition(bytes.length >= signature.length && bytes.subarray(0, signature.length).equals(signature), `${context.role} ${label} signature mismatch`);
}

async function assertBackendIsolation({ role, realBaseUrl, fetchImpl, token }) {
  const permissions = await requestJson(fetchImpl, realBaseUrl, '/api/permissions/my', {
    method: 'GET', headers: authHeaders(token),
  }, 401, `${role} Backend permission bypass`);
  requireCondition(permissions.code === 'TOKEN_INVALID', `${role} Backend permission bypass: token type was not rejected`);

  const deniedRead = await requestJson(fetchImpl, realBaseUrl, '/api/question-bank/questions', {
    method: 'GET', headers: authHeaders(token),
  }, 401, `${role} Backend read bypass`);
  requireCondition(deniedRead.code === 'TOKEN_INVALID', `${role} Backend read bypass: review token was not rejected before anonymous question access`);

  const deniedWrite = await requestJson(fetchImpl, realBaseUrl, '/api/students', {
    method: 'POST', headers: authHeaders(token, true), body: JSON.stringify({ name: 'must-not-write' }),
  }, 401, `${role} Backend write bypass`);
  requireCondition(deniedWrite.code === 'TOKEN_INVALID', `${role} Backend write bypass: review token was not rejected`);
}

async function smokeRole({ role, baseUrl, realBaseUrl, experienceCode, fetchImpl }) {
  const login = await requestJson(fetchImpl, baseUrl, '/api/auth/review-demo', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: experienceCode, role }),
  }, 200, `${role} login`);
  const session = assertLoginContract(login, role);
  const context = { role, baseUrl, fetchImpl, ...session };

  const permissions = await requestJson(fetchImpl, baseUrl, '/api/permissions/my', {
    method: 'GET', headers: authHeaders(session.token),
  }, 200, `${role} permissions`);
  assertPermissions(permissions, role, session.user);

  const snapshot = await requestJson(fetchImpl, baseUrl, '/api/cloud/snapshots/read', {
    method: 'GET', headers: authHeaders(session.token),
  }, 200, `${role} snapshot`);
  assertSnapshot(snapshot, role);

  const preview = await requestJson(fetchImpl, baseUrl, '/api/cloud/snapshots/questions', {
    method: 'GET', headers: authHeaders(session.token),
  }, 200, `${role} questions`);
  const questionIds = assertQuestionPreview(preview, role);

  const composition = await createSandboxTask(context, 'question-paper', questionIds);
  const cancelled = await requestJson(
    fetchImpl,
    baseUrl,
    `/api/review-demo/tasks/${encodeURIComponent(composition.id)}/cancel`,
    { method: 'POST', headers: authHeaders(session.token, true), body: '{}' },
    200,
    `${role} composition cancel`,
  );
  requireCondition(cancelled.success === true && cancelled.task?.status === 'cancelled', `${role} composition: cancel contract mismatch`);

  const wordTask = await createSandboxTask(context, 'paper-export-word', questionIds);
  await downloadArtifact(
    context,
    wordTask,
    DOCX_SIGNATURE,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'DOCX',
  );
  const pdfTask = await createSandboxTask(context, 'paper-export-pdf', questionIds);
  await downloadArtifact(context, pdfTask, PDF_SIGNATURE, 'application/pdf', 'PDF');

  // `/api` installs reviewDemoGuard before `/api/cloud`; this real task route is
  // therefore rejected before its domain router can enqueue or mutate anything.
  const denied = await requestJson(fetchImpl, baseUrl, '/api/cloud/tasks', {
    method: 'POST',
    headers: authHeaders(session.token, true),
    body: JSON.stringify({ taskType: 'question-paper', payload: {} }),
  }, 403, `${role} write denial`);
  requireCondition(denied.success === false && denied.code === 'REVIEW_DEMO_READ_ONLY', `${role} write denial: firewall contract mismatch`);
  await assertBackendIsolation({ role, realBaseUrl, fetchImpl, token: session.token });
}

async function runReviewDemoSmoke(options = {}) {
  const { baseUrl, realBaseUrl, experienceCode } = loadSmokeConfig(options.env || process.env);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const logger = options.logger || console.log;
  requireCondition(typeof fetchImpl === 'function', 'fetch runtime unavailable');
  for (const role of ROLES) {
    await smokeRole({ role, baseUrl, realBaseUrl, experienceCode, fetchImpl });
    logger(`review demo smoke passed: ${role}`);
  }
  return { ok: true, roles: [...ROLES] };
}

async function main() {
  try {
    await runReviewDemoSmoke();
    console.log('review demo public smoke passed');
  } catch (error) {
    console.error(sanitizeFailure(error));
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  DOCX_SIGNATURE,
  MAX_ARTIFACT_BYTES,
  MAX_JSON_BYTES,
  PDF_SIGNATURE,
  SmokeFailure,
  assertBackendIsolation,
  assertSnapshot,
  loadSmokeConfig,
  readBoundedArtifactBody,
  readBoundedJsonBody,
  runReviewDemoSmoke,
  sanitizeFailure,
  smokeRole,
};
