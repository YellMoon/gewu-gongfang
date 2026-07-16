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

assert.ok(authRoute.includes('createMiniappIdentityService'), 'backend WeChat login should use the authoritative identity service');
assert.ok(authRoute.includes('loginWithVerifiedWechat'), 'backend WeChat login should create formal or isolated unrecognized sessions');
assert.ok(authRoute.includes('if (!phoneCode)'), 'every backend miniapp login must require a fresh verified-phone code');
assert.ok(!authRoute.includes('getMiniappUserByWechat(openid)'), 'an existing openid must not bypass verified-phone login');
assert.ok(database.includes('_ensureMiniappUserColumns'), 'backend database should migrate miniapp login guard columns');
assert.ok(database.includes('_migrateMiniappMemberships'), 'backend database should migrate formal identities and memberships safely');
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
assert.ok(packageJson.includes('backend/src/services/miniappIdentityService.test.js'), 'verified-phone identity transactions should run in npm test');
assert.ok(packageJson.includes('backend/src/services/authRateLimiter.test.js'), 'auth rate limiting should run in npm test');
assert.ok(packageJson.includes('backend/src/routes/miniappFirewall.test.js'), 'miniapp firewall test should run in npm test');

console.log('miniapp firewall checks passed');
