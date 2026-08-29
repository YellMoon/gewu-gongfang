'use strict';

// Runs inside the cloud API container. It publishes only two explicitly named
// imported samples through the normal desktop question command endpoint.
const crypto = require('crypto');
const path = require('path');
const { stableJson } = require('../shared/authorityProtocol');

function failure(code) { return Object.assign(new Error(code), { code }); }

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function importedQuestionIds(task) {
  if (!plainObject(task) || !Array.isArray(task.items)) throw failure('REAL_QUESTION_IMPORT_PUBLISH_TASK_INVALID');
  return task.items.map(item => {
    if (!plainObject(item) || typeof item.contentHash !== 'string' || !/^[0-9a-f]{64}$/u.test(item.contentHash)) {
      throw failure('REAL_QUESTION_IMPORT_PUBLISH_TASK_INVALID');
    }
    return `question-import-${item.contentHash.slice(0, 40)}`;
  });
}

function questionTypeFromImportCandidate(candidate) {
  const types = Array.isArray(candidate.question_types) ? candidate.question_types : [candidate.question_types];
  const normalized = types.map(value => String(value || '').trim().toLowerCase().replace(/[\s_]+/g, '-'));
  if (normalized.some(value => /^(multi|multiple|multiple-choice)$/.test(value))) return '\u591a\u9009\u9898';
  if (normalized.some(value => /^(single|single-choice|choice)$/.test(value))) return '\u5355\u9009\u9898';
  if (normalized.some(value => value === 'experiment')) return '\u5b9e\u9a8c\u9898';
  if (normalized.some(value => value === 'judge')) return '\u5224\u65ad\u9898';
  return '\u89e3\u7b54\u9898';
}

function questionRecordFromImportItem(taskId, item) {
  if (typeof taskId !== 'string' || !/^question_import_task_[A-Za-z0-9_-]{1,128}$/.test(taskId)
    || !plainObject(item) || typeof item.itemId !== 'string' || !/^question_import_item_[A-Za-z0-9_-]{1,128}$/.test(item.itemId)
    || !Number.isSafeInteger(item.itemIndex) || item.itemIndex < 0 || typeof item.contentHash !== 'string' || !/^[0-9a-f]{64}$/u.test(item.contentHash)
    || !plainObject(item.candidate) || typeof item.candidate.stem !== 'string' || !item.candidate.stem.trim()
    || !Array.isArray(item.candidate.options)) {
    throw failure('REAL_QUESTION_IMPORT_PUBLISH_TASK_INVALID');
  }
  const candidate = item.candidate;
  const answer = candidate.answer === null || candidate.answer === undefined ? null : String(candidate.answer);
  const analysisValue = candidate.analysis === undefined ? candidate.explanation : candidate.analysis;
  const analysis = analysisValue === null || analysisValue === undefined ? '' : String(analysisValue);
  const richContent = candidate.rich_content === null || candidate.rich_content === undefined ? null : candidate.rich_content;
  if (!(richContent === null || plainObject(richContent))) throw failure('REAL_QUESTION_IMPORT_PUBLISH_TASK_INVALID');
  const difficulty = Number.isSafeInteger(candidate.difficulty) && candidate.difficulty >= 1 && candidate.difficulty <= 5 ? candidate.difficulty : 3;
  return {
    id: `question-import-${item.contentHash.slice(0, 40)}`,
    subject: typeof candidate.subject === 'string' && candidate.subject.trim() ? candidate.subject.trim() : '\u7269\u7406',
    type: questionTypeFromImportCandidate(candidate), difficulty, content: candidate.stem,
    options: candidate.options, answer, analysis, rich_content: richContent,
    knowledge_point_ids: [], model_point_ids: [], taxonomy_ids: {}, has_formula: Boolean(candidate.has_formula),
    import_task_id: taskId, import_item_id: item.itemId, import_item_index: item.itemIndex, import_content_hash: item.contentHash,
  };
}

function questionCreateCommand(question) {
  if (!plainObject(question) || typeof question.id !== 'string' || !question.id) throw failure('REAL_QUESTION_IMPORT_PUBLISH_QUESTION_INVALID');
  const type = 'question.create.v1';
  const payload = { record: question };
  return {
    commandId: `question-import-create-${crypto.createHash('sha256').update(question.id, 'utf8').digest('hex').slice(0, 40)}`,
    payloadHash: crypto.createHash('sha256').update(stableJson({ type, payload }), 'utf8').digest('hex'),
    type,
    payload,
  };
}

