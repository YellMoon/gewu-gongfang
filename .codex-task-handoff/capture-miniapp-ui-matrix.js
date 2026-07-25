'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const automator = require('../output/miniapp-automation/node_modules/miniprogram-automator');
const WebSocket = require('../output/miniapp-automation/node_modules/ws');
const { businessCacheIdentityKey } = require('../miniapp/src/utils/miniappAuthorizationRuntime');

const root = path.resolve(__dirname, '..');
const endpoint = process.argv[2] || 'ws://127.0.0.1:9432';
const outputDir = path.join(root, 'output', 'miniapp-6.1.0-ui-coverage', 'runtime-fixture-matrix');
const appConfigPath = path.join(root, 'miniapp', 'src', 'app.config.ts');
const GENERATION = 9007199254739000;

const now = new Date();
const today = now.toISOString().slice(0, 10);
const month = today.slice(0, 7);
const createdAt = `${today}T08:00:00.000Z`;

const fixtureData = {
  students: [{
    id: 'student-1', name: '验收学生', phone: '已脱敏', parent_phone: '已脱敏',
    parent_name: '验收家长', parent_relation: '妈妈', school: '验收中学', grade_current: '高二',
    active: true, created_at: createdAt, updated_at: createdAt,
  }],
  courses: [{
    id: 'course-1', name: '高二物理验收课', display_name: '高二物理验收课', type: 1,
    source_type: 1, price_tuition: 320, price_teacher: 160, billing_unit: 2,
    teacher_fee_mode: 1, teacher_id: 'teacher-1', teacher_name: '验收老师',
    student_ids: ['student-1'], student_pricings: [{ student_id: 'student-1', tuition: 320 }],
    active: true, created_at: createdAt, updated_at: createdAt,
  }],
  schedules: [
    {
      id: 'schedule-1', course_id: 'course-1', start_time: `${today}T10:00:00.000Z`,
      end_time: `${today}T11:30:00.000Z`, status: 1, room: '验收教室', service_type: 1,
      student_ids: ['student-1'], student_pricings: [{ student_id: 'student-1', tuition: 320 }],
      calculated_tuition: 320, calculated_teacher_fee: 160, created_at: createdAt, updated_at: createdAt,
    },
    {
      id: 'schedule-2', course_id: 'course-1', start_time: `${month}-08T10:00:00.000Z`,
      end_time: `${month}-08T11:30:00.000Z`, status: 2, room: '验收教室', service_type: 1,
      student_ids: ['student-1'], calculated_tuition: 320, calculated_teacher_fee: 160,
      created_at: createdAt, updated_at: createdAt,
    },
  ],
  teachers: [{
    id: 'teacher-1', name: '验收老师', phone: '已脱敏', subject: '物理', active: true,
    created_at: createdAt, updated_at: createdAt,
  }],
  payments: [{
    id: 'payment-1', student_id: 'student-1', amount: 1280, payment_date: today,
    payment_method: '微信', notes: '验收记录', created_at: createdAt,
  }],
  grades: [{
    id: 'grade-1', student_id: 'student-1', subject: '物理', score: 92,
    exam_name: '验收测验', exam_date: today, created_at: createdAt,
  }],
  consumptions: [],
  assetRecords: [
    { id: 'asset-1', category_id: 'category-income', amount: 2600, type: 'income', date: today, notes: '验收收入' },
    { id: 'asset-2', category_id: 'category-expense', amount: 380, type: 'expense', date: today, notes: '验收支出' },
  ],
  assetCategories: [
    { id: 'category-income', name: '课程收入', type: 'income', color: '#2f8f83' },
    { id: 'category-expense', name: '教学支出', type: 'expense', color: '#c9824b' },
  ],
  questions: [],
};

const formalQuestions = [
  { id: 'question-1', type: '选择题', stemPreview: '小球做匀加速直线运动，判断速度变化。', status: '可用' },
  { id: 'question-2', type: '计算题', stemPreview: '根据牛顿第二定律计算物体加速度。', status: '可用' },
];

