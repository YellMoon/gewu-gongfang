'use strict';

const assert = require('assert');

const {
  DOCX_SIGNATURE,
  PDF_SIGNATURE,
  loadSmokeConfig,
  runReviewDemoSmoke,
  sanitizeFailure,
} = require('./check_review_demo');

const EXPERIENCE_CODE = 'Gewu-Review-2026-A9x7';
const BASE_URL = 'https://review.example.test/scheduling';

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: name => name.toLowerCase() === 'content-type' ? 'application/json' : null },
    json: async () => body,
    arrayBuffer: async () => Buffer.from(JSON.stringify(body)),
  };
}

function binaryResponse(contentType, bytes) {
  const buffer = Buffer.from(bytes);
  return {
    ok: true,
    status: 200,
    headers: { get: name => name.toLowerCase() === 'content-type' ? contentType : null },
    json: async () => { throw new Error('binary response is not JSON'); },
    arrayBuffer: async () => buffer,
  };
}

function buildFakeFetch(options = {}) {
  const calls = [];
  const tasks = new Map();
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = String(init.method || 'GET').toUpperCase();
    const auth = String(init.headers?.authorization || init.headers?.Authorization || '');
    const roleFromToken = auth.match(/^Bearer token-(admin|student)-/)?.[1] || '';
    const body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method, path: url.pathname, role: roleFromToken || body?.role || null, body, hasSignal: Boolean(init.signal) });

    if (url.pathname.endsWith('/api/auth/review-demo')) {
      if (options.failLogin) {
        return jsonResponse(500, { code: 'PRIVATE_FAILURE', secret: EXPERIENCE_CODE, token: 'leaked-token', phone: '13900000000' });
      }
      const role = body.role;
      assert.strictEqual(body.code, EXPERIENCE_CODE, 'smoke must send the environment code without transforming it');
      return jsonResponse(200, {
        success: true,
        data: {
          token: `token-${role}-safe-fixture-1234567890`,
          role,
          user: {
            id: `review-demo:${role}:session-${role}`,
            user_type: role,
            is_review_demo: true,
            read_only: true,
            review_demo_session_id: `session-${role}`,
            ...(role === 'student' ? { student_id: 'review-demo-student', linked_student_ids: ['review-demo-student'] } : { linked_student_ids: [] }),
          },
        },
      });
    }

    const role = roleFromToken;
    assert.ok(['admin', 'student'].includes(role), 'authenticated smoke calls must use the role token');
    if (url.pathname.endsWith('/api/permissions/my')) {
      return jsonResponse(200, {
        capabilities: ['review-demo:read', `review-demo:${role}`, 'question-bank:view', 'review-demo:paper-export'],
        identity: {
          id: `review-demo:${role}:session-${role}`,
          role,
          tenant_id: 'default',
          student_id: role === 'student' ? 'review-demo-student' : null,
          linked_student_ids: role === 'student' ? ['review-demo-student'] : [],
          review_status: 'approved', status: 1, active: true, login_enabled: 1,
          is_review_demo: true, read_only: true, review_demo_session_id: `session-${role}`,
        },
      });
    }
    if (url.pathname.endsWith('/api/cloud/snapshots/read')) {
      const students = role === 'student'
        ? [{ id: 'review-demo-student', name: '审核示例学生' }]
        : [{ id: 'review-demo-student', name: '审核示例学生' }, { id: 'review-demo-student-2', name: '审核示例学生二' }];
      return jsonResponse(200, {
        success: true,
        snapshot: {
          id: `review-demo-${role}`, version: 'review-demo-v1',
          payload: {
            students,
            schedules: [{ id: 'review-demo-schedule', student_ids: ['review-demo-student'] }],
            payments: [], assetRecords: [],
          },
        },
      });
    }
    if (url.pathname.endsWith('/api/cloud/snapshots/questions')) {
      return jsonResponse(200, {
        success: true, sandboxAvailable: true, hostAvailable: false,
        targetHostDeviceId: null, hostBaseUrl: null, reviewDemoRole: role,
        questions: [{ id: 'review-q-1', stemPreview: '【示例】题目' }, { id: 'review-q-2', stemPreview: '【示例】题目二' }],
      });
    }
    if (url.pathname.endsWith('/api/review-demo/tasks') && method === 'POST') {
      const type = body.taskType;
      const id = `${role}-${type}`;
      const artifactId = type === 'question-paper' ? null : `${id}-artifact`;
      const task = {
        id, status: 'completed',
        result: { questionCount: 2, artifactId, downloadPath: artifactId ? `/api/review-demo/artifacts/${artifactId}` : null },
      };
      tasks.set(id, task);
      return jsonResponse(200, { success: true, task });
    }
    const resultMatch = url.pathname.match(/\/api\/review-demo\/tasks\/([^/]+)\/result$/);
    if (resultMatch) return jsonResponse(200, { success: true, task: tasks.get(resultMatch[1]) });
    const cancelMatch = url.pathname.match(/\/api\/review-demo\/tasks\/([^/]+)\/cancel$/);
    if (cancelMatch && method === 'POST') return jsonResponse(200, { success: true, task: { ...tasks.get(cancelMatch[1]), status: 'cancelled' } });
    const artifactMatch = url.pathname.match(/\/api\/review-demo\/artifacts\/([^/]+)$/);
    if (artifactMatch) {
      const pdf = artifactMatch[1].includes('paper-export-pdf');
      if (pdf) return binaryResponse('application/pdf', options.badPdf ? Buffer.from('NOTPDF') : Buffer.from('%PDF-1.7\n'));
      return binaryResponse('application/vnd.openxmlformats-officedocument.wordprocessingml.document', Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.from('docx')]));
    }
    if (url.pathname.endsWith('/api/cloud/tasks') && method === 'POST') {
      return jsonResponse(403, { success: false, code: 'REVIEW_DEMO_READ_ONLY' });
    }
    throw new Error(`unexpected fake request ${method} ${url.pathname}`);
  };
  return { calls, fetchImpl };
}

