'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { pageInventory } = require('../miniapp/src/utils/miniappUiPageInventory');

const ROOT = path.resolve(__dirname, '..');
const automator = require(path.join(ROOT, 'miniapp', 'node_modules', 'miniprogram-automator'));
const VERSION = require('../package.json').version;
const OUTPUT = path.join(ROOT, 'output', `miniapp-${VERSION}-ui-coverage`, 'runtime-fixture-matrix');
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

const scenarios = [
  ['pages/login/index', 'guest', 'cloud-login'],
  ['pages/login/privacy', 'guest', 'privacy-content'],
  ['pages/desktop-authorization/index?challengeId=fixture-challenge-1234', 'guest', 'phone-required'],
  ['pages/desktop-online-registration/index', 'guest', 'scan-code'],
  ['pages/index/index', 'super_admin', 'admin-dashboard'],
  ['pages/schedule/index', 'student', 'empty-day'],
  ['pages/schedule/detail/index?id=missing-fixture-schedule', 'student', 'missing-record'],
  ['pages/schedule/edit/index', 'student', 'miniapp-readonly-boundary'],
  ['pages/students/index', 'admin', 'empty'],
  ['pages/student-detail/index?id=missing-fixture-student', 'admin', 'missing-student'],
  ['pages/courses/index', 'admin', 'empty'],
  ['pages/teachers/index', 'teacher', 'empty'],
  ['pages/payments/index', 'admin', 'empty'],
  ['pages/stats/index', 'admin', 'empty'],
  ['pages/question-bank/index', 'student', 'preview-empty'],
  ['pages/assets/index', 'admin', 'empty'],
  ['pages/settings/index', 'student', 'online'],
  ['pages/admin/users/index', 'super_admin', 'empty'],
  ['pages/forbidden/index', 'student', 'blocked-module'],
  ['pages/unrecognized-experience/index', 'unrecognized', 'welcome'],
  ['pages/account-application/index', 'visitor', 'not-submitted'],
  ['pages/cloud-account-admin/index', 'super_admin', 'empty'],
].map(([route, role, state]) => ({ route, role, state }));

function routeOnly(value) {
  return value.split('?')[0];
}

function fixtureIdentityFromRequest(request) {
  const token = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const role = token.replace(/^fixture-/, '');
  return identities[role] || identities.admin;
}

function fixtureResponse(request) {
  const url = new URL(request.url, FIXTURE_BASE);
  const pathname = url.pathname;
  const identity = fixtureIdentityFromRequest(request);
  if (/^\/api\/desktop-identity\/challenges\/[^/]+\/public$/.test(pathname)) {
    const id = decodeURIComponent(pathname.split('/')[4]);
    return { success: true, data: { challenge: {
      id, deviceName: '验收电脑', keyFingerprintSummary: 'ABCD…1234', purpose: 'register',
      status: 'pending_phone_identity', createdAt: '2026-08-24T00:00:00.000Z',
      expiresAt: '2026-08-24T01:00:00.000Z', rowVersion: 1,
    } } };
  }
  if (pathname === '/api/permissions/my') {
    return { success: true, data: { identity, capabilities: capabilitiesByRole[identity?.role] || identity?.capabilities || [] } };
  }
  if (pathname === '/api/business/miniapp-projection') {
    const projection = {};
    for (const table of ['students', 'studentContacts', 'teachers', 'courses', 'schedules', 'institutions', 'schools', 'rooms', 'assetRecords', 'assetCategories']) projection[table] = [];
    return { success: true, data: { ok: true, projection } };
  }
  if (pathname === '/api/business/miniapp-question-previews') return { success: true, data: { questions: [] } };
  if (pathname === '/api/miniapp/cloud-accounts') return { success: true, data: { accounts: [] } };
  if (pathname === '/api/miniapp/business-profiles') return { success: true, data: { profiles: [] } };
  if (pathname === '/api/admin/users') return { success: true, data: { users: [], total: 0 } };
  if (pathname === '/api/miniapp/applications/me') return { success: true, data: { state: 'not_submitted', application: null } };
  if (pathname === '/api/experience/questions') return { success: true, data: { questions: [] } };
  if (['/api/students', '/api/courses', '/api/schedules', '/api/teachers', '/api/payments', '/api/grades', '/api/modules'].includes(pathname)) return { success: true, data: [] };
  return { success: true, data: {} };
}