const experienceQuestions = [
  {
    id: 'sample-1', number: 1, type: '选择题', stemRichContent: '关于匀速直线运动，下列说法正确的是？',
    options: [{ key: 'A', contentRichContent: '速度保持不变' }, { key: 'B', contentRichContent: '加速度不断增大' }],
    answer: 'A', explanationRichContent: '匀速直线运动速度保持不变。', sourceLabel: '固定脱敏示例题',
  },
  {
    id: 'sample-2', number: 2, type: '计算题', stemRichContent: '质量为 2 kg 的物体受到 6 N 合力，求加速度。',
    options: [], answer: '3 m/s²', explanationRichContent: '由 F=ma 得 a=3 m/s²。', sourceLabel: '固定脱敏示例题',
  },
];

const modules = [
  ['scheduling', '课程表'], ['question-bank', '题库组卷'], ['assets', '财务资产'],
  ['students', '学生管理'], ['courses', '课程管理'], ['teachers', '教师管理'],
  ['payments', '缴费记录'], ['stats', '数据统计'], ['admin', '权限管理'],
].map(([id, name]) => ({ id, name, description: `${name}真实功能入口`, icon: '' }));

const identities = {
  super_admin: {
    id: 'fixture-super-admin', name: '验收超级管理员', user_type: 'super_admin', tenant_id: 'fixture-tenant',
    active: 1, status: 1, login_enabled: 1, review_status: 'approved', account_state: 'formal',
  },
  admin: {
    id: 'fixture-admin', name: '验收管理员', user_type: 'admin', tenant_id: 'fixture-tenant',
    active: 1, status: 1, login_enabled: 1, review_status: 'approved', account_state: 'formal',
  },
  teacher: {
    id: 'fixture-teacher-user', name: '验收老师', user_type: 'teacher', teacher_id: 'teacher-1',
    tenant_id: 'fixture-tenant', active: 1, status: 1, login_enabled: 1, review_status: 'approved', account_state: 'formal',
  },
  student: {
    id: 'student-1', name: '验收学生', user_type: 'student', student_id: 'student-1',
    linked_student_ids: ['student-1'], tenant_id: 'fixture-tenant', active: 1, status: 1,
    login_enabled: 1, review_status: 'approved', account_state: 'formal',
  },
  parent: {
    id: 'fixture-parent', name: '验收家长', user_type: 'student', linked_student_ids: ['student-1'],
    tenant_id: 'fixture-tenant', active: 1, status: 1, login_enabled: 1, review_status: 'approved',
    account_state: 'formal', viewer_kind: 'parent',
  },
  unrecognized: {
    id: 'fixture-unrecognized', name: '体验学生', user_type: 'student', phone: '已验证号码（脱敏）',
    active: 1, status: 1, login_enabled: 1, review_status: 'approved',
    account_state: 'unrecognized', token_use: 'unrecognized-student',
    capabilities: ['experience:read', 'profile-application:read', 'profile-application:submit', 'sample-questions:view', 'sample-paper-export'],
  },
};

const roleCapabilities = {
  super_admin: ['users:review', 'applications:review', 'business:all', 'question-bank:view', 'question-bank:edit'],
  admin: ['business:all', 'question-bank:view', 'question-bank:edit'],
  teacher: ['business:teacher-scope', 'question-bank:view', 'question-bank:edit'],
  student: ['question-bank:view'],
  parent: ['question-bank:view'],
  unrecognized: identities.unrecognized.capabilities,
  guest: [],
};