function changesForPublishedQuestion(question) {
  if (!plainObject(question) || typeof question.id !== 'string' || !question.id
    || typeof question.subject !== 'string' || !question.subject || typeof question.type !== 'string' || !question.type
    || !Number.isSafeInteger(question.difficulty) || question.difficulty < 1 || question.difficulty > 5
    || typeof question.content !== 'string' || !question.content || !Array.isArray(question.options)
    || !(question.answer === null || typeof question.answer === 'string') || !(question.analysis === null || typeof question.analysis === 'string')
    || !(question.rich_content === null || plainObject(question.rich_content)) || !Array.isArray(question.knowledge_point_ids)
    || !Array.isArray(question.model_point_ids) || !plainObject(question.taxonomy_ids) || typeof question.has_formula !== 'boolean') {
    throw failure('REAL_QUESTION_IMPORT_PUBLISH_QUESTION_INVALID');
  }
  return {
    subject: question.subject, type: question.type, difficulty: question.difficulty, content: question.content,
    options: question.options, answer: question.answer, analysis: question.analysis, rich_content: question.rich_content,
    knowledge_point_ids: question.knowledge_point_ids, model_point_ids: question.model_point_ids,
    taxonomy_ids: question.taxonomy_ids, has_formula: question.has_formula, status: 'published',
  };
}

function questionPublishCommand(question) {
  const changes = changesForPublishedQuestion(question);
  const type = 'question.update.v1';
  const payload = { id: question.id, changes };
  return {
    commandId: `question-publish-${crypto.createHash('sha256').update(question.id, 'utf8').digest('hex').slice(0, 40)}`,
    payloadHash: crypto.createHash('sha256').update(stableJson({ type, payload }), 'utf8').digest('hex'),
    type,
    payload,
  };
}

async function request(fetchImpl, sessionToken, deviceId, url, options = {}) {
  const response = await fetchImpl(url, {
    ...options,
    headers: { Accept: 'application/json', Authorization: `Bearer ${sessionToken}`, 'x-device-id': deviceId, ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok !== true) throw failure(`REAL_QUESTION_IMPORT_PUBLISH_HTTP_${response.status}_${String(body?.code || 'UNKNOWN').replace(/[^A-Z0-9_]/g, '')}`);
  return body;
}

async function publishImportedSamples({ fetchImpl, sessionToken, deviceId, baseUrl, taskIds }) {
  if (typeof fetchImpl !== 'function' || typeof sessionToken !== 'string' || !sessionToken || typeof deviceId !== 'string' || !deviceId
    || typeof baseUrl !== 'string' || !Array.isArray(taskIds) || taskIds.length !== 2) throw failure('REAL_QUESTION_IMPORT_PUBLISH_INPUT_INVALID');
  const root = baseUrl.replace(/\/$/, '');
  const desiredRecords = [];
  for (const taskId of taskIds) {
    const taskBody = await request(fetchImpl, sessionToken, deviceId, `${root}/api/desktop/question-imports/${encodeURIComponent(taskId)}`);
    if (!plainObject(taskBody.task) || !Array.isArray(taskBody.task.items) || !taskBody.task.items.length) throw failure('REAL_QUESTION_IMPORT_PUBLISH_TASK_INVALID');
    desiredRecords.push(questionRecordFromImportItem(taskId, taskBody.task.items[0]));
  }
  const listed = await request(fetchImpl, sessionToken, deviceId, `${root}/api/desktop/question-bank/questions?limit=200`);
  if (!Array.isArray(listed.questions)) throw failure('REAL_QUESTION_IMPORT_PUBLISH_LIST_INVALID');
  const existing = new Map(listed.questions.filter(question => question && typeof question.id === 'string').map(question => [question.id, question]));
  for (const record of desiredRecords) {
    if (!existing.has(record.id)) {
      await request(fetchImpl, sessionToken, deviceId, `${root}/api/desktop/question-bank/commands`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(questionCreateCommand(record)),
      });
    }
  }
  const created = await request(fetchImpl, sessionToken, deviceId, `${root}/api/desktop/question-bank/questions?limit=200`);
  if (!Array.isArray(created.questions)) throw failure('REAL_QUESTION_IMPORT_PUBLISH_LIST_INVALID');
  const desiredIds = desiredRecords.map(record => record.id);
  const selected = desiredIds.map(id => created.questions.find(question => question?.id === id));
  if (selected.some(question => !question)) throw failure('REAL_QUESTION_IMPORT_PUBLISH_NOT_FOUND');
  for (const question of selected) {
    if (question.status !== 'published') {
      await request(fetchImpl, sessionToken, deviceId, `${root}/api/desktop/question-bank/commands`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(questionPublishCommand(question)),
      });
    }
  }
  const confirmed = await request(fetchImpl, sessionToken, deviceId, `${root}/api/desktop/question-bank/questions?limit=200`);
  const published = desiredIds.map(id => confirmed.questions?.find(question => question?.id === id));
  if (published.some(question => !question || question.status !== 'published')) throw failure('REAL_QUESTION_IMPORT_PUBLISH_INCOMPLETE');
  return { questionIds: desiredIds, publishedCount: published.length };
}

