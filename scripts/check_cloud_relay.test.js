const assert = require('assert');
const fs = require('fs');

const script = fs.readFileSync('scripts/check_cloud_relay.js', 'utf-8');
const stagingEnv = fs.readFileSync('.env.staging.example', 'utf-8');
const backendEnv = fs.readFileSync('backend/.env.example', 'utf-8');
const packageJson = fs.readFileSync('package.json', 'utf-8');

for (const env of [stagingEnv, backendEnv]) {
  assert.ok(env.includes('GEWU_NODE_ROLE=primary-host'), 'env should document primary host role');
  assert.ok(env.includes('GEWU_DEVICE_ID=desktop_host_001'), 'env should document host device id');
  assert.ok(env.includes('GEWU_HOST_BASE_URL=http://127.0.0.1:3001'), 'env should document host base url');
  assert.ok(env.includes('GEWU_CLOUD_BASE_URL=https://your-domain.example.com'), 'env should document cloud relay base url');
  assert.ok(env.includes('QUESTION_BANK_ROOT=E:/GewuQuestionBank'), 'env should document removable question bank root');
  assert.ok(env.includes('QUESTION_BANK_UPLOAD_DIR=E:/GewuQuestionBank/assets'), 'env should document removable question bank upload dir');
}

assert.ok(script.includes('backend/src/services/cloudRelayClient.js'), 'check should inspect the formal managed relay client');
assert.ok(script.includes('backend/src/routes/cloudRelay.js'), 'check should inspect the formal authority relay router');
assert.ok(script.includes('x-gewu-host-credential'), 'managed relay client must send its scoped host credential');
assert.ok(script.includes('x-gewu-host-generation'), 'managed relay client must bind requests to the active host generation');
assert.ok(script.includes("router.post('/tasks/claim', requireHostWrite"), 'relay router must expose V2 task claiming');
assert.ok(script.includes("!router.includes(\"router.get('/tasks'\")"), 'check must reject the retired V1 task poll');
assert.ok(!script.includes('GEWU_DESKTOP_SYNC_TOKEN'), 'check must not restore the retired shared desktop sync secret');
assert.ok(script.includes("!client.includes('x-gewu-host-token')"), 'check must reject the retired shared host-token header');
assert.ok(packageJson.includes('scripts/check_cloud_relay.test.js'), 'cloud relay smoke test should run in npm test');

console.log('cloud relay deployment checks passed');
