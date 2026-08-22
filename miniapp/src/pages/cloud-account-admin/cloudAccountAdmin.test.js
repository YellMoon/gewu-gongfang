'use strict';

const assert = require('assert');
const fs = require('fs');

const config = fs.readFileSync('miniapp/src/app.config.ts', 'utf8');
const api = fs.readFileSync('miniapp/src/utils/api.ts', 'utf8');
const page = fs.readFileSync('miniapp/src/pages/cloud-account-admin/index.tsx', 'utf8');
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));

assert.ok(config.includes("'pages/cloud-account-admin/index'"), 'the cloud account authorization page must be registered');
assert.ok(api.includes('listPendingAccounts'), 'the miniapp cloud API facade must read pending accounts');
assert.ok(api.includes('assignAccountRole'), 'the miniapp cloud API facade must assign an ordinary business role');
assert.ok(page.includes("identity?.token_use !== 'miniapp-cloud'"), 'the page must reject legacy miniapp identities');
assert.ok(page.includes("identity?.role !== 'super_admin'"), 'the page must reject non-super-administrators');
assert.ok(page.includes('miniappCloudBusinessApi.listPendingAccounts(token)'), 'the page must read only through the cloud account boundary');
assert.ok(api.includes('studentRelationship'), 'the cloud API facade must require an explicit student or guardian relationship');
assert.ok(page.includes('STUDENT_RELATIONSHIP_OPTIONS'), 'the administrator page must present the student versus guardian relationship choice');
assert.ok(page.includes('miniappCloudBusinessApi.assignAccountRole(token, accountId, role, profile.id, studentRelationship)'), 'the page must submit the explicit relationship through the cloud account boundary');
assert.ok(!page.includes('applicationApi') && !page.includes('approval'), 'the page must not reuse the retired host approval path');
assert.ok(packageJson.scripts['test:desktop-authorization'].includes('miniapp/src/pages/cloud-account-admin/cloudAccountAdmin.test.js'), 'the desktop and miniapp authorization test chain must include cloud account administration');

console.log('miniapp cloud account administration source checks passed');