const scenarios = [
  { route: 'pages/login/index', role: 'guest', state: 'wechat-login' },
  { route: 'pages/login/privacy', role: 'guest', state: 'privacy-content' },
  { route: 'pages/desktop-authorization/index', query: 'challengeId=fixture-challenge-0001', role: 'guest', state: 'host-bootstrap-phone-required' },
  { route: 'pages/index/index', role: 'super_admin', state: 'admin-dashboard' },
  { route: 'pages/forbidden/index', role: 'student', state: 'blocked-module' },
  { route: 'pages/schedule/index', role: 'student', state: 'week-view' },
  { route: 'pages/schedule/detail/index', query: 'id=schedule-1', role: 'student', state: 'missing-record' },
  { route: 'pages/schedule/edit/index', query: 'id=schedule-1', role: 'student', state: 'miniapp-readonly-boundary' },
  { route: 'pages/students/index', role: 'teacher', state: 'list' },
  { route: 'pages/student-detail/index', query: 'id=student-1', role: 'parent', state: 'missing-student' },
  { route: 'pages/courses/index', role: 'teacher', state: 'active-courses' },
  { route: 'pages/teachers/index', role: 'teacher', state: 'list' },
  { route: 'pages/payments/index', role: 'admin', state: 'summary' },
  { route: 'pages/stats/index', role: 'super_admin', state: 'revenue-summary' },
  { route: 'pages/question-bank/index', role: 'student', state: 'paper-form', navigation: 'navigateTo', waitMs: 5000 },
  { route: 'pages/assets/index', role: 'admin', state: 'overview' },
  { route: 'pages/settings/index', role: 'unrecognized', state: 'unrecognized-account-application' },
  { route: 'pages/admin/users/index', role: 'admin', state: 'ordinary-admin-read-only' },
  { route: 'pages/unrecognized-experience/index', role: 'unrecognized', state: 'question-bank-preview' },
  { route: 'pages/account-application/index', role: 'unrecognized', state: 'not-submitted', navigation: 'navigateTo' },
];

