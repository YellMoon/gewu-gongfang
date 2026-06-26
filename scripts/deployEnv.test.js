const assert = require('assert');
const fs = require('fs');

const deployPy = fs.readFileSync('scripts/deploy.py', 'utf-8');
const grayDeployPy = fs.readFileSync('scripts/docker_deploy_gray.py', 'utf-8');
const packageJson = fs.readFileSync('package.json', 'utf-8');
const backendPackage = fs.readFileSync('backend/package.json', 'utf-8');

for (const name of [
  'GEWU_NODE_ROLE',
  'GEWU_DEVICE_ID',
  'GEWU_HOST_BASE_URL',
  'GEWU_CLOUD_BASE_URL',
  'QUESTION_BANK_ROOT',
  'QUESTION_BANK_UPLOAD_DIR',
  'GEWU_LOCAL_CACHE_PATH',
  'GEWU_NAS_BACKUP_PATH',
]) {
  assert.ok(deployPy.includes(name), `pm2 deploy should pass ${name}`);
  assert.ok(grayDeployPy.includes(name), `docker gray deploy should pass ${name}`);
}

assert.ok(deployPy.includes('DEPLOY_KEY_PATH'), 'pm2 deploy should support SSH key authentication');
assert.ok(deployPy.includes('key_filename'), 'pm2 deploy should pass SSH key path to paramiko');
assert.ok(deployPy.includes('BACKEND_JWT_SECRET'), 'pm2 deploy should read BACKEND_JWT_SECRET from local deploy env');
assert.ok(deployPy.includes('"JWT_SECRET": BACKEND_JWT_SECRET'), 'pm2 deploy should inject BACKEND_JWT_SECRET as remote JWT_SECRET');
assert.ok(deployPy.includes('"PORT": os.getenv("PORT", "3001")'), 'pm2 deploy should support overriding the backend port');
assert.ok(deployPy.includes('health_port = os.getenv("PORT", "3001")'), 'pm2 deploy health check should use the configured backend port');
assert.ok(deployPy.includes('redact_command'), 'pm2 deploy should redact sensitive values from printed commands');
assert.ok(deployPy.includes('safe_print'), 'pm2 deploy should print remote Unicode output safely on Windows consoles');
assert.ok(deployPy.includes('which pm2 || npm install -g pm2'), 'pm2 deploy should skip global pm2 installation when pm2 already exists');
assert.ok(backendPackage.includes('"sanitize-html"'), 'backend production dependencies should include sanitize-html used by questionBankService');
assert.ok(backendPackage.includes('"docx"'), 'backend production dependencies should include docx used by paperArtifactService');

assert.ok(packageJson.includes('scripts/deployEnv.test.js'), 'deploy env test should run in npm test');

console.log('deploy env checks passed');
