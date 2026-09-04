'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { pageInventory } = require('../miniapp/src/utils/miniappUiPageInventory');
const { REQUIRED_COVERAGE_CATEGORIES, runtimeScenarios } = require('../miniapp/src/utils/miniappUiRuntimeScenarios');

const ROOT = path.resolve(__dirname, '..');
const automator = require(path.join(ROOT, 'miniapp', 'node_modules', 'miniprogram-automator'));
const automatorRuntime = path.join(ROOT, 'miniapp', 'node_modules', 'miniprogram-automator', 'out');
const AutomationConnection = require(path.join(automatorRuntime, 'Connection')).default;
const AutomationMiniProgram = require(path.join(automatorRuntime, 'MiniProgram')).default;
const VERSION = require('../miniapp/package.json').version;
const scenarioIdFilter = new Set(String(process.env.MINIAPP_UI_SCENARIO_IDS || '').split(',').map(value => value.trim()).filter(Boolean));
const focusedRun = scenarioIdFilter.size > 0;
const scenarios = focusedRun ? runtimeScenarios.filter(scenario => scenarioIdFilter.has(scenario.id)) : runtimeScenarios;
const OUTPUT = process.env.MINIAPP_UI_OUTPUT_DIR
  ? path.resolve(process.env.MINIAPP_UI_OUTPUT_DIR)
  : path.join(
    ROOT,
    'output',
    `miniapp-${VERSION}-ui-coverage`,
    focusedRun ? `runtime-diagnostic-${[...scenarioIdFilter].join('-')}` : 'runtime-scenario-matrix',
  );
function resolveFixturePort(value = process.env.MINIAPP_UI_FIXTURE_PORT || '3019') {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('fixture server port is invalid');
  return port;
}

function resolveStandaloneFixtureScenario({ scenarioId = '', fixtureMode = '' } = {}) {
  const normalizedScenarioId = String(scenarioId || '').trim();
  const normalizedFixtureMode = String(fixtureMode || '').trim();
  if (normalizedScenarioId && normalizedFixtureMode) {
    throw new Error('miniapp fixture scenario id and fixture mode are mutually exclusive');
  }
  if (normalizedScenarioId) {
    const scenario = runtimeScenarios.find(item => item.id === normalizedScenarioId);
    if (!scenario) throw new Error(`miniapp fixture scenario is unknown: ${normalizedScenarioId}`);
    return scenario;
  }
  if (normalizedFixtureMode) {
    if (normalizedFixtureMode !== 'question-rich') {
      throw new Error(`miniapp fixture mode is unknown: ${normalizedFixtureMode}`);
    }
    return Object.freeze({ id: 'standalone-question-rich', fixtureMode: normalizedFixtureMode });
  }
  return null;
}

const FIXTURE_PORT = resolveFixturePort();
const FIXTURE_BASE = `http://127.0.0.1:${FIXTURE_PORT}`;
const SCREENSHOT_WAIT_MS = 1100;

const wait = (milliseconds) => new Promise(resolve => setTimeout(resolve, milliseconds));

async function connectAutomation(wsEndpoint) {
  const connection = await AutomationConnection.create(wsEndpoint);
  const miniProgram = new AutomationMiniProgram(connection);
  try {
    await miniProgram.checkVersion();
  } catch (legacyVersionError) {
    // DevTools 2.02 exposes { version } instead of the old { SDKVersion }.
    // Keep the version guard for older tools, while accepting the current
    // automation protocol only when it provides a concrete version identifier.
    const toolInfo = await miniProgram.send('Tool.getInfo');
    if (!toolInfo?.version) {
      miniProgram.disconnect();
      throw legacyVersionError;
    }
  }
  return miniProgram;
}

async function connectLaunchedAutomation(wsEndpoint, { attempts = 20, pauseMilliseconds = 1000 } = {}) {
  let lastConnectionError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await connectAutomation(wsEndpoint);
    } catch (error) {
      if (!/ECONNREFUSED/u.test(String(error?.message || error))) throw error;
      lastConnectionError = error;
      if (attempt + 1 < attempts) await wait(pauseMilliseconds);
    }
  }
  throw lastConnectionError;
}

async function reLaunchPage(miniProgram, route) {
  await miniProgram.evaluate(function requestReLaunch(nextRoute) {
    wx.reLaunch({ url: nextRoute });
    return true;
  }, route);
  await wait(200);
  return miniProgram.currentPage();
}