function cleanRoute(route) {
  return route.replace(/^\//, '');
}

function screenshotName(scenario) {
  return `${String(scenarios.indexOf(scenario) + 1).padStart(2, '0')}-${scenario.route.replaceAll('/', '__')}-${scenario.role}-${scenario.state}.png`;
}

function fixtureStorage(role, apiBaseUrl = 'https://fixture.invalid/scheduling') {
  if (role === 'guest') return {};
  const identity = identities[role];
  const values = {
    auth_token: `fixture-${role}-token`,
    user_info: identity,
    auth_session_generation: GENERATION,
    auth_session_state_v1: { version: 1, generation: GENERATION, invalidated: false },
    scheduling_api_base_url: apiBaseUrl,
  };
  const cacheIdentity = businessCacheIdentityKey(identity);
  if (cacheIdentity) {
    values.sch_cache_identity = cacheIdentity;
    for (const [table, rows] of Object.entries(fixtureData)) {
      values[`sch_cache_${cacheIdentity}_${table}`] = rows;
    }
    values[`sch_cache_${cacheIdentity}_pending_changes`] = [];
  }
  return values;
}

function fixtureFor(role) {
  const identity = identities[role] || null;
  return {
    role,
    identity,
    capabilities: roleCapabilities[role] || [],
    modules,
    ...fixtureData,
    formalQuestions,
    experienceQuestions,
    snapshotPublishedAt: createdAt,
    challenge: {
      id: 'fixture-challenge-0001', deviceName: '验收数据主机', keyFingerprintSummary: 'SHA256:fixture…0001',
      purpose: 'primary-host-bootstrap', status: 'pending_phone', createdAt,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(), rowVersion: 1,
    },
    users: [
      { id: 'fixture-pending-user', name: '待审核用户', user_type: 'pending', review_status: 'pending', active: 1 },
      { id: 'fixture-teacher-user', name: '验收老师', user_type: 'teacher', teacher_id: 'teacher-1', review_status: 'approved', active: 1 },
    ],
  };
}

function fixtureResponse(url, fixture, fixtureBaseUrl = 'https://fixture.invalid') {
  const ok = (data) => data;
  if (url.includes('/api/permissions/my')) {
    return ok({ success: true, data: { identity: fixture.identity, capabilities: fixture.capabilities } });
  }
  if (url.includes('/api/modules')) return ok({ success: true, data: { modules: fixture.modules } });
  if (url.includes('/api/cloud/snapshots/read')) {
    return ok({ success: true, data: { snapshot: { publishedAt: fixture.snapshotPublishedAt, payload: {
      students: fixture.students, courses: fixture.courses, schedules: fixture.schedules,
      teachers: fixture.teachers, payments: fixture.payments, consumptions: fixture.consumptions,
      assetRecords: fixture.assetRecords, assetCategories: fixture.assetCategories,
      questions: fixture.formalQuestions,
    } } } });
  }
  if (url.includes('/api/cloud/snapshots/questions')) {
    return ok({ success: true, questions: fixture.formalQuestions, hostAvailable: true,
      targetHostDeviceId: 'fixture-host-device', hostBaseUrl: fixtureBaseUrl });
  }
  if (url.includes('/api/desktop-identity/challenges/')) {
    return ok({ success: true, data: { challenge: fixture.challenge } });
  }
  if (url.includes('/api/admin/users')) {
    return ok({ success: true, data: { users: fixture.users, total: fixture.users.length } });
  }
  if (url.includes('/api/miniapp/applications/admin')) {
    return ok({ success: true, data: { items: [] } });
  }
  if (url.includes('/api/miniapp/applications/me')) {
    return ok({ success: true, data: { state: 'not_submitted', application: null } });
  }
  if (url.includes('/api/experience/questions')) {
    return ok({ success: true, questions: fixture.experienceQuestions });
  }
  if (url.includes('/api/students')) return ok({ success: true, data: fixture.students });
  if (url.includes('/api/courses')) return ok({ success: true, data: fixture.courses });
  if (url.includes('/api/schedules')) return ok({ success: true, data: fixture.schedules });
  if (url.includes('/api/teachers')) return ok({ success: true, data: fixture.teachers });
  if (url.includes('/api/payments')) return ok({ success: true, data: fixture.payments });
  if (url.includes('/api/grades')) return ok({ success: true, data: fixture.grades });
  return ok({ success: true, data: {} });
}

function requestFixture(options, fixture) {
  const url = String((options && options.url) || '');
  globalThis.__gewuFixtureRequestUrls = Array.isArray(globalThis.__gewuFixtureRequestUrls)
    ? globalThis.__gewuFixtureRequestUrls
    : [];
  globalThis.__gewuFixtureRequestUrls.push(url.replace(/^https?:\/\/[^/]+/, '').split('?')[0]);
  const respond = (data) => {
    const response = { statusCode: 200, data, header: { 'content-type': 'application/json' } };
    if (options && typeof options.success === 'function') options.success(response);
    if (options && typeof options.complete === 'function') options.complete(response);
    return response;
  };
  return respond(fixtureResponse(url, fixture));
}

function roleFromAuthorization(header = '') {
  const match = String(header).match(/Bearer\s+fixture-(.+)-token/i);
  return match ? match[1] : 'guest';
}

function startFixtureServer() {
  const requestUrls = [];
  const server = http.createServer((request, response) => {
    const role = roleFromAuthorization(request.headers.authorization);
    const fixture = fixtureFor(role);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    requestUrls.push({ role, method: request.method, url: request.url });
    response.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
    });
    response.end(JSON.stringify(fixtureResponse(request.url || '/', fixture, baseUrl)));
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.unref();
      resolve({
        server,
        requestUrls,
        baseUrl: `http://127.0.0.1:${server.address().port}`,
      });
    });
  });
}

function sanitize(value) {
  let text;
  try { text = typeof value === 'string' ? value : JSON.stringify(value); }
  catch (_error) { text = String(value); }
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [REDACTED]')
    .replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[JWT_REDACTED]')
    .replace(/1\d{10}/g, '[PHONE_REDACTED]')
    .replace(/([?&](?:code|phoneCode|access_token|token)=)[^&\s]+/gi, '$1[REDACTED]')
    .slice(0, 1200);
}