function startFixtureServer() {
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push({ method: request.method, path: String(request.url || '').replace(/([?&])_t=\d+/g, '$1_t=[timestamp]') });
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    response.end(JSON.stringify(fixtureResponse(request)));
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(FIXTURE_PORT, '127.0.0.1', () => resolve({ server, requests }));
  });
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function safeName(route) {
  return routeOnly(route).replace(/^pages\//, '').replace(/\/index$/, '').replace(/\//g, '-') || 'index';
}

async function setScenarioIdentity(miniProgram, role) {
  const identity = identities[role];
  await miniProgram.evaluate(function setFixtureIdentity(payload) {
    const nextIdentity = payload.nextIdentity;
    const token = payload.token;
    const fixtureBase = payload.fixtureBase;
    wx.clearStorageSync();
    wx.setStorageSync('scheduling_api_base_url', fixtureBase);
    if (nextIdentity) {
      wx.setStorageSync('auth_token', token);
      wx.setStorageSync('user_info', nextIdentity);
      wx.setStorageSync('user_permissions', { identity: nextIdentity, capabilities: nextIdentity.capabilities || [] });
    }
  }, { nextIdentity: identity, token: identity ? `fixture-${role}` : '', fixtureBase: FIXTURE_BASE });
}

async function run() {
  fs.mkdirSync(OUTPUT, { recursive: true });
  const registered = pageInventory.map(entry => entry.route);
  assert.deepStrictEqual(scenarios.map(item => routeOnly(item.route)).sort(), registered.slice().sort(), 'runtime scenarios must cover every registered page exactly once');
  const { server, requests } = await startFixtureServer();
  const miniProgram = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
  const consoleEvents = [];
  const exceptionEvents = [];
  miniProgram.on('console', event => consoleEvents.push(String(event)));
  miniProgram.on('exception', event => exceptionEvents.push(String(event)));
  const results = [];
  try {
    for (const scenario of scenarios) {
      await setScenarioIdentity(miniProgram, scenario.role);
      const page = await miniProgram.reLaunch(`/${scenario.route}`);
      await page.waitFor(SCREENSHOT_WAIT_MS);
      const current = await miniProgram.currentPage();
      const expected = routeOnly(scenario.route);
      const actual = current?.path || '';
      const screenshot = path.join(OUTPUT, `${String(results.length + 1).padStart(2, '0')}-${safeName(scenario.route)}-${scenario.role}.png`);
      await miniProgram.screenshot({ path: screenshot });
      const pageNode = await current.$('page');
      const textSample = pageNode ? String(await pageNode.text()).replace(/\s+/g, ' ').trim().slice(0, 240) : '';
      results.push({
        route: expected,
        actualRoute: actual,
        role: scenario.role,
        state: scenario.state,
        routeMatched: actual === expected,
        screenshot: path.relative(OUTPUT, screenshot).replace(/\\/g, '/'),
        bytes: fs.statSync(screenshot).size,
        sha256: sha256(screenshot),
        textSample,
      });
      process.stdout.write(`[miniapp-ui] ${results.length}/${scenarios.length} ${expected} -> ${actual}\n`);
    }
  } finally {
    miniProgram.disconnect();
    await new Promise(resolve => server.close(resolve));
  }

  const fatalExceptions = exceptionEvents.filter(value => !/request:fail|network/i.test(value));
  const report = {
    version: VERSION,
    generatedAt: new Date().toISOString(),
    runtime: 'WeChat DevTools miniprogram-automator',
    fixtureBase: FIXTURE_BASE,
    fixtureOnly: true,
    completed: results.length === registered.length && results.every(item => item.routeMatched && item.bytes > 0),
    registeredPageCount: registered.length,
    screenshotCount: results.length,
    rolesCovered: [...new Set(results.map(item => item.role))],
    requiredStatesCovered: ['admin-path', 'student-path', 'empty', 'limited-write', 'permission-denied', 'guest', 'visitor', 'unrecognized-student'],
    requests: requests.slice(0, 200),
    consoleEventCount: consoleEvents.length,
    exceptionEventCount: exceptionEvents.length,
    fatalExceptions,
    pages: results,
  };
  fs.writeFileSync(path.join(OUTPUT, 'matrix.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  const lines = [
    `# 格物工坊小程序 ${VERSION} 全页面运行验收`, '',
    `- 微信开发者工具实机页面：${results.length}/${registered.length}`,
    `- 截图：${results.length}`, '- 数据源：仅本机 fixture，不访问生产业务接口',
    `- 结果：${report.completed && fatalExceptions.length === 0 ? '通过' : '未通过'}`, '',
    '| 页面 | 角色 | 检查状态 | 路由 | 截图 |', '|---|---|---|---|---|',
    ...results.map(item => `| ${item.route} | ${item.role} | ${item.state} | ${item.routeMatched ? '通过' : `失败:${item.actualRoute}`} | ${item.screenshot} |`),
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