async function responseBody(response) {
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

async function fixtureAccount(appPool, key) {
  if (!/^(visitor|teacher|student|family)$/u.test(key)) throw failure('REAL_QUESTION_ROLE_ACCESS_INPUT_INVALID');
  const result = await appPool.query(
    'SELECT account_id AS "accountId" FROM business.miniapp_cloud_accounts WHERE account_id LIKE $1 ORDER BY account_id',
    [`e2e-account-${key}-%`],
  );
  if (!Array.isArray(result?.rows) || result.rows.length !== 1 || typeof result.rows[0]?.accountId !== 'string') {
    throw failure('REAL_QUESTION_ROLE_ACCESS_IDENTITY_INVALID');
  }
  return result.rows[0].accountId;
}

async function fixtureTeacherIdentity(writerPool) {
  const result = await writerPool.query(
    `SELECT account.authority_id AS "authorityId",account.account_id AS "accountId",contact.normalized_value_hash AS "phoneHmac"
       FROM vnext_control_plane.vnext_accounts account
       JOIN vnext_control_plane.vnext_verified_contacts contact
         ON contact.account_id=account.account_id AND contact.contact_type='phone' AND contact.verification_state='verified' AND contact.revoked_at IS NULL
      WHERE account.account_id LIKE 'e2e-account-teacher-%' AND account.status='active'
      ORDER BY account.account_id`,
  );
  if (!Array.isArray(result?.rows) || result.rows.length !== 1 || !plainObject(result.rows[0])) throw failure('REAL_QUESTION_ROLE_ACCESS_IDENTITY_INVALID');
  const identity = result.rows[0];
  if (typeof identity.authorityId !== 'string' || !identity.authorityId || typeof identity.accountId !== 'string' || !identity.accountId
    || typeof identity.phoneHmac !== 'string' || !/^[0-9a-f]{64}$/u.test(identity.phoneHmac)) throw failure('REAL_QUESTION_ROLE_ACCESS_IDENTITY_INVALID');
  return identity;
}

async function verifyMiniappBrowse({ fetchImpl, token, baseUrl, expectedQuestionIds }) {
  const { status, body } = await responseBody(await fetchImpl(`${baseUrl}/api/business/miniapp-question-previews`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
  }));
  if (status !== 200 || body?.ok !== true || !Array.isArray(body.questions)) throw failure('REAL_QUESTION_ROLE_ACCESS_MINIAPP_FAILED');
  const found = expectedQuestionIds.map(id => body.questions.find(question => question?.id === id));
  if (found.some(question => !question || typeof question.answer !== 'string' || typeof question.explanation !== 'string')) {
    throw failure('REAL_QUESTION_ROLE_ACCESS_CONTENT_INVALID');
  }
  return body.questions.length;
}

