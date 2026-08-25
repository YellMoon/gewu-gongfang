'use strict';

const assert = require('assert');
const fs = require('fs');
require('./miniappAuthorizationRuntime.test');
require('./miniappAuthorizationSession.test');
require('./miniappPermissionFetchRuntime.test');

const permission = fs.readFileSync('miniapp/src/utils/permission.ts', 'utf8');
const api = fs.readFileSync('miniapp/src/utils/api.ts', 'utf8');
const appConfig = fs.readFileSync('miniapp/src/app.config.ts', 'utf8');
const login = fs.readFileSync('miniapp/src/pages/login/index.tsx', 'utf8');
const application = fs.readFileSync('miniapp/src/pages/account-application/index.tsx', 'utf8');

assert.ok(permission.includes("'super_admin' | 'teacher' | 'student' | 'visitor'"));
assert.ok(!permission.includes("'super_admin' | 'admin'"));
assert.ok(!permission.includes("role: 'pending'"));
assert.ok(api.includes("'/api/miniapp/role-applications'"));
assert.ok(!api.includes("'/api/miniapp/applications'"));
assert.ok(!api.includes("'/api/miniapp/cloud-accounts'"));
assert.ok(!api.includes("'/api/miniapp/business-profiles'"));
for (const retiredPage of [
  'pages/admin/users/index',
  'pages/cloud-account-admin/index',
  'pages/unsupported-experience/index',
]) assert.ok(!appConfig.includes(retiredPage));
assert.ok(login.includes('miniappCloudAuthApi.login(loginCode, phoneCode)'));
assert.ok(application.includes('miniappCloudBusinessApi.readRoleApplication'));
assert.ok(application.includes('miniappCloudBusinessApi.submitRoleApplication'));
assert.ok(application.includes("'family_member'"));
assert.ok(application.includes("const profileMode: ProfileMode = 'existing'"));
assert.ok(!application.includes("profileMode: 'create'"));

console.log('miniapp role access policy checks passed');
