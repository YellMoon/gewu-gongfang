const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const deployPy = fs.readFileSync('scripts/deploy.py', 'utf-8');
const deployGatewayPy = fs.readFileSync('scripts/deploy_gateway.py', 'utf-8');
const grayDeployPy = fs.readFileSync('scripts/docker_deploy_gray.py', 'utf-8');
const packageJson = fs.readFileSync('package.json', 'utf-8');
const backendPackage = fs.readFileSync('backend/package.json', 'utf-8');
const rootPkg = JSON.parse(packageJson);
const backendPkg = JSON.parse(backendPackage);
const deployRequirementsPath = 'scripts/requirements-deploy.txt';

assert.ok(fs.existsSync(deployRequirementsPath), 'deploy Python dependencies should be declared');
const deployRequirements = fs.readFileSync(deployRequirementsPath, 'utf-8');
assert.ok(deployRequirements.includes('paramiko'), 'deploy requirements should include paramiko');
assert.ok(deployRequirements.includes('python-dotenv'), 'deploy requirements should include python-dotenv');
assert.ok(!deployPy.includes('load_dotenv = None'), 'deploy should not silently skip .env.local when python-dotenv is missing');

const envFixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-deploy-env-'));
const envFixturePath = path.join(envFixtureDir, '.env.local');
fs.writeFileSync(envFixturePath, [
  'APP_ENV=prod',
  'DEPLOY_HOST=deploy-env-test-host',
  'DEPLOY_PASSWORD=deploy-env-test-password',
  'BACKEND_JWT_SECRET="s3cr3t\'marker"',
  'WECHAT_APPID="wx-review-env-test"',
  'WECHAT_APPSECRET="wechat-review-env-secret"',
  'MINIAPP_REVIEW_EXPERIENCE_CODE="Gewu-Review-2026-A9x7"',
].join('\n'), 'utf-8');
const cleanEnv = { ...process.env, DOTENV_CONFIG_PATH: envFixturePath };
for (const name of ['APP_ENV', 'SCHEDULE_ENV', 'PORT', 'DEPLOY_HOST', 'DEPLOY_PASSWORD', 'DEPLOY_KEY_PATH', 'BACKEND_JWT_SECRET', 'WECHAT_APPID', 'WECHAT_APPSECRET', 'MINIAPP_REVIEW_EXPERIENCE_CODE']) {
  delete cleanEnv[name];
}
cleanEnv.DOTENV_CONFIG_PATH = envFixturePath;
const deployProbe = spawnSync('python', [
  '-c',
  'import scripts.deploy as d; print(d.APP_ENV); print(d.HOST); print(d.APP_PORT); print("GEWU_HOST_BASE_URL=http://127.0.0.1:3002" in d.remote_env_prefix()); print("MINIAPP_REVIEW_EXPERIENCE_CODE=" in d.remote_env_prefix()); print("Gewu-Review-2026-A9x7" not in d.redact_command(d.remote_env_prefix())); d.require_remote_env(); print("review-config-ok")',
], { cwd: process.cwd(), env: cleanEnv, encoding: 'utf-8' });
fs.rmSync(envFixtureDir, { recursive: true, force: true });
assert.strictEqual(deployProbe.status, 0, deployProbe.stderr || 'deploy env probe should succeed');
assert.deepStrictEqual(
  deployProbe.stdout.trim().split(/\r?\n/),
  ['prod', 'deploy-env-test-host', '3002', 'True', 'True', 'True', 'review-config-ok'],
  'deploy.py should load APP_ENV and host from DOTENV_CONFIG_PATH and resolve the prod port'
);

const missingReviewEnv = {
  ...cleanEnv,
  APP_ENV: 'prod',
  DEPLOY_HOST: 'deploy-env-test-host',
  DEPLOY_PASSWORD: 'deploy-env-test-password',
  WECHAT_APPID: 'wx-review-env-test',
  WECHAT_APPSECRET: 'wechat-review-env-secret',
  MINIAPP_REVIEW_EXPERIENCE_CODE: '',
};
const missingReviewProbe = spawnSync('python', [
  '-c',
  'import scripts.deploy as d\ntry:\n d.require_remote_env()\nexcept SystemExit as e:\n print(str(e))\nelse:\n raise SystemExit("expected fail-closed review configuration")',
], { cwd: process.cwd(), env: missingReviewEnv, encoding: 'utf-8' });
assert.strictEqual(missingReviewProbe.status, 0, missingReviewProbe.stderr || 'missing review code probe should run');
assert.ok(missingReviewProbe.stdout.includes('MINIAPP_REVIEW_EXPERIENCE_CODE'), 'production deploy should fail closed when review code is missing');
assert.ok(!missingReviewProbe.stdout.includes('Gewu-Review-2026-A9x7'), 'deployment validation must not print the configured review code');

