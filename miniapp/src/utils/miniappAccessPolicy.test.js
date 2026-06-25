const assert = require('assert');
const fs = require('fs');

const permission = fs.readFileSync('miniapp/src/utils/permission.ts', 'utf-8');
const api = fs.readFileSync('miniapp/src/utils/api.ts', 'utf-8');
const cloudRelayRoute = fs.readFileSync('gateway/src/routes/cloudRelay.js', 'utf-8');
const gatewayApp = fs.readFileSync('gateway/src/app.js', 'utf-8');
const miniappHome = fs.readFileSync('miniapp/src/pages/index/index.tsx', 'utf-8');

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
assert.ok(miniappHome.includes('student-dashboard-scope'), 'home page should show student-scoped dashboard copy');
assert.ok(miniappHome.includes("user?.user_type !== 'student'"), 'home page should hide management shortcuts from students');

console.log('miniapp access policy checks passed');
