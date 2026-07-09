const assert = require('assert');
const fs = require('fs');

const app = fs.readFileSync('backend/src/app.js', 'utf-8');
const authRoute = fs.readFileSync('backend/src/routes/auth.js', 'utf-8');
const cloudRoute = fs.readFileSync('backend/src/routes/cloudRelay.js', 'utf-8');
const middleware = fs.readFileSync('backend/src/middleware/auth.js', 'utf-8');
const database = fs.readFileSync('backend/src/database.js', 'utf-8');
const gatewayAuth = fs.readFileSync('gateway/src/routes/auth.js', 'utf-8');
const gatewaySchema = fs.readFileSync('gateway/src/db/schema.sql', 'utf-8');
const packageJson = fs.readFileSync('package.json', 'utf-8');

assert.ok(authRoute.includes('findAuthorizedMiniappUserByWechat'), 'backend WeChat login should use preauthorized miniapp users');
assert.ok(!authRoute.includes('findOrCreateUserByWechat'), 'backend WeChat login must not auto-create users');
assert.ok(database.includes('_ensureMiniappUserColumns'), 'backend database should migrate miniapp login guard columns');
assert.ok(database.includes('findAuthorizedMiniappUserByWechat'), 'backend database should expose an authorized-user lookup');
assert.ok(middleware.includes('requireCoreReadAccess'), 'backend auth middleware should include core read firewall');
assert.ok(app.includes("app.use('/api/students', optionalAuth, requireCoreReadAccess, requireWriteAccess, studentsRouter)"), 'students API should require authenticated core read access');
assert.ok(app.includes("app.use('/api/payments', optionalAuth, requireCoreReadAccess, requireWriteAccess, paymentsRouter)"), 'payments API should require authenticated core read access');
assert.ok(app.includes("app.use('/api/cloud', optionalAuth, cloudRelayRouter)"), 'cloud relay should enforce miniapp task permissions inside the route');
assert.ok(cloudRoute.includes('filterSnapshotForUser'), 'backend cloud relay should filter snapshots by user role');
assert.ok(cloudRoute.includes('requireMiniappTaskAccess'), 'backend cloud relay should enforce task permissions per route');
assert.ok(gatewayAuth.includes('MINIAPP_USER_NOT_PREAUTHORIZED'), 'gateway login should reject unknown users');
assert.ok(!gatewayAuth.includes('自动注册'), 'gateway login must not auto-register miniapp users');
assert.ok(gatewaySchema.includes('login_enabled INTEGER DEFAULT 0'), 'gateway user schema should keep login disabled until explicitly enabled');
assert.ok(packageJson.includes('backend/src/services/miniappAccessPolicy.test.js'), 'miniapp access policy test should run in npm test');
assert.ok(packageJson.includes('backend/src/services/miniappAuthPolicy.test.js'), 'miniapp auth policy test should run in npm test');
assert.ok(packageJson.includes('backend/src/routes/miniappFirewall.test.js'), 'miniapp firewall test should run in npm test');

console.log('miniapp firewall checks passed');