const capabilitiesByRole = Object.freeze({
  super_admin: ['business:all', 'question-bank:view'],
  teacher: ['business:teacher-scope', 'question-bank:view'],
  student: ['question-bank:view'],
  family_member: ['question-bank:view'],
});

function normalIdentity(role) {
  const identity = {
    accountId: `fixture-${role}`,
    roles: [role],
    status: 'active',
    profile: null,
    id: `fixture-${role}`,
    name: role === 'student' ? '学生验收账号' : role === 'teacher' ? '教师验收账号' : '管理验收账号',
    role,
    user_type: role,
    token_use: 'miniapp-cloud',
    account_state: 'formal',
    tenant_id: 'fixture-tenant',
    review_status: 'approved',
    login_enabled: 1,
    active: true,
    deleted: false,
    disabled: false,
    capabilities: capabilitiesByRole[role] || [],
  };
  if (role === 'teacher') {
    identity.teacher_id = 'fixture-teacher';
    identity.profile = { type: 'teacher', id: 'fixture-teacher' };
  }
  if (role === 'student' || role === 'family_member') {
    identity.student_id = 'fixture-student';
    identity.linked_student_ids = ['fixture-student'];
    identity.profile = { type: 'student', id: 'fixture-student', relationship: role === 'family_member' ? 'guardian' : 'student' };
    if (role === 'family_member') {
      identity.identity_kind = 'family_member';
      identity.student_relationship = 'guardian';
    }
  }
  return identity;
}

const identities = Object.freeze({
  guest: null,
  super_admin: normalIdentity('super_admin'),
  teacher: normalIdentity('teacher'),
  'paper-teacher': {
    ...normalIdentity('teacher'),
    accountId: 'fixture-paper-teacher', id: 'fixture-paper-teacher', name: '组卷验收教师',
  },
  student: normalIdentity('student'),
  guardian: {
    ...normalIdentity('family_member'),
    accountId: 'fixture-guardian', id: 'fixture-guardian',
    name: '家庭成员验收账号',
    profile: { type: 'student', id: 'fixture-student', relationship: 'guardian' },
    student_relationship: 'guardian',
  },
  visitor: {
    accountId: 'fixture-visitor', roles: [], status: 'visitor', profile: null,
    id: 'fixture-visitor', name: '访客验收账号', role: 'visitor', user_type: 'visitor',
    identity_kind: 'visitor', account_state: 'visitor', token_use: 'miniapp-visitor',
    authority_id: 'fixture-authority',
    capabilities: ['projection:read', 'role-application:read', 'role-application:submit', 'question-preview:read'],
  },
});