assert.deepStrictEqual(
  loadSmokeConfig({ MINIAPP_REVIEW_BASE_URL: BASE_URL, MINIAPP_REVIEW_EXPERIENCE_CODE: EXPERIENCE_CODE }),
  { baseUrl: BASE_URL, experienceCode: EXPERIENCE_CODE },
  'smoke should read base URL and code only from environment',
);
for (const env of [
  {},
  { MINIAPP_REVIEW_BASE_URL: 'http://review.example.test', MINIAPP_REVIEW_EXPERIENCE_CODE: EXPERIENCE_CODE },
  { MINIAPP_REVIEW_BASE_URL: BASE_URL, MINIAPP_REVIEW_EXPERIENCE_CODE: 'short' },
]) {
  assert.throws(() => loadSmokeConfig(env), /review smoke configuration is invalid/);
}

assert.ok(Buffer.from(DOCX_SIGNATURE).equals(Buffer.from('PK\x03\x04')), 'DOCX signature contract should be ZIP local-file header');
assert.ok(Buffer.from(PDF_SIGNATURE).equals(Buffer.from('%PDF')), 'PDF signature contract should be PDF magic bytes');

(async () => {
  const good = buildFakeFetch();
  const logLines = [];
  const result = await runReviewDemoSmoke({
    env: { MINIAPP_REVIEW_BASE_URL: BASE_URL, MINIAPP_REVIEW_EXPERIENCE_CODE: EXPERIENCE_CODE },
    fetchImpl: good.fetchImpl,
    logger: line => logLines.push(String(line)),
  });
  assert.deepStrictEqual(result, { ok: true, roles: ['admin', 'student'] });
  assert.deepStrictEqual(logLines, ['review demo smoke passed: admin', 'review demo smoke passed: student']);
  assert.ok(good.calls.every(call => call.hasSignal), 'every public smoke request should have a bounded timeout signal');

  const expectedPerRole = [
    ['POST', '/scheduling/api/auth/review-demo'],
    ['GET', '/scheduling/api/permissions/my'],
    ['GET', '/scheduling/api/cloud/snapshots/read'],
    ['GET', '/scheduling/api/cloud/snapshots/questions'],
    ['POST', '/scheduling/api/review-demo/tasks'],
    ['GET', null],
    ['POST', null],
    ['POST', '/scheduling/api/review-demo/tasks'],
    ['GET', null],
    ['GET', null],
    ['POST', '/scheduling/api/review-demo/tasks'],
    ['GET', null],
    ['GET', null],
    ['POST', '/scheduling/api/cloud/tasks'],
  ];
  for (const role of ['admin', 'student']) {
    const roleCalls = good.calls.filter(call => call.role === role);
    assert.strictEqual(roleCalls.length, expectedPerRole.length, `${role} smoke should cover the full request sequence`);
    expectedPerRole.forEach(([method, path], index) => {
      assert.strictEqual(roleCalls[index].method, method, `${role} request ${index + 1} method`);
      if (path) assert.strictEqual(roleCalls[index].path, path, `${role} request ${index + 1} path`);
    });
    assert.deepStrictEqual(
      roleCalls.filter(call => call.path.endsWith('/api/review-demo/tasks')).map(call => call.body.taskType),
      ['question-paper', 'paper-export-word', 'paper-export-pdf'],
      `${role} should smoke composition plus both export formats`,
    );
    assert.strictEqual(roleCalls.at(-1).body.taskType, 'question-paper', 'write-denial probe should target a real cloud task route');
  }

  const failed = buildFakeFetch({ failLogin: true });
  await assert.rejects(
    () => runReviewDemoSmoke({
      env: { MINIAPP_REVIEW_BASE_URL: BASE_URL, MINIAPP_REVIEW_EXPERIENCE_CODE: EXPERIENCE_CODE },
      fetchImpl: failed.fetchImpl,
      logger: () => {},
    }),
    error => {
      const safe = sanitizeFailure(error);
      assert.ok(!safe.includes(EXPERIENCE_CODE));
      assert.ok(!safe.includes('leaked-token'));
      assert.ok(!safe.includes('13900000000'));
      assert.ok(!safe.includes('PRIVATE_FAILURE'));
      return true;
    },
  );

  const badPdf = buildFakeFetch({ badPdf: true });
  await assert.rejects(
    () => runReviewDemoSmoke({
      env: { MINIAPP_REVIEW_BASE_URL: BASE_URL, MINIAPP_REVIEW_EXPERIENCE_CODE: EXPERIENCE_CODE },
      fetchImpl: badPdf.fetchImpl,
      logger: () => {},
    }),
    error => sanitizeFailure(error).includes('PDF signature'),
    'smoke should fail closed when a PDF download has the wrong signature',
  );

  console.log('review demo public smoke checks passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
