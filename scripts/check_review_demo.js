'use strict';

const { validateReviewExperienceCode } = require('./check_miniapp_review_readiness');

const DOCX_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const PDF_SIGNATURE = Buffer.from('%PDF', 'ascii');
const ROLES = Object.freeze(['admin', 'student']);
const EXPECTED_CAPABILITIES = Object.freeze(['review-demo:read', 'question-bank:view', 'review-demo:paper-export']);
const REQUEST_TIMEOUT_MS = 15_000;

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
  const codeValidation = validateReviewExperienceCode(env);
  let parsed;
  try {
    parsed = new URL(rawBaseUrl);
  } catch (_error) {
    throw new SmokeFailure('review smoke configuration is invalid');
  }
  const validUrl = parsed.protocol === 'https:'
    && Boolean(parsed.hostname)
    && !parsed.username
    && !parsed.password
    && !parsed.search
    && !parsed.hash;
  if (!validUrl || !codeValidation.ok) throw new SmokeFailure('review smoke configuration is invalid');
  return {
    baseUrl: rawBaseUrl.replace(/\/+$/, ''),
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

async function safeJson(response, step) {
  try {
    const body = await response.json();
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
  if (role === 'student') {
    requireCondition(
      Array.isArray(payload.students)
        && payload.students.length === 1
        && payload.students[0].id === 'review-demo-student',
      'student snapshot: linked sample scope mismatch',
    );
    requireCondition(
      Array.isArray(payload.schedules)
        && payload.schedules.every(item => Array.isArray(item.student_ids) && item.student_ids.includes('review-demo-student')),
      'student snapshot: schedule scope mismatch',
    );
    for (const field of ['payments', 'assetRecords', 'assetCategories', 'consumptions']) {
      if (payload[field] !== undefined) requireCondition(Array.isArray(payload[field]) && payload[field].length === 0, `student snapshot: ${field} must be empty`);
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
    bytes = Buffer.from(await response.arrayBuffer());
  } catch (_error) {
    fail(`${context.role} ${label}: download failed`);
  }
  requireCondition(bytes.length >= signature.length && bytes.subarray(0, signature.length).equals(signature), `${context.role} ${label} signature mismatch`);
}

async function smokeRole({ role, baseUrl, experienceCode, fetchImpl }) {
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
}

async function runReviewDemoSmoke(options = {}) {
  const { baseUrl, experienceCode } = loadSmokeConfig(options.env || process.env);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const logger = options.logger || console.log;
  requireCondition(typeof fetchImpl === 'function', 'fetch runtime unavailable');
  for (const role of ROLES) {
    await smokeRole({ role, baseUrl, experienceCode, fetchImpl });
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
  PDF_SIGNATURE,
  SmokeFailure,
  loadSmokeConfig,
  runReviewDemoSmoke,
  sanitizeFailure,
  smokeRole,
};
