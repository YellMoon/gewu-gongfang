const assert = require('assert');
const fs = require('fs');

const deployPy = fs.readFileSync('scripts/deploy.py', 'utf-8');
const grayDeployPy = fs.readFileSync('scripts/docker_deploy_gray.py', 'utf-8');
const packageJson = fs.readFileSync('package.json', 'utf-8');

for (const name of [
  'GEWU_NODE_ROLE',
  'GEWU_DEVICE_ID',
  'GEWU_HOST_BASE_URL',
  'GEWU_CLOUD_BASE_URL',
  'QUESTION_BANK_ROOT',
  'QUESTION_BANK_UPLOAD_DIR',
]) {
  assert.ok(deployPy.includes(name), `pm2 deploy should pass ${name}`);
  assert.ok(grayDeployPy.includes(name), `docker gray deploy should pass ${name}`);
}

assert.ok(packageJson.includes('scripts/deployEnv.test.js'), 'deploy env test should run in npm test');

console.log('deploy env checks passed');