const RICH_VISITOR_QUESTION_LIMIT = 3;
const richPhysicsQuestions = Object.freeze([
  Object.freeze({
    id: 'fixture-rich-physics-1',
    subject: 'physics',
    type: 'single_choice',
    stemPreview: '水平地面上的木块受到 6 N 的水平拉力，滑动摩擦力为 4 N。木块所受合力大小为（ ）',
    options: ['A. 0 N', 'B. 2 N', 'C. 4 N', 'D. 10 N'],
    answer: 'B',
    explanation: '拉力与滑动摩擦力方向相反，合力大小为 6 N - 4 N = 2 N。',
    difficulty: 1,
    source: '格物工坊·力学基础测试',
    knowledgeLabels: ['受力分析', '滑动摩擦力'],
    status: 'published',
  }),
  Object.freeze({
    id: 'fixture-rich-physics-2',
    subject: 'physics',
    type: 'single_choice',
    stemPreview: '一辆小车沿直线运动，前 4 s 速度均匀增大，随后 2 s 速度保持不变。下列描述正确的是（ ）',
    options: [
      'A. 先做匀加速直线运动，再做匀速直线运动',
      'B. 始终做速度越来越大的直线运动',
      'C. 先静止不动，再做匀速直线运动',
      'D. 运动方向先改变，随后保持不变',
    ],
    answer: 'A',
    explanation: '速度均匀增大对应匀加速直线运动，速度保持不变对应匀速直线运动。',
    difficulty: 2,
    source: '2026 年九年级物理阶段练习',
    knowledgeLabels: ['速度—时间图像', '运动状态'],
    status: 'published',
  }),
  Object.freeze({
    id: 'fixture-rich-physics-3',
    subject: 'physics',
    type: 'single_choice',
    stemPreview: '关于惯性和力与运动的关系，下列说法正确的是（ ）',
    options: [
      'A. 物体只有在受到力的作用时才具有惯性，撤去外力后惯性会立即消失',
      'B. 物体运动速度越大，维持运动所需的合力一定越大，合力方向与速度方向始终相同',
      'C. 一切物体都具有惯性，质量是惯性大小的量度，物体不受力时也可能保持匀速直线运动',
      'D. 静止物体没有惯性，运动物体才有惯性，因此惯性大小由物体的速度决定',
    ],
    answer: 'C',
    explanation: '惯性是物体固有的属性，质量是惯性大小的量度；合力为零时物体可以静止，也可以做匀速直线运动。',
    difficulty: 3,
    source: '格物工坊·牛顿运动定律讲义',
    knowledgeLabels: ['惯性', '牛顿第一定律'],
    status: 'published',
  }),
  Object.freeze({
    id: 'fixture-rich-physics-4',
    subject: 'physics',
    type: 'calculation',
    stemPreview: '质量为 m 的小车在恒力 F 作用下从静止开始做匀加速直线运动，求加速度和 t 秒内的位移。',
    options: [],
    answer: 'a = F/m；s = 1/2 at^2',
    explanation: '由牛顿第二定律 F = ma 求出加速度，再由初速度为零的匀变速直线运动位移公式求位移。',
    richContent: {
      version: 1,
      type: 'question-document',
      sections: {
        stem: {
          type: 'doc',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', text: '质量为 m 的小车在水平恒力 F 作用下做匀加速直线运动，初速度 ' },
              { type: 'formula', attrs: { canonicalLatex: 'v_{0}=0' } },
              { type: 'text', text: '，经过时间 t 后速度满足 ' },
              { type: 'formula', attrs: { canonicalLatex: 'v=at' } },
              { type: 'text', text: '。回答下列问题：' },
            ],
          }],
        },
        options: [],
        subQuestions: [
          {
            id: 'fixture-rich-physics-4-sub-1',
            label: '(1)',
            content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '写出加速度 a 与 F、m 的关系。' }] }] },
            answer: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'formula', attrs: { canonicalLatex: 'a=\\frac{F}{m}' } }] }] },
          },
          {
            id: 'fixture-rich-physics-4-sub-2',
            label: '(2)',
            content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '写出小车在 t 秒内位移 s 的表达式。' }] }] },
            answer: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'formula', attrs: { canonicalLatex: 's=\\frac{1}{2}at^{2}' } }] }] },
          },
        ],
        answer: {
          type: 'doc',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'formula', attrs: { canonicalLatex: 'a=\\frac{F}{m}' } },
              { type: 'text', text: '，' },
              { type: 'formula', attrs: { canonicalLatex: 's=\\frac{1}{2}at^{2}' } },
            ],
          }],
        },
        analysis: {
          type: 'doc',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', text: '由牛顿第二定律 ' },
              { type: 'formula', attrs: { canonicalLatex: 'F=ma' } },
              { type: 'text', text: '，结合初速度为零的位移公式即可得到结果。' },
            ],
          }],
        },
      },
    },
    difficulty: 4,
    source: '格物工坊·动力学专题讲义',
    knowledgeLabels: ['牛顿第二定律', '匀变速直线运动'],
    status: 'published',
  }),
]);

function fixtureIdentityFromRequest(request) {
  const token = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const role = token.replace(/^fixture-/, '');
  return identities[role] || identities.super_admin;
}

