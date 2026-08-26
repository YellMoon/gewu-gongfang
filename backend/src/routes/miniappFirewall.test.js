const assert = require('assert');
const fs = require('fs');

require('./legacyUnrecognizedRetirement.test');

const app = fs.readFileSync('backend/src/app.js', 'utf-8');
const authRoute = fs.readFileSync('backend/src/routes/auth.js', 'utf-8');
const cloudRoute = fs.readFileSync('backend/src/routes/cloudRelay.js', 'utf-8');
const middleware = fs.readFileSync('backend/src/middleware/auth.js', 'utf-8');
const database = fs.readFileSync('backend/src/database.js', 'utf-8');
const gatewayAuth = fs.readFileSync('gateway/src/routes/auth.js', 'utf-8');
const gatewaySchema = fs.readFileSync('gateway/src/db/schema.sql', 'utf-8');
const packageJson = fs.readFileSync('package.json', 'utf-8');

assert.ok(authRoute.includes('createMiniappIdentityService'), 'backend WeChat login should use the authoritative identity service');
assert.ok(authRoute.includes('loginWithClaimedWechat'), 'backend WeChat login should create a conflict-aware manual-phone visitor or formal session');
assert.ok(authRoute.includes('loginWithClaimedWechat'), 'manual-phone login must use the conflict-aware identity claim path');
assert.ok(authRoute.includes('if (!normalizePhone(phone))'),
  'every backend miniapp login must require a manual phone claim');
assert.ok(authRoute.includes('resolveWechatIdentity(code)'),
  'both phone paths must still require a fresh WeChat login code');
assert.ok(authRoute.includes("MINIAPP_AUTOMATIC_PHONE_RETRIEVAL_RETIRED"),
  'the retired automatic phone path must be rejected explicitly');
assert.ok(!authRoute.includes('resolveWechatPhoneNumber(phoneCode)'),
  'manual-phone release flow must not exchange a WeChat phone code');
assert.ok(!authRoute.includes('WECHAT_BINDING_REVIEW_REQUIRED'),
  'backend manual-phone login must not retain an unreachable binding-review response');
assert.ok(!authRoute.includes("res.status(202)"),
  'backend manual-phone login must not return a pending-review response');
assert.ok(!authRoute.includes('getMiniappUserByWechat(openid)'), 'an existing openid must not bypass verified-phone login');
assert.ok(database.includes('_ensureMiniappUserColumns'), 'backend database should migrate miniapp login guard columns');
assert.ok(database.includes('_migrateMiniappMemberships'), 'backend database should migrate formal identities and memberships safely');
assert.ok(!app.includes("app.use('/api/students'"), 'local students CRUD must not remain mounted');
assert.ok(!app.includes("app.use('/api/payments'"), 'local payments CRUD must not remain mounted');
assert.ok(app.includes("app.use('/api/cloud', optionalAuth, cloudRelayRouter)"), 'cloud relay should enforce miniapp task permissions inside the route');
assert.ok(cloudRoute.includes('filterSnapshotForUser'), 'backend cloud relay should filter snapshots by user role');
assert.ok(cloudRoute.includes('requireMiniappTaskAccess'), 'backend cloud relay should enforce task permissions per route');
assert.ok(cloudRoute.includes("allowDraft: actorRole === 'super_admin'"),
  'only super admin may create a draft task');
assert.ok(!cloudRoute.includes("['super_admin', 'admin'].includes(actorRole)"),
  'retired admin must not retain draft task privileges');
assert.ok(gatewayAuth.includes('MINIAPP_AUTH_MOVED_TO_BACKEND'), 'legacy Gateway login must be a tombstone owned by the backend');
assert.ok(middleware.includes('LEGACY_MINIAPP_TOKEN_RELOGIN_REQUIRED'),
  'retired unrecognized tokens must be rejected before they reach any business route');
assert.ok(!gatewayAuth.includes('自动注册'), 'gateway login must not auto-register miniapp users');
assert.ok(gatewaySchema.includes('login_enabled INTEGER DEFAULT 0'), 'gateway user schema should keep login disabled until explicitly enabled');
assert.ok(packageJson.includes('backend/src/services/miniappAccessPolicy.test.js'), 'miniapp access policy test should run in npm test');
assert.ok(packageJson.includes('backend/src/services/miniappAuthPolicy.test.js'), 'miniapp auth policy test should run in npm test');
assert.ok(packageJson.includes('backend/src/services/miniappIdentityService.test.js'), 'verified-phone identity transactions should run in npm test');
assert.ok(packageJson.includes('backend/src/services/authRateLimiter.test.js'), 'auth rate limiting should run in npm test');
assert.ok(packageJson.includes('backend/src/routes/miniappFirewall.test.js'), 'miniapp firewall test should run in npm test');

console.log('miniapp firewall checks passed');
