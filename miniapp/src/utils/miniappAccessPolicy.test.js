const assert = require('assert');
const fs = require('fs');

const permission = fs.readFileSync('miniapp/src/utils/permission.ts', 'utf-8');
const api = fs.readFileSync('miniapp/src/utils/api.ts', 'utf-8');
const cloudRelayRoute = fs.readFileSync('gateway/src/routes/cloudRelay.js', 'utf-8');
const gatewayApp = fs.readFileSync('gateway/src/app.js', 'utf-8');
const miniappHome = fs.readFileSync('miniapp/src/pages/index/index.tsx', 'utf-8');
const appConfig = fs.readFileSync('miniapp/src/app.config.ts', 'utf-8');
const questionBankPage = fs.readFileSync('miniapp/src/pages/question-bank/index.tsx', 'utf-8');

assert.ok(permission.includes('readonlyModules'), 'miniapp permission should define readonlyModules');
assert.ok(permission.includes('allowedWriteTasks'), 'miniapp permission should define allowedWriteTasks');
assert.ok(permission.includes('studentModules'), 'miniapp permission should define studentModules');
assert.ok(permission.includes('getMiniappRolePolicy'), 'miniapp permission should expose role-specific policy');
assert.ok(permission.includes('isStudentUser'), 'miniapp permission should distinguish student users');
assert.ok(permission.includes('getLinkedStudentIds'), 'miniapp permission should expose linked student ids');
assert.ok(api.includes('createMiniappTask'), 'miniapp API should create allowed cloud tasks');
assert.ok(api.includes('readCloudSnapshot'), 'miniapp API should read cloud snapshots');
assert.ok(cloudRelayRoute.includes('filterSnapshotForUser'), 'cloud relay should filter snapshots by user role');
assert.ok(cloudRelayRoute.includes('isStudentUser'), 'cloud relay should distinguish student users');
assert.ok(cloudRelayRoute.includes('student_pricings'), 'student snapshot filter should use course/schedule student links');
assert.ok(gatewayApp.includes("app.use('/api/cloud', optionalAuth, cloudRelayRouter)"), 'gateway should mount cloud relay with optional auth on its own line');
assert.ok(miniappHome.includes('getMiniappRolePolicy'), 'home page should use role-specific policy');
assert.ok(!permission.includes("'teaching-tools'"), 'miniapp permission should not expose removed teaching tools module');
assert.ok(!miniappHome.includes("'teaching-tools'"), 'home page should not expose removed teaching tools module');
assert.ok(!appConfig.includes("'pages/tools/index'"), 'app config should not register removed teaching tools page');
assert.ok(!miniappHome.includes('student-dashboard-scope'), 'home page should not show explanatory student scope copy');
assert.ok(miniappHome.includes("user?.user_type !== 'student'"), 'home page should hide management shortcuts from students');
assert.ok(appConfig.includes("'pages/question-bank/index'"), 'app config should register the question bank page');
assert.ok(questionBankPage.includes('createMiniappTask'), 'question bank page should submit question bank operations');
assert.ok(questionBankPage.includes("'question-paper'"), 'question bank page should support paper assembly');
assert.ok(questionBankPage.includes("'paper-export-word'"), 'question bank page should support Word export');
assert.ok(questionBankPage.includes("'paper-export-pdf'"), 'question bank page should support PDF export');

console.log('miniapp access policy checks passed');