function rawRpc(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = `gewu-matrix-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const socket = new WebSocket(endpoint);
    const timeout = setTimeout(() => {
      socket.terminate();
      reject(new Error(`${method}:TIMEOUT`));
    }, 15000);
    socket.on('open', () => socket.send(JSON.stringify({ id, method, params })));
    socket.on('message', (data) => {
      let message;
      try { message = JSON.parse(String(data)); } catch (_error) { return; }
      if (message.id !== id) return;
      clearTimeout(timeout);
      socket.close();
      if (message.error) reject(new Error(`${method}:${message.error.message || 'RPC_ERROR'}`));
      else resolve(message.result);
    });
    socket.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function invokeNavigation(method, url) {
  return rawRpc('App.callFunction', {
    functionDeclaration: `function (navigationMethod, targetUrl) {
      globalThis.__gewuNavigationResult = { status: 'pending', method: navigationMethod, url: targetUrl };
      var options = {
        url: targetUrl,
        success: function () { globalThis.__gewuNavigationResult.status = 'success'; },
        fail: function (error) {
          globalThis.__gewuNavigationResult = {
            status: 'failed', method: navigationMethod, url: targetUrl,
            error: String(error && error.errMsg || error || 'unknown'),
          };
        },
      };
      if (navigationMethod === 'navigateTo') wx.navigateTo(options);
      else wx.reLaunch(options);
      return true;
    }`,
    args: [method, url],
  });
}

function invokeNavigationOnConnection(miniProgram, method, url) {
  return miniProgram.evaluate(function (navigationMethod, targetUrl) {
    globalThis.__gewuNavigationResult = { status: 'pending', method: navigationMethod, url: targetUrl };
    var options = {
      url: targetUrl,
      success: function () { globalThis.__gewuNavigationResult.status = 'success'; },
      fail: function (error) {
        globalThis.__gewuNavigationResult = {
          status: 'failed', method: navigationMethod, url: targetUrl,
          error: String(error && error.errMsg || error || 'unknown'),
        };
      },
    };
    if (navigationMethod === 'navigateTo') wx.navigateTo(options);
    else wx.reLaunch(options);
    return true;
  }, method, url);
}

function evaluateRuntime(miniProgram, functionDeclaration, ...args) {
  if (miniProgram) return miniProgram.evaluate(functionDeclaration, ...args);
  return rawRpc('App.callFunction', { functionDeclaration: functionDeclaration.toString(), args })
    .then((response) => response && response.result);
}

function mockRuntimeMethod(miniProgram, method, implementation, ...args) {
  if (miniProgram) return miniProgram.mockWxMethod(method, implementation, ...args);
  return rawRpc('App.mockWxMethod', {
    method,
    functionDeclaration: implementation.toString(),
    args,
  });
}

function restoreRuntimeMethod(miniProgram, method) {
  if (miniProgram) return miniProgram.restoreWxMethod(method);
  return rawRpc('App.mockWxMethod', { method });
}

async function installMocks(miniProgram, scenario) {
  const storage = fixtureStorage(scenario.role);
  const fixture = fixtureFor(scenario.role);
  console.log(JSON.stringify({ stage: 'mock-get-storage', route: scenario.route, role: scenario.role }));
  await mockRuntimeMethod(
    miniProgram,
    'getStorageSync',
    (key, values) => Object.prototype.hasOwnProperty.call(values, key) ? values[key] : '',
    storage,
  );
  console.log(JSON.stringify({ stage: 'mock-storage-writes', route: scenario.route, role: scenario.role }));
  await mockRuntimeMethod(miniProgram, 'setStorageSync', () => undefined);
  await mockRuntimeMethod(miniProgram, 'removeStorageSync', () => undefined);
  console.log(JSON.stringify({ stage: 'mock-request', route: scenario.route, role: scenario.role }));
  await mockRuntimeMethod(miniProgram, 'request', requestFixture, fixture);
  const requestProbeResponse = miniProgram
    ? await miniProgram.callWxMethod('request', { url: 'https://fixture.invalid/scheduling/api/permissions/my' })
    : await rawRpc('App.callWxMethod', { method: 'request', args: [{ url: 'https://fixture.invalid/scheduling/api/permissions/my' }] });
  const requestProbe = miniProgram ? requestProbeResponse : requestProbeResponse.result;
  console.log(JSON.stringify({ stage: 'mocks-ready', route: scenario.route, role: scenario.role }));
  console.log(JSON.stringify({
    stage: 'request-probe',
    role: scenario.role,
    statusCode: requestProbe && requestProbe.statusCode,
    success: requestProbe && requestProbe.data && requestProbe.data.success,
    capabilityCount: requestProbe && requestProbe.data && requestProbe.data.data
      && Array.isArray(requestProbe.data.data.capabilities) ? requestProbe.data.data.capabilities.length : -1,
  }));
  await evaluateRuntime(miniProgram, () => { globalThis.__gewuFixtureRequestUrls = []; return true; });
}

async function restoreMocks(miniProgram) {
  for (const method of ['request', 'removeStorageSync', 'setStorageSync', 'getStorageSync']) {
    try { await restoreRuntimeMethod(miniProgram, method); } catch (_error) { /* best effort */ }
  }
}

async function callRuntimeWxMethod(miniProgram, method, ...args) {
  if (miniProgram) return miniProgram.callWxMethod(method, ...args);
  const response = await rawRpc('App.callWxMethod', { method, args });
  return response && response.result;
}

async function installPersistentFixtureStorage(miniProgram, scenario, apiBaseUrl) {
  const values = fixtureStorage(scenario.role, `${apiBaseUrl}/scheduling`);
  if (scenario.role === 'guest') values.scheduling_api_base_url = `${apiBaseUrl}/scheduling`;
  await evaluateRuntime(miniProgram, (fixtureValues) => {
    wx.clearStorageSync();
    Object.keys(fixtureValues).forEach((key) => wx.setStorageSync(key, fixtureValues[key]));
    return Object.keys(fixtureValues).length;
  }, values);
}

async function establishFormalCacheScope(miniProgram, scenario) {
  if (process.env.MINIAPP_SKIP_CACHE_SCOPE === '1') return;
  if (!identities[scenario.role] || scenario.role === 'unrecognized') return;
  if (scenario.route === 'pages/index/index') return;
  await invokeNavigation('reLaunch', '/pages/index/index');
  await new Promise((resolve) => setTimeout(resolve, 1400));
}

async function captureScenario(miniProgram, scenario, runtimeEvents, fixtureServer) {
  const useLocalFixtureServer = Boolean(fixtureServer);
  if (useLocalFixtureServer) {
    await installPersistentFixtureStorage(miniProgram, scenario, fixtureServer.baseUrl);
  } else {
    await installMocks(miniProgram, scenario);
    await establishFormalCacheScope(miniProgram, scenario);
  }
  const eventStart = runtimeEvents.length;
  const requestStart = fixtureServer ? fixtureServer.requestUrls.length : 0;
  const requestedUrl = `/${scenario.route}${scenario.query ? `?${scenario.query}` : ''}`;
  console.log(JSON.stringify({ stage: 'relaunch', requestedUrl, role: scenario.role }));
  const navigationMethod = process.env.MINIAPP_DIAG_FORCE_RELAUNCH === '1'
    ? 'reLaunch'
    : (scenario.navigation === 'navigateTo' ? 'navigateTo' : 'reLaunch');
  if (useLocalFixtureServer) {
    if (miniProgram) await invokeNavigationOnConnection(miniProgram, 'reLaunch', requestedUrl);
    else await invokeNavigation('reLaunch', requestedUrl);
  } else if (process.env.MINIAPP_DIAG_CALL_WX === '1') {
    await miniProgram.callWxMethod(navigationMethod, { url: requestedUrl });
  } else if (process.env.MINIAPP_DIAG_SAME_SOCKET === '1') {
    await invokeNavigationOnConnection(miniProgram, navigationMethod, requestedUrl);
  } else {
    await invokeNavigation(navigationMethod, requestedUrl);
  }
  if (process.env.MINIAPP_DIAG_ROUTE_TIMELINE === '1') {
    for (const elapsedMs of [100, 300, 600, 1000, 1800, 3000, 5000]) {
      await new Promise((resolve) => setTimeout(resolve, elapsedMs - (globalThis.__gewuDiagElapsedMs || 0)));
      globalThis.__gewuDiagElapsedMs = elapsedMs;
      const snapshot = await rawRpc('App.getCurrentPage').catch((error) => ({ error: sanitize(error) }));
      console.log(JSON.stringify({ stage: 'route-timeline', elapsedMs, snapshot }));
    }
    globalThis.__gewuDiagElapsedMs = 0;
  } else {
    await new Promise((resolve) => setTimeout(resolve, scenario.waitMs || 1400));
  }
  const current = await rawRpc('App.getCurrentPage');
  const requestUrls = fixtureServer
    ? fixtureServer.requestUrls.slice(requestStart).map((entry) => entry.url.split('?')[0])
    : await evaluateRuntime(miniProgram, () => globalThis.__gewuFixtureRequestUrls || []);
  const navigationResult = useLocalFixtureServer
    ? { status: 'success', method: 'reLaunch', url: requestedUrl }
    : await evaluateRuntime(miniProgram, () => globalThis.__gewuNavigationResult || null);
  console.log(JSON.stringify({ stage: 'page-requests', route: scenario.route, requestUrls, navigationResult }));
  const actualRoute = cleanRoute(current && current.path);
  if (actualRoute !== scenario.route) {
    throw new Error(`ROUTE_MISMATCH:${scenario.route}:${actualRoute || 'none'}`);
  }
  const screenshotPath = path.join(outputDir, screenshotName(scenario));
  const screenshot = await rawRpc('App.captureScreenshot');
  fs.writeFileSync(screenshotPath, screenshot.data, 'base64');
  const eventSlice = runtimeEvents.slice(eventStart);
  const errors = eventSlice.filter((entry) => entry.level === 'exception' || /error/i.test(entry.level));
  const stat = fs.statSync(screenshotPath);
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(screenshotPath)).digest('hex');
  const result = {
    route: scenario.route,
    query: scenario.query || '',
    role: scenario.role,
    state: scenario.state,
    realRuntime: 'WeChat DevTools',
    dataMode: useLocalFixtureServer ? 'sanitized local HTTP fixture' : 'sanitized in-memory fixture',
    screenshot: path.relative(outputDir, screenshotPath).replaceAll('\\', '/'),
    screenshotBytes: stat.size,
    screenshotSha256: sha256,
    renderedViewCount: null,
    consoleEventCount: eventSlice.length,
    consoleErrorCount: errors.length,
  };
  console.log(JSON.stringify({ captured: scenarios.indexOf(scenario) + 1, total: scenarios.length, ...result }));
  const holdMs = Number(process.env.MINIAPP_CAPTURE_HOLD_MS || 0);
  if (Number.isFinite(holdMs) && holdMs > 0) {
    console.log(JSON.stringify({ stage: 'holding-runtime', route: scenario.route, holdMs }));
    await new Promise((resolve) => setTimeout(resolve, Math.min(holdMs, 120000)));
  }
  return result;
}

async function captureWithRetry(scenario, allRuntimeEvents, fixtureServer) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const runtimeEvents = [];
    const miniProgram = process.env.MINIAPP_RAW_ONLY === '1'
      ? null
      : await automator.connect({ wsEndpoint: endpoint });
    miniProgram?.on('console', (event) => {
      const level = String(event && (event.type || event.level || event.method) || 'console');
      const captured = { level, message: sanitize(event) };
      runtimeEvents.push(captured);
      if (process.env.MINIAPP_DIAG_SAME_SOCKET === '1') console.log(JSON.stringify({ stage: 'runtime-console', ...captured }));
    });
    miniProgram?.on('exception', (event) => {
      const captured = { level: 'exception', message: sanitize(event) };
      runtimeEvents.push(captured);
      if (process.env.MINIAPP_DIAG_SAME_SOCKET === '1') console.log(JSON.stringify({ stage: 'runtime-exception', ...captured }));
    });
    try {
      if (process.env.MINIAPP_DIAG_SAME_SOCKET === '1' && miniProgram) await miniProgram.send('App.enableLog');
      const result = await captureScenario(miniProgram, scenario, runtimeEvents, fixtureServer);
      allRuntimeEvents.push(...runtimeEvents.map((entry) => ({ ...entry, route: scenario.route, role: scenario.role })));
      return result;
    } catch (error) {
      lastError = error;
      console.log(JSON.stringify({
        retry: attempt,
        route: scenario.route,
        role: scenario.role,
        error: sanitize(error && (error.message || error)),
      }));
    } finally {
      if (!fixtureServer) await restoreMocks(miniProgram);
      miniProgram?.disconnect();
    }
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  throw lastError;
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const configuredRoutes = Array.from(
    fs.readFileSync(appConfigPath, 'utf8').matchAll(/['"](pages\/[^'"]+)['"]/g),
    (match) => match[1],
  ).filter((route, index, all) => all.indexOf(route) === index);
  const scenarioRoutes = scenarios.map((scenario) => scenario.route);
  if (configuredRoutes.length !== 20) throw new Error(`EXPECTED_20_REGISTERED_PAGES:${configuredRoutes.length}`);
  if (JSON.stringify([...configuredRoutes].sort()) !== JSON.stringify([...scenarioRoutes].sort())) {
    throw new Error('SCENARIO_ROUTE_SET_MISMATCH');
  }
  const fixtureServer = await startFixtureServer();
  console.log(JSON.stringify({ stage: 'fixture-server-ready', baseUrl: fixtureServer.baseUrl }));

  const runtimeEvents = [];
  const captures = [];
  const requestedStart = Number(process.env.MINIAPP_CAPTURE_START || 1);
  const captureStart = Number.isSafeInteger(requestedStart) && requestedStart > 0
    ? Math.min(requestedStart, scenarios.length)
    : 1;
  const requestedLimit = Number(process.env.MINIAPP_CAPTURE_LIMIT || scenarios.length);
  const captureLimit = Number.isSafeInteger(requestedLimit) && requestedLimit > 0
    ? Math.min(requestedLimit, scenarios.length)
    : scenarios.length;
  for (const scenario of scenarios.slice(captureStart - 1, captureStart - 1 + captureLimit)) {
    captures.push(await captureWithRetry(scenario, runtimeEvents, fixtureServer));
  }
  const completed = captures.length === scenarios.length;

  const sanitizedEvents = runtimeEvents.filter((entry) => /warn|error|exception/i.test(entry.level));
  const matrix = {
    generatedAt: new Date().toISOString(),
    completed,
    realRuntime: { tool: 'WeChat DevTools', endpoint: 'local automation websocket', screenshotSource: 'App.captureScreenshot' },
    fixtures: { sanitized: true, localHttpOnly: true, storageScopedToDevTools: true, productionDataTouched: false },
    registeredPageCount: configuredRoutes.length,
    captureCount: captures.length,
    roles: Array.from(new Set(captures.map((capture) => capture.role))),
    routes: configuredRoutes,
    captures,
    sanitizedWarningsAndErrors: sanitizedEvents,
  };
  fs.writeFileSync(path.join(outputDir, 'matrix.json'), `${JSON.stringify(matrix, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(outputDir, 'sanitized-console.json'), `${JSON.stringify(sanitizedEvents, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(outputDir, 'README.md'), [
    '# 微信小程序真实运行时页面证据',
    '',
    '- 截图由微信开发者工具真实 WeApp 运行时生成。',
    '- 角色、业务数据和接口响应均来自仅监听 127.0.0.1 的脱敏固定数据服务。',
    '- 临时会话只写入微信开发者工具的小程序存储；未访问生产业务接口。',
    `- 注册页面：${configuredRoutes.length}；截图：${captures.length}。`,
    '',
  ].join('\n'), 'utf8');
  await new Promise((resolve) => fixtureServer.server.close(resolve));
  console.log(JSON.stringify({ complete: completed, captures: captures.length, roles: matrix.roles, outputDir }));
}

module.exports = { fixtureStorage, scenarios, startFixtureServer };

if (require.main === module) {
  main().catch((error) => {
    console.error(error && (error.stack || error.message) || String(error));
    process.exitCode = 1;
  });
}