for (const name of [
  'GEWU_NODE_ROLE',
  'GEWU_DEVICE_ID',
  'GEWU_HOST_BASE_URL',
  'GEWU_CLOUD_BASE_URL',
  'GEWU_DESKTOP_SYNC_TOKEN',
  'GEWU_CLOUD_RELAY_HOST_TOKEN',
  'QUESTION_BANK_ROOT',
  'QUESTION_BANK_UPLOAD_DIR',
  'GEWU_LOCAL_CACHE_PATH',
  'GEWU_NAS_BACKUP_PATH',
  'GEWU_APP_VERSION',
]) {
  assert.ok(deployPy.includes(name), `pm2 deploy should pass ${name}`);
  assert.ok(grayDeployPy.includes(name), `docker gray deploy should pass ${name}`);
}

for (const name of ['WECHAT_APPID', 'WECHAT_APPSECRET']) {
  assert.ok(deployPy.includes(name), `pm2 deploy should pass ${name}`);
}
assert.ok(deployPy.includes('MINIAPP_REVIEW_EXPERIENCE_CODE'), 'pm2 deploy should pass the review experience code');
assert.ok(deployPy.includes('validate_review_experience_code'), 'pm2 deploy should validate review code strength before connection');
assert.ok(deployGatewayPy.includes('remote_env_prefix()'), 'formal gateway deploy should inject the validated remote environment');
assert.ok(deployGatewayPy.includes('--update-env'), 'formal gateway restart should refresh PM2 environment variables');

assert.ok(deployPy.includes('DEPLOY_KEY_PATH'), 'pm2 deploy should support SSH key authentication');
assert.ok(deployPy.includes('key_filename'), 'pm2 deploy should pass SSH key path to paramiko');
assert.ok(deployPy.includes('BACKEND_JWT_SECRET'), 'pm2 deploy should read BACKEND_JWT_SECRET from local deploy env');
assert.ok(deployPy.includes('"JWT_SECRET": BACKEND_JWT_SECRET'), 'pm2 deploy should inject BACKEND_JWT_SECRET as remote JWT_SECRET');
assert.ok(deployPy.includes('"app_port": "3002"'), 'production backend should default to port 3002 behind nginx');
assert.ok(deployPy.includes('APP_PORT = os.getenv("PORT", DEFAULTS["app_port"])'), 'pm2 deploy should support overriding the environment-specific backend port');
assert.ok(deployPy.includes('"PORT": APP_PORT'), 'pm2 deploy should inject the resolved backend port');
assert.ok(deployPy.includes('health_port = APP_PORT'), 'pm2 deploy health check should use the resolved backend port');
assert.ok(deployPy.includes("curl -s http://localhost:{health_port}/api/health"), 'pm2 status should use the configured backend port');
assert.ok(deployPy.includes('load_dotenv'), 'pm2 deploy should load local deploy variables without a wrapper command');
assert.ok(deployPy.includes('.env.local'), 'pm2 deploy should prefer the project .env.local file');
assert.ok(deployPy.includes('read_root_version'), 'pm2 deploy should derive GEWU_APP_VERSION from the root package version');
assert.ok(deployPy.includes('redact_command'), 'pm2 deploy should redact sensitive values from printed commands');
assert.ok(deployPy.includes('GEWU_DESKTOP_SYNC_TOKEN') && deployPy.includes('GEWU_CLOUD_RELAY_HOST_TOKEN'), 'pm2 deploy should redact desktop sync secrets');
assert.ok(deployPy.includes('os.getenv("WECHAT_APPSECRET")'), 'pm2 deploy should redact the WeChat app secret');
assert.ok(deployPy.includes('safe_print'), 'pm2 deploy should print remote Unicode output safely on Windows consoles');
assert.ok(deployPy.includes('which pm2 || npm install -g pm2'), 'pm2 deploy should skip global pm2 installation when pm2 already exists');
assert.ok(backendPackage.includes('"sanitize-html"'), 'backend production dependencies should include sanitize-html used by questionBankService');
assert.ok(backendPackage.includes('"docx"'), 'backend production dependencies should include docx used by paperArtifactService');
for (const dependency of ['fflate', 'sharp', 'pdfkit', 'svg-to-pdfkit', 'katex', 'mathjax-full']) {
  assert.ok(backendPackage.includes(`"${dependency}"`), `backend production dependencies should include ${dependency} used by the formula artifact pipeline`);
}
assert.strictEqual(backendPkg.version, rootPkg.version, 'backend package version should stay aligned with root package version');

assert.ok(packageJson.includes('scripts/deployEnv.test.js'), 'deploy env test should run in npm test');

console.log('deploy env checks passed');
