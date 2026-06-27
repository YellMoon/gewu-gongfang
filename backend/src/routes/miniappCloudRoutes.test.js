const assert = require('assert');
const fs = require('fs');

const app = fs.readFileSync('backend/src/app.js', 'utf-8');
const modulesRoute = fs.readFileSync('backend/src/routes/modules.js', 'utf-8');
const cloudRoute = fs.readFileSync('backend/src/routes/cloudRelay.js', 'utf-8');
const permissionsRoute = fs.readFileSync('backend/src/routes/permissions.js', 'utf-8');
const schema = fs.readFileSync('backend/src/schema.sql', 'utf-8');
const packageJson = fs.readFileSync('package.json', 'utf-8');

assert.ok(app.includes("app.use('/api/modules', optionalAuth, modulesRouter)"), 'backend should expose miniapp modules route');
assert.ok(app.includes("app.use('/api/cloud', optionalAuth, requireWriteAccess, cloudRelayRouter)"), 'backend should expose miniapp cloud route');
assert.ok(app.includes("app.use('/api/permissions', optionalAuth, permissionsRouter)"), 'backend should expose miniapp permissions route');
assert.ok(modulesRoute.includes("id: 'scheduling'"), 'modules route should include scheduling module');
assert.ok(modulesRoute.includes("id: 'question-bank'"), 'modules route should include question bank module');
assert.ok(modulesRoute.includes("id: 'assets'"), 'modules route should include assets module');
assert.ok(cloudRoute.includes("router.get('/snapshots/read'"), 'cloud route should expose snapshot read');
assert.ok(cloudRoute.includes("router.post('/tasks'"), 'cloud route should expose miniapp task creation');
assert.ok(cloudRoute.includes("router.get('/tasks'"), 'cloud route should expose pending task listing');
assert.ok(cloudRoute.includes("router.post('/tasks/:id/complete'"), 'cloud route should expose task completion');
assert.ok(cloudRoute.includes("router.get('/tasks/:id/result'"), 'cloud route should expose miniapp task result');
assert.ok(permissionsRoute.includes("router.get('/my'"), 'permissions route should expose current user permissions');
assert.ok(permissionsRoute.includes('studentModuleIds'), 'permissions route should return a student-specific module set');
assert.ok(schema.includes('CREATE TABLE IF NOT EXISTS readonly_snapshots'), 'backend schema should include readonly snapshots');
assert.ok(schema.includes('CREATE TABLE IF NOT EXISTS miniapp_tasks'), 'backend schema should include miniapp tasks');
assert.ok(packageJson.includes('backend/src/routes/miniappCloudRoutes.test.js'), 'miniapp cloud route test should run in npm test');

console.log('miniapp cloud route checks passed');
