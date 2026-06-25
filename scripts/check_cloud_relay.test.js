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

assert.ok(script.includes('/api/cloud/host/heartbeat'), 'smoke should check host heartbeat');
assert.ok(script.includes('/api/cloud/snapshots/publish'), 'smoke should publish a snapshot');
assert.ok(script.includes('/api/cloud/snapshots/read?snapshotType=smoke'), 'smoke should read the snapshot back');
assert.ok(script.includes('/api/cloud/tasks'), 'smoke should create and list miniapp tasks');
assert.ok(script.includes('/api/cloud/tasks/${taskId}/complete'), 'smoke should complete a miniapp task');
assert.ok(script.includes('/api/cloud/tasks/${taskId}/result'), 'smoke should read a miniapp task result');
assert.ok(script.includes('GEWU_CLOUD_BASE_URL'), 'smoke should read cloud base url from env');
assert.ok(packageJson.includes('scripts/check_cloud_relay.test.js'), 'cloud relay smoke test should run in npm test');

console.log('cloud relay deployment checks passed');
