const assert = require('assert');
const fs = require('fs');

const app = fs.readFileSync('backend/src/app.js', 'utf-8');
const cloudRoute = fs.readFileSync('backend/src/routes/cloudRelay.js', 'utf-8');
const schema = fs.readFileSync('backend/src/schema.sql', 'utf-8');
const packageJson = fs.readFileSync('package.json', 'utf-8');

assert.ok(!app.includes("app.use('/api/modules', optionalAuth, modulesRouter)"), 'retired local module catalog must not remain reachable');
assert.ok(app.includes("app.use('/api/cloud', optionalAuth, cloudRelayRouter)"), 'backend should expose miniapp cloud route');
assert.ok(!app.includes("app.use('/api/permissions'"), 'the embedded cache must not expose a local permission authority');
assert.ok(!fs.existsSync('backend/src/routes/permissions.js'), 'the retired local permission projection must be deleted');
assert.ok(!app.includes("require('./routes/modules')"), 'retired local module catalog router must not remain imported');
assert.ok(cloudRoute.includes("router.get('/snapshots/read'"), 'cloud route should expose snapshot read');
assert.ok(cloudRoute.includes("router.post('/tasks'"), 'cloud route should expose miniapp task creation');
assert.ok(!cloudRoute.includes("router.get('/tasks'"), 'retired V1 pending-task polling must not remain');
assert.ok(cloudRoute.includes("router.post('/tasks/claim'"), 'cloud route should expose V2 task claiming');
assert.ok(cloudRoute.includes("router.post('/tasks/:id/complete'"), 'cloud route should expose V2 task completion');
assert.ok(cloudRoute.includes("router.get('/tasks/:id/result'"), 'cloud route should expose miniapp task result');
assert.ok(schema.includes('CREATE TABLE IF NOT EXISTS readonly_snapshots'), 'backend schema should include readonly snapshots');
assert.ok(schema.includes('CREATE TABLE IF NOT EXISTS miniapp_tasks'), 'backend schema should include miniapp tasks');
assert.ok(packageJson.includes('backend/src/routes/miniappCloudRoutes.test.js'), 'miniapp cloud route test should run in npm test');

console.log('miniapp cloud route checks passed');