function validPdfFixture() {
  const content = 'BT /F1 18 Tf 72 720 Td (Fixture paper) Tj ET\n';
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${Buffer.byteLength(content, 'ascii')} >>\nstream\n${content}endstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ];
  const header = '%PDF-1.4\n% fixture paper\n';
  let offset = Buffer.byteLength(header, 'ascii');
  const offsets = [0];
  for (const object of objects) {
    offsets.push(offset);
    offset += Buffer.byteLength(object, 'ascii');
  }
  const xrefOffset = offset;
  const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(value => `${String(value).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(header + objects.join('') + xref, 'ascii');
}

function fixtureResponse(request, scenario) {
  const url = new URL(request.url, FIXTURE_BASE);
  const pathname = url.pathname;
  const identity = fixtureIdentityFromRequest(request);
  if (scenario?.fixtureMode === 'desktop-offline' && pathname.includes('/api/desktop-identity/challenges/')) {
    return { statusCode: 503, body: { success: false, error: 'fixture network unavailable' } };
  }
  if (scenario?.fixtureMode === 'question-offline' && pathname === '/api/business/miniapp-question-previews') {
    return { statusCode: 503, body: { ok: false, error: 'fixture offline' } };
  }
  if (scenario?.fixtureMode === 'question-forbidden' && pathname === '/api/business/miniapp-question-previews') {
    return { statusCode: 403, body: { ok: false, code: 'FORBIDDEN', error: 'fixture forbidden' } };
  }
  if (scenario?.fixtureMode === 'application-offline' && pathname === '/api/miniapp/role-applications/me') {
    return { statusCode: 503, body: { success: false, error: 'fixture network unavailable' } };
  }
  if (/^\/api\/desktop-identity\/challenges\/[^/]+\/public$/.test(pathname)) {
    const id = decodeURIComponent(pathname.split('/')[4]);
    return { statusCode: 200, body: { success: true, data: { challenge: {
      id, deviceName: '验收电脑', keyFingerprintSummary: 'abcdef12…1234', purpose: 'register',
      status: 'pending_phone', createdAt: new Date(Date.now() - 60000).toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(), rowVersion: 1,
    } } } };
  }
  if (pathname === '/api/miniapp/cloud-context') {
    return { statusCode: 200, body: { ok: true, identity, capabilities: capabilitiesByRole[identity?.role] || identity?.capabilities || [] } };
  }
  if (pathname === '/api/business/miniapp-projection') {
    const projection = {};
    for (const table of ['students', 'studentContacts', 'teachers', 'courses', 'schedules', 'institutions', 'schools', 'rooms', 'assetRecords', 'assetCategories']) projection[table] = [];
    return { statusCode: 200, body: { ok: true, projection } };
  }
  if (pathname === '/api/business/miniapp-question-previews') {
    if (scenario?.fixtureMode === 'question-rich') {
      const isVisitor = identity?.status === 'visitor' || identity?.account_state === 'visitor';
      return {
        statusCode: 200,
        body: {
          ok: true,
          questions: isVisitor ? richPhysicsQuestions.slice(0, RICH_VISITOR_QUESTION_LIMIT) : richPhysicsQuestions,
          hasMore: isVisitor,
        },
      };
    }
    const questions = identity?.status === 'visitor' || identity?.accountId === 'fixture-paper-teacher' ? [{
      id: 'fixture-question-1',
      subject: 'physics',
      type: 'single_choice',
      stemPreview: 'Which force changes an object velocity?',
      options: ['A. Balanced force', 'B. Net force'],
      answer: 'B. Net force',
      explanation: 'A non-zero net force changes velocity.',
      difficulty: 2,
      source: '2026 city mock',
      knowledgeLabels: ['Dynamics'],
      status: 'published',
    }] : [];
    return { statusCode: 200, body: { ok: true, questions } };
  }
  if (pathname === '/api/business/miniapp-paper-export-tasks' && request.method === 'POST') {
    return { statusCode: 202, body: { ok: true, task: { taskId: 'paper_task_fixture', status: 'completed', phase: 'completed', progress: 100, requestHash: 'f'.repeat(64), createdAt: '2026-08-27T00:00:00.000Z', updatedAt: '2026-08-27T00:00:00.000Z' } } };
  }
  if (/^\/api\/business\/miniapp-paper-export-tasks\/paper_task_fixture$/.test(pathname)) {
    return { statusCode: 200, body: { ok: true, task: { taskId: 'paper_task_fixture', status: 'completed', phase: 'completed', progress: 100, requestHash: 'f'.repeat(64), createdAt: '2026-08-27T00:00:00.000Z', updatedAt: '2026-08-27T00:00:00.000Z' } } };
  }
  if (/^\/api\/business\/miniapp-paper-export-tasks\/paper_task_fixture\/delivery$/.test(pathname) && request.method === 'POST') {
    return { statusCode: 200, body: { ok: true, delivery: { deliveryId: 'delivery_fixture', status: 'ready', artifactId: 'paper_artifact_fixture', fileName: 'fixture-paper.pdf', mimeType: 'application/pdf', expiresAt: '2026-08-27T00:15:00.000Z' } } };
  }
  if (pathname === '/api/business/miniapp-artifact-deliveries/delivery_fixture/download') {
    return { statusCode: 200, bytes: validPdfFixture(), contentType: 'application/pdf' };
  }
  if (pathname === '/api/miniapp/role-applications/me') return { statusCode: 200, body: { ok: true, state: 'not_submitted', application: null } };
  if (['/api/students', '/api/courses', '/api/schedules', '/api/teachers', '/api/payments', '/api/grades', '/api/modules'].includes(pathname)) return { statusCode: 200, body: { success: true, data: [] } };
  return { statusCode: 200, body: { success: true, data: {} } };
}

function startFixtureServer(port = FIXTURE_PORT, initialScenario = null) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('fixture server port is invalid');
  const requests = [];
  let activeScenario = initialScenario;
  const server = http.createServer((request, response) => {
    requests.push({ scenarioId: activeScenario?.id || '', method: request.method, path: String(request.url || '').replace(/([?&])_t=\d+/g, '$1_t=[timestamp]') });
    const fixture = fixtureResponse(request, activeScenario);
    response.writeHead(fixture.statusCode, { 'Content-Type': fixture.contentType || 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    response.end(Buffer.isBuffer(fixture.bytes) ? fixture.bytes : JSON.stringify(fixture.body));
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({
      server, requests, setScenario: scenario => { activeScenario = scenario; },
    }));
  });
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function launchRoute(scenario) {
  if (scenario.id === 'desktop-login-confirmation') return `${scenario.route}?desktopLogin=1&pairingId=fixture-pairing&secret=fixture-secret`;
  if (scenario.route === 'pages/schedule/detail/index') return `${scenario.route}?id=missing-fixture-schedule`;
  if (scenario.route === 'pages/student-detail/index') return `${scenario.route}?id=missing-fixture-student`;
  return scenario.route;
}

function expectedRoute(scenario) { return scenario.route; }

async function setScenarioIdentity(miniProgram, role) {
  const identity = identities[role];
  await miniProgram.evaluate(function setFixtureIdentity(payload) {
    const nextIdentity = payload.nextIdentity;
    const token = payload.token;
    const fixtureBase = payload.fixtureBase;
    wx.setStorageSync('scheduling_api_base_url', fixtureBase);
    if (nextIdentity) {
      wx.setStorageSync('auth_token', token);
      wx.setStorageSync('user_info', nextIdentity);
      wx.setStorageSync('user_permissions', { identity: nextIdentity, capabilities: nextIdentity.capabilities || [] });
      // The miniapp API client accepts only a trusted, non-invalidated session.
      // A fixture is not a login flow, so supply the same persisted state that
      // the normal session activation writes before opening a data page.
      wx.setStorageSync('auth_session_generation', 0);
      wx.setStorageSync('auth_session_state_v1', { version: 1, generation: 0, invalidated: false });
    }
  }, { nextIdentity: identity, token: identity ? `fixture-${role}` : '', fixtureBase: FIXTURE_BASE });
}

async function resetScenarioPage(miniProgram, scenarioId) {
  await miniProgram.evaluate(function clearFixtureStorage(fixtureBase) {
    wx.clearStorageSync();
    wx.setStorageSync('scheduling_api_base_url', fixtureBase);
  }, FIXTURE_BASE);
  await reLaunchPage(miniProgram, `/pages/login/index?fixtureReset=${encodeURIComponent(scenarioId)}`);
  // Let the app's unauthenticated startup fallback settle before writing the
  // next fixture session. Otherwise that stale fallback can redirect the next
  // authenticated scenario back to the login page.
  await wait(850);
}

async function launchScenarioPage(miniProgram, scenario) {
  if (scenario.interaction === 'tap-privacy-link') {
    await wait(500);
    const loginPage = await miniProgram.currentPage();
    const privacyLink = await loginPage?.$('.privacy-link');
    assert.ok(privacyLink, 'privacy acceptance could not find the login-page privacy guidance link');
    await privacyLink.tap();
    await wait(350);
    return miniProgram.currentPage();
  }
  const page = await reLaunchPage(miniProgram, `/${launchRoute(scenario)}`);
  if (!scenario.interaction) return page;

  const waitForElement = async (selector, description) => {
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const current = await miniProgram.currentPage();
      const element = await current?.$(selector);
      if (element) return element;
      await wait(250);
    }
    assert.fail(`${scenario.id} could not find ${description} (${selector})`);
  };

  if (scenario.interaction === 'expand-first-answer') {
    const answerToggle = await waitForElement('.question-answer-toggle', 'the first answer toggle');
    await answerToggle.tap();
    await wait(350);
    return miniProgram.currentPage();
  }

  if (scenario.interaction === 'open-first-question-basket') {
    const basketToggle = await waitForElement('.basket-toggle', 'the first add-to-basket action');
    await basketToggle.tap();
    const floatingBasket = await waitForElement('.global-question-basket', 'the global floating question basket');
    await floatingBasket.tap();
    await waitForElement('.question-basket-drawer', 'the question basket drawer');
    await wait(350);
    return miniProgram.currentPage();
  }

  assert.fail(`${scenario.id} declares an unsupported interaction: ${scenario.interaction}`);
}

async function run() {
  const compiledCommon = fs.readFileSync(path.join(ROOT, 'miniapp', 'dist', 'common.js'), 'utf8');
  assert.ok(
    compiledCommon.includes(FIXTURE_BASE),
    `miniapp must be built with MINIAPP_CLOUD_BUSINESS_API_BASE_URL=${FIXTURE_BASE} before fixture capture`,
  );
  fs.mkdirSync(OUTPUT, { recursive: true });
  const registered = pageInventory.map(entry => entry.route);
  assert.ok(scenarios.length > 0, 'runtime scenario filter did not match any scenario');
  if (!focusedRun) {
    assert.deepStrictEqual([...new Set(scenarios.map(item => item.route))].sort(), registered.slice().sort(), 'runtime scenarios must cover every registered page');
  }
  const { server, requests, setScenario } = await startFixtureServer();
  let miniProgram;
  try {
    if (process.env.MINIAPP_AUTOMATION_LAUNCH === '1') {
      const port = Number(process.env.MINIAPP_AUTOMATION_PORT || 9520);
      assert.ok(Number.isInteger(port) && port > 0 && port <= 65535, 'miniapp automation port is invalid');
      try {
        miniProgram = await automator.launch({
          projectPath: path.join(ROOT, 'miniapp', 'dist'),
          port,
          timeout: 60000,
          trustProject: true,
          ...(process.env.WECHAT_DEVTOOLS_CLI ? { cliPath: process.env.WECHAT_DEVTOOLS_CLI } : {}),
        });
      } catch (launchError) {
        miniProgram = await connectLaunchedAutomation(`ws://127.0.0.1:${port}`);
      }
    } else {
      const wsEndpoint = String(process.env.MINIAPP_AUTOMATION_WS_ENDPOINT || 'ws://127.0.0.1:9420').trim();
      miniProgram = await connectAutomation(wsEndpoint);
    }
  } catch (error) {
    await new Promise(resolve => server.close(resolve));
    throw error;
  }
  const consoleEvents = [];
  const exceptionEvents = [];
  miniProgram.on('console', event => consoleEvents.push(String(event)));
  miniProgram.on('exception', event => exceptionEvents.push(String(event)));
  const results = [];
  try {
    for (const scenario of scenarios) {
      setScenario(scenario);
      await resetScenarioPage(miniProgram, scenario.id);
      await setScenarioIdentity(miniProgram, scenario.identity);
      const page = await launchScenarioPage(miniProgram, scenario);
      await page.waitFor(SCREENSHOT_WAIT_MS);
      const current = await miniProgram.currentPage();
      const sourceRoute = scenario.route;
      const expected = expectedRoute(scenario);
      const actual = current?.path || '';
      const screenshot = path.join(OUTPUT, `${String(results.length + 1).padStart(2, '0')}-${scenario.id}.png`);
      await miniProgram.screenshot({ path: screenshot });
      const pageNode = await current.$('page');
      const textSample = pageNode ? String(await pageNode.text()).replace(/\s+/g, ' ').trim().slice(0, 240) : '';
      const textMatched = textSample.includes(scenario.expectedText);
      results.push({
        scenarioId: scenario.id,
        route: sourceRoute,
        expectedRoute: expected,
        identity: scenario.identity,
        actualRoute: actual,
        role: scenario.roleView,
        state: scenario.state,
        categories: scenario.categories,
        fixtureMode: scenario.fixtureMode,
        interaction: scenario.interaction || '',
        routeMatched: actual === expected,
        expectedText: scenario.expectedText,
        textMatched,
        screenshot: path.relative(OUTPUT, screenshot).replace(/\\/g, '/'),
        bytes: fs.statSync(screenshot).size,
        sha256: sha256(screenshot),
        textSample,
      });
      process.stdout.write(`[miniapp-ui] ${results.length}/${scenarios.length} ${scenario.id} -> ${actual} text=${textMatched}\n`);
    }
  } finally {
    await miniProgram.close();
    await new Promise(resolve => server.close(resolve));
  }

  const fatalExceptions = exceptionEvents.filter(value => !/request:fail|network/i.test(value));
  const report = {
    version: VERSION,
    generatedAt: new Date().toISOString(),
    runtime: 'WeChat DevTools miniprogram-automator',
    fixtureBase: FIXTURE_BASE,
    fixtureOnly: true,
    completed: results.length === scenarios.length && results.every(item => item.routeMatched && item.textMatched && item.bytes > 0),
    registeredPageCount: registered.length,
    screenshotCount: results.length,
    rolesCovered: [...new Set(results.map(item => item.role))],
    requiredStatesCovered: [...new Set(results.flatMap(item => item.categories))],
    requiredCoverageCategories: REQUIRED_COVERAGE_CATEGORIES,
    requests: requests.slice(0, 200),
    consoleEventCount: consoleEvents.length,
    exceptionEventCount: exceptionEvents.length,
    fatalExceptions,
    pages: results,
  };
  const runtimeCategoriesComplete = REQUIRED_COVERAGE_CATEGORIES.every(category => report.requiredStatesCovered.includes(category));
  report.completed = report.completed && (focusedRun || runtimeCategoriesComplete);
  fs.writeFileSync(path.join(OUTPUT, 'matrix.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  const lines = [
    `# 格物工坊小程序 ${VERSION} 全页面运行验收`, '',
    `- 微信开发者工具实机场景：${results.length}/${scenarios.length}（覆盖 ${registered.length} 个注册页面）`,
    `- 截图：${results.length}`, '- 数据源：仅本机 fixture，不访问生产业务接口',
    `- 结果：${report.completed && fatalExceptions.length === 0 ? '通过' : '未通过'}`, '',
    '| 场景 | 页面 | 角色 | 检查状态 | 路由/文字 | 截图 |', '|---|---|---|---|---|---|',
    ...results.map(item => `| ${item.scenarioId} | ${item.route} | ${item.role} | ${item.state} | ${item.routeMatched && item.textMatched ? '通过' : `失败:${item.actualRoute}/${item.expectedText}`} | ${item.screenshot} |`),
    '', `完整机器可读证据：${path.join(OUTPUT, 'matrix.json')}`, '',
  ];
  fs.writeFileSync(path.join(OUTPUT, 'README.md'), lines.join('\n'), 'utf8');
  assert.ok(report.completed, 'miniapp runtime UI matrix is incomplete');
  assert.deepStrictEqual(fatalExceptions, [], 'miniapp runtime emitted fatal exceptions');
  console.log(`[miniapp-ui] passed: ${results.length}/${registered.length}`);
  console.log(`[miniapp-ui] evidence: ${OUTPUT}`);
}

if (require.main === module) {
  if (process.env.MINIAPP_UI_FIXTURE_SERVER === '1') {
    const standaloneScenario = resolveStandaloneFixtureScenario({
      scenarioId: process.env.MINIAPP_UI_FIXTURE_SCENARIO_ID,
      fixtureMode: process.env.MINIAPP_UI_FIXTURE_MODE,
    });
    startFixtureServer(FIXTURE_PORT, standaloneScenario).then(({ server }) => {
      console.log(`[miniapp-ui] fixture server listening at ${FIXTURE_BASE}`);
      const close = () => server.close(() => process.exit(0));
      process.once('SIGINT', close);
      process.once('SIGTERM', close);
    }).catch(error => {
      console.error(error && (error.stack || error.message || error));
      process.exitCode = 1;
    });
  } else {
    run().catch(error => {
      console.error(error && (error.stack || error.message || error));
      process.exitCode = 1;
    });
  }
}

module.exports = {
  startFixtureServer,
  fixtureResponse,
  validPdfFixture,
  resolveFixturePort,
  resolveStandaloneFixtureScenario,
  richPhysicsQuestions,
  RICH_VISITOR_QUESTION_LIMIT,
};
