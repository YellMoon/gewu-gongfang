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
const VERSION = require('../package.json').version;
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
const FIXTURE_PORT = 3019;
const FIXTURE_BASE = `http://127.0.0.1:${FIXTURE_PORT}`;
const SCREENSHOT_WAIT_MS = 1100;

const capabilitiesByRole = Object.freeze({
  super_admin: ['business:all', 'users:review', 'applications:review', 'question-bank:view', 'question-bank:edit'],
  admin: ['business:all', 'question-bank:view'],
  teacher: ['business:teacher-scope', 'question-bank:view'],
  student: ['question-bank:view'],
});

function normalIdentity(role) {
  const identity = {
    id: `fixture-${role}`,
    name: role === 'student' ? '学生验收账号' : role === 'teacher' ? '教师验收账号' : '管理验收账号',
    role,
    user_type: role,
    token_use: 'miniapp-cloud',
    account_state: 'formal',
    tenant_id: 'fixture-tenant',
    review_status: 'approved',
    status: 1,
    login_enabled: 1,
    active: true,
    deleted: false,
    disabled: false,
    capabilities: capabilitiesByRole[role] || [],
  };
  if (role === 'teacher') identity.teacher_id = 'fixture-teacher';
  if (role === 'student') {
    identity.student_id = 'fixture-student';
    identity.linked_student_ids = ['fixture-student'];
  }
  return identity;
}

const identities = Object.freeze({
  guest: null,
  super_admin: normalIdentity('super_admin'),
  admin: normalIdentity('admin'),
  teacher: normalIdentity('teacher'),
  student: normalIdentity('student'),
  visitor: {
    id: 'fixture-visitor', name: '访客验收账号', role: 'visitor', user_type: 'visitor',
    identity_kind: 'visitor', account_state: 'visitor', token_use: 'miniapp-visitor',
    authority_id: 'fixture-authority',
    capabilities: ['projection:read', 'role-application:read', 'role-application:submit', 'question-preview:read'],
  },
  unrecognized: {
    id: 'fixture-unrecognized', name: '未识别学生', role: 'student', user_type: 'student',
    account_state: 'unrecognized', token_use: 'unrecognized-student',
    capabilities: ['experience:read', 'profile-application:read', 'profile-application:submit', 'sample-questions:view'],
  },
});

function fixtureIdentityFromRequest(request) {
  const token = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const role = token.replace(/^fixture-/, '');
  return identities[role] || identities.admin;
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
  if (scenario?.fixtureMode === 'application-offline' && pathname === '/api/miniapp/applications/me') {
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
  if (pathname === '/api/permissions/my') {
    return { statusCode: 200, body: { success: true, data: { identity, capabilities: capabilitiesByRole[identity?.role] || identity?.capabilities || [] } } };
  }
  if (pathname === '/api/business/miniapp-projection') {
    const projection = {};
    for (const table of ['students', 'studentContacts', 'teachers', 'courses', 'schedules', 'institutions', 'schools', 'rooms', 'assetRecords', 'assetCategories']) projection[table] = [];
    return { statusCode: 200, body: { ok: true, projection } };
  }
  if (pathname === '/api/business/miniapp-question-previews') return { statusCode: 200, body: { ok: true, questions: [] } };
  if (pathname === '/api/miniapp/cloud-accounts') return { statusCode: 200, body: { ok: true, accounts: [] } };
  if (pathname === '/api/miniapp/business-profiles') return { statusCode: 200, body: { ok: true, profiles: [] } };
  if (pathname === '/api/admin/users') {
    const users = scenario?.fixtureMode === 'users-one' ? [{
      id: 'fixture-pending-user', name: '待审核用户', phone: '138****0000', user_type: 'teacher',
      review_status: 'pending', status: 1, login_enabled: 1, teacher_id: 'fixture-teacher',
    }] : [];
    return { statusCode: 200, body: { success: true, data: { users, total: users.length } } };
  }
  if (pathname === '/api/miniapp/applications/me') return { statusCode: 200, body: { success: true, data: { state: 'not_submitted', application: null } } };
  if (pathname === '/api/experience/questions') return { statusCode: 200, body: { success: true, data: { questions: [] } } };
  if (['/api/students', '/api/courses', '/api/schedules', '/api/teachers', '/api/payments', '/api/grades', '/api/modules'].includes(pathname)) return { statusCode: 200, body: { success: true, data: [] } };
  return { statusCode: 200, body: { success: true, data: {} } };
}

function startFixtureServer() {
  const requests = [];
  let activeScenario = null;
  const server = http.createServer((request, response) => {
    requests.push({ scenarioId: activeScenario?.id || '', method: request.method, path: String(request.url || '').replace(/([?&])_t=\d+/g, '$1_t=[timestamp]') });
    const fixture = fixtureResponse(request, activeScenario);
    response.writeHead(fixture.statusCode, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    response.end(JSON.stringify(fixture.body));
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(FIXTURE_PORT, '127.0.0.1', () => resolve({
      server, requests, setScenario: scenario => { activeScenario = scenario; },
    }));
  });
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function launchRoute(scenario) {
  if (scenario.route === 'pages/schedule/detail/index') return `${scenario.route}?id=missing-fixture-schedule`;
  if (scenario.route === 'pages/student-detail/index') return `${scenario.route}?id=missing-fixture-student`;
  return scenario.route;
}

function expectedRoute(scenario) {
  return scenario.route === 'pages/question-bank/index' && scenario.identity === 'unrecognized'
    ? 'pages/unrecognized-experience/index'
    : scenario.route;
}

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
    }
  }, { nextIdentity: identity, token: identity ? `fixture-${role}` : '', fixtureBase: FIXTURE_BASE });
}

async function resetScenarioPage(miniProgram, scenarioId) {
  await miniProgram.evaluate(function clearFixtureStorage(fixtureBase) {
    wx.clearStorageSync();
    wx.setStorageSync('scheduling_api_base_url', fixtureBase);
  }, FIXTURE_BASE);
  const resetPage = await miniProgram.reLaunch(`/pages/login/index?fixtureReset=${encodeURIComponent(scenarioId)}`);
  await resetPage.waitFor(150);
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
      miniProgram = await automator.launch({
        projectPath: path.join(ROOT, 'miniapp', 'dist'),
        port,
        timeout: 60000,
        trustProject: true,
      });
    } else {
      const wsEndpoint = String(process.env.MINIAPP_AUTOMATION_WS_ENDPOINT || 'ws://127.0.0.1:9420').trim();
      miniProgram = await automator.connect({ wsEndpoint });
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
      const page = await miniProgram.reLaunch(`/${launchRoute(scenario)}`);
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
        actualRoute: actual,
        role: scenario.roleView,
        state: scenario.state,
        categories: scenario.categories,
        fixtureMode: scenario.fixtureMode,
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

run().catch(error => {
  console.error(error && (error.stack || error.message || error));
  process.exitCode = 1;
});
