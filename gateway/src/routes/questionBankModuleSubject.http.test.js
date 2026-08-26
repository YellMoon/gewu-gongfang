'use strict';

const assert = require('assert');
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-gateway-question-module-'));
process.env.QB_DB_PATH = path.join(workspace, 'question-bank.db');

const previousCwd = process.cwd();
process.chdir(path.join(__dirname, '..', '..'));
delete require.cache[require.resolve('../config/moduleLoader')];
const { loadModules } = require('../config/moduleLoader');
const modules = loadModules();
process.chdir(previousCwd);

const questionBank = modules.find(module => module.id === 'question-bank');
assert.ok(questionBank, 'the real dynamic question-bank module must load for the HTTP permission contract');

const { requirePermission } = require('../middleware/permission');
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.authz = JSON.parse(String(req.headers['x-test-authz'] || '{}'));
  next();
});
app.use(
  questionBank.routePrefix,
  requirePermission(questionBank.permission.module, questionBank.permission.action),
  questionBank.router,
);

const active = { reviewStatus: 'approved', status: 1, loginEnabled: 1 };
async function request(base, method, route, authz, body) {
  return fetch(`${base}${route}`, {
    method,
    headers: {
      'x-test-authz': JSON.stringify(authz),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
}

(async () => {
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.strictEqual((await request(base, 'GET', '/question-bank/questions', { ...active, role: 'student' })).status, 403);
    assert.strictEqual((await request(base, 'GET', '/question-bank/questions', { ...active, role: 'student', studentId: 'student-1' })).status, 200);
    assert.strictEqual((await request(base, 'POST', '/question-bank/questions', { ...active, role: 'teacher' }, {})).status, 403);
    const boundTeacherWrite = await request(base, 'POST', '/question-bank/questions', { ...active, role: 'teacher', teacherId: 'teacher-1' }, {});
    assert.notStrictEqual(boundTeacherWrite.status, 403, 'a bound teacher must reach the real module write handler');
    assert.strictEqual((await request(base, 'GET', '/question-bank/questions', { ...active, role: 'admin' })).status, 403);
    console.log('gateway dynamic question-bank subject HTTP checks passed');
  } finally {
    await new Promise(resolve => server.close(resolve));
    require('../../../modules/question-bank/src/database').getInstance().close();
    fs.rmSync(workspace, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