async function verifyMultiRoleQuestionAccess({ fetchImpl, appPool, writerPool, runtimeModules, ticketSecret, miniappTicketSecret, baseUrl, expectedQuestionIds }) {
  if (typeof fetchImpl !== 'function' || !Array.isArray(expectedQuestionIds) || expectedQuestionIds.length !== 2) throw failure('REAL_QUESTION_ROLE_ACCESS_INPUT_INVALID');
  const cloudAcceptance = require('./real-cloud-business-acceptance');
  const accounts = {};
  for (const key of ['visitor', 'student', 'family']) accounts[key] = await fixtureAccount(appPool, key);
  const miniappCounts = {};
  for (const key of ['visitor', 'student', 'family']) {
    miniappCounts[key] = await verifyMiniappBrowse({
      fetchImpl, token: cloudAcceptance.makeMiniappSessionToken(miniappTicketSecret, accounts[key]), baseUrl, expectedQuestionIds,
    });
  }
  const identity = await fixtureTeacherIdentity(writerPool);
  const fixture = cloudAcceptance.createOnlineRegistrationRequest(runtimeModules, ticketSecret, identity);
  let persistedFixture = { sessionId: null, installationId: fixture.body.installationId, deviceId: fixture.deviceId };
  try {
    const registration = await responseBody(await fetchImpl(`${baseUrl}/api/desktop/online-registration`, {
      method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(fixture.body),
    }));
    if (registration.status !== 200 || registration.body?.ok !== true || typeof registration.body.sessionToken !== 'string' || !registration.body.sessionToken
      || typeof registration.body.sessionId !== 'string' || !registration.body.sessionId) throw failure('REAL_QUESTION_ROLE_ACCESS_TEACHER_REGISTRATION_FAILED');
    persistedFixture = { sessionId: registration.body.sessionId, installationId: fixture.body.installationId, deviceId: fixture.deviceId };
    const context = await responseBody(await fetchImpl(`${baseUrl}/api/desktop/session-context`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${registration.body.sessionToken}` },
    }));
    if (context.status !== 200 || context.body?.ok !== true || !Array.isArray(context.body.roles) || !context.body.roles.includes('teacher')) {
      throw failure('REAL_QUESTION_ROLE_ACCESS_TEACHER_CONTEXT_FAILED');
    }
    const desktop = await request(fetchImpl, registration.body.sessionToken, fixture.deviceId, `${baseUrl}/api/desktop/question-bank/questions?limit=200`);
    if (!Array.isArray(desktop.questions) || expectedQuestionIds.some(id => !desktop.questions.some(question => question?.id === id && question?.status === 'published'))) {
      throw failure('REAL_QUESTION_ROLE_ACCESS_TEACHER_QUESTION_FAILED');
    }
    return { miniappCounts, teacherQuestionCount: desktop.questions.length };
  } finally {
    await cloudAcceptance.revokeOnlineRegistrationAcceptance(writerPool, persistedFixture);
  }
}

async function runFromEnvironment(env = process.env) {
  const cloudAcceptance = require('./real-cloud-business-acceptance');
  const taskIds = [env.REAL_QUESTION_IMPORT_EXAM_TASK_ID, env.REAL_QUESTION_IMPORT_LECTURE_TASK_ID];
  if (taskIds.some(taskId => typeof taskId !== 'string' || !/^question_import_task_[A-Za-z0-9_-]{1,128}$/u.test(taskId))) {
    throw failure('REAL_QUESTION_IMPORT_PUBLISH_INPUT_INVALID');
  }
  const runtimeModules = cloudAcceptance.resolveRuntimeModules(__dirname);
  const { Pool } = require(runtimeModules.pgPath);
  const { resolveRuntimeDatabaseUser } = require(path.join(path.dirname(runtimeModules.packagePath), 'src', 'runtimeDatabaseRole'));
  const appPool = new Pool({ host: env.POSTGRES_HOST || '127.0.0.1', port: Number(env.POSTGRES_PORT || 5432), database: env.POSTGRES_DB || 'gewu_cloud', user: resolveRuntimeDatabaseUser(env.POSTGRES_USER), password: env.POSTGRES_PASSWORD });
  const writerPool = new Pool({ host: env.POSTGRES_HOST || '127.0.0.1', port: Number(env.POSTGRES_PORT || 5432), database: env.POSTGRES_DB || 'gewu_cloud', user: 'vnext_pg17_writer', password: env.COMMAND_WRITER_POSTGRES_PASSWORD });
  let registration = null;
  try {
    const loaded = await cloudAcceptance.loadActiveSuperAdminSession(appPool, writerPool, env.CLOUD_OPERATOR_PHONE_HMACS);
    registration = await cloudAcceptance.runOnlineRegistrationAcceptance({ fetchImpl: fetch, runtimeModules, ticketSecret: env.CLOUD_IDENTITY_TICKET_SECRET, identity: loaded.identity });
    const result = await publishImportedSamples({
      fetchImpl: fetch, sessionToken: registration.sessionToken, deviceId: registration.fixture.deviceId,
      baseUrl: cloudAcceptance.PUBLIC_BASE_URL, taskIds,
    });
    const roleAccess = await verifyMultiRoleQuestionAccess({
      fetchImpl: fetch, appPool, writerPool, runtimeModules, ticketSecret: env.CLOUD_IDENTITY_TICKET_SECRET,
      miniappTicketSecret: env.CLOUD_MINIAPP_TICKET_SECRET, baseUrl: cloudAcceptance.PUBLIC_BASE_URL, expectedQuestionIds: result.questionIds,
    });
    return { ok: true, ...result, roleAccess };
  } finally {
    if (registration?.fixture) await cloudAcceptance.revokeOnlineRegistrationAcceptance(writerPool, registration.fixture);
    await Promise.allSettled([appPool.end(), writerPool.end()]);
  }
}

module.exports = Object.freeze({ importedQuestionIds, questionTypeFromImportCandidate, questionRecordFromImportItem, questionCreateCommand, changesForPublishedQuestion, questionPublishCommand, publishImportedSamples, fixtureAccount, fixtureTeacherIdentity, verifyMiniappBrowse, verifyMultiRoleQuestionAccess, runFromEnvironment });

if (require.main === module) runFromEnvironment()
  .then(result => process.stdout.write(`${JSON.stringify(result)}\n`))
  .catch(error => { process.stderr.write(`${JSON.stringify({ ok: false, code: error?.code || 'REAL_QUESTION_IMPORT_PUBLISH_FAILED' })}\n`); process.exitCode = 1; });
