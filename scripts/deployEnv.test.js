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
const taskDoc = fs.readFileSync('task.md', 'utf-8');
const rootPkg = JSON.parse(packageJson);
const backendPkg = JSON.parse(backendPackage);
const deployRequirementsPath = 'scripts/requirements-deploy.txt';
const STRONG_TEST_FIXTURE = 'vN7$kP2@xR9!mQ4#tL8&cW5*zH3^sJ6?dF';

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
  `MINIAPP_REVIEW_EXPERIENCE_CODE="${STRONG_TEST_FIXTURE}"`,
].join('\n'), 'utf-8');
const cleanEnv = { ...process.env, DOTENV_CONFIG_PATH: envFixturePath };
for (const name of ['APP_ENV', 'SCHEDULE_ENV', 'PORT', 'DEPLOY_HOST', 'DEPLOY_PASSWORD', 'DEPLOY_KEY_PATH', 'BACKEND_JWT_SECRET', 'WECHAT_APPID', 'WECHAT_APPSECRET', 'MINIAPP_REVIEW_EXPERIENCE_CODE']) {
  delete cleanEnv[name];
}
cleanEnv.DOTENV_CONFIG_PATH = envFixturePath;
const deployProbe = spawnSync('python', [
  '-c',
  'import scripts.deploy as d; values=d.remote_env_values(); print(d.APP_ENV); print(d.HOST); print(d.APP_PORT); print(values["GEWU_HOST_BASE_URL"] == "http://127.0.0.1:3002"); print("MINIAPP_REVIEW_EXPERIENCE_CODE" in values); print(values["MINIAPP_REVIEW_EXPERIENCE_CODE"] == d.MINIAPP_REVIEW_EXPERIENCE_CODE); d.require_remote_env(); print("review-config-ok")',
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
assert.ok(!missingReviewProbe.stdout.includes(STRONG_TEST_FIXTURE), 'deployment validation must not print the configured review code');

const weakReviewEnv = { ...missingReviewEnv, MINIAPP_REVIEW_EXPERIENCE_CODE: 'GewuReview2026!demo' };
const weakReviewProbe = spawnSync('python', [
  '-c',
  'import scripts.deploy as d\ntry:\n d.require_remote_env()\nexcept SystemExit as e:\n print(str(e))\nelse:\n raise SystemExit("expected strong-format review policy")',
], { cwd: process.cwd(), env: weakReviewEnv, encoding: 'utf-8' });
assert.strictEqual(weakReviewProbe.status, 0, weakReviewProbe.stderr || 'weak review code probe should run');
assert.ok(weakReviewProbe.stdout.includes('missing or weak'), 'Python deploy should enforce the shared strong-format policy');
assert.ok(!weakReviewProbe.stdout.includes('GewuReview2026!demo'), 'weak-value errors must not echo the submitted review code');

const deploySecurityEnv = {
  ...missingReviewEnv,
  BACKEND_JWT_SECRET: 'unit-jwt-secret-with-32-characters!',
  WECHAT_APPSECRET: 'unit-wechat-secret-fixture',
  GEWU_DESKTOP_SYNC_TOKEN: 'unit-desktop-sync-secret',
  GEWU_CLOUD_RELAY_HOST_TOKEN: 'unit-host-relay-secret',
  MINIAPP_REVIEW_EXPERIENCE_CODE: STRONG_TEST_FIXTURE,
};
const deploySecurityProbe = spawnSync('python', ['-c', `
import scripts.deploy as d
import scripts.deploy_gateway as g

class Stream:
    def __init__(self, value): self.value = value
    def read(self): return self.value.encode("utf-8")

class RemoteFile:
    def __init__(self, owner, path): self.owner, self.path = owner, path
    def write(self, value): self.owner.events.append("write:" + self.path); self.owner.contents[self.path] = value
    def flush(self): pass
    def close(self): pass

class FakeSftp:
    def __init__(self): self.contents, self.modes, self.removed, self.events = {}, [], [], []
    def file(self, path, mode): return RemoteFile(self, path)
    def chmod(self, path, mode): self.events.append("chmod:" + path); self.modes.append((path, mode))
    def remove(self, path): self.removed.append(path)
    def close(self): pass

class FakeSsh:
    def __init__(self): self.sftp, self.commands = FakeSftp(), []
    def open_sftp(self): return self.sftp
    def exec_command(self, command, timeout=30):
        self.commands.append(command)
        leaks = "|".join(filter(None, [d.PASSWORD, d.BACKEND_JWT_SECRET, d.WECHAT_APPSECRET, d.MINIAPP_REVIEW_EXPERIENCE_CODE, d.os.getenv("GEWU_DESKTOP_SYNC_TOKEN"), d.os.getenv("GEWU_CLOUD_RELAY_HOST_TOKEN")]))
        return None, Stream("stdout=" + leaks), Stream("stderr=" + leaks)

ssh = FakeSsh()
paths = [
    "/tmp/gewu-pm2-env-unit-migrate",
    "/tmp/gewu-pm2-env-unit-backend",
    "/tmp/gewu-pm2-env-unit-gateway",
]
d.migrate(ssh, path_factory=lambda: paths[0])
d.start_backend_service(ssh, "scheduling-backend-prod", path_factory=lambda: paths[1])
g.restart_gateway(ssh, path_factory=lambda: paths[2])
runtime_secrets = [d.BACKEND_JWT_SECRET, d.WECHAT_APPSECRET, d.MINIAPP_REVIEW_EXPERIENCE_CODE, d.os.getenv("GEWU_DESKTOP_SYNC_TOKEN"), d.os.getenv("GEWU_CLOUD_RELAY_HOST_TOKEN")]
all_secrets = [d.PASSWORD] + runtime_secrets
secure_commands = ssh.commands[1:]
print(all(secret not in command for command in ssh.commands for secret in all_secrets if secret))
print(ssh.sftp.modes == [(path, 0o600) for path in paths] and all(ssh.sftp.events.index("chmod:" + path) < ssh.sftp.events.index("write:" + path) for path in paths))
print(ssh.sftp.removed == paths)
print(len(ssh.commands) == 4 and "mkdir -p" in ssh.commands[0] and all("trap" in command and path in command for command, path in zip(secure_commands, paths)))
print("node -e" in secure_commands[0] and "pm2 start" in secure_commands[1] and "--update-env" in secure_commands[1] and "pm2 restart" in secure_commands[2] and "--update-env" in secure_commands[2])
print(all(all(secret in ssh.sftp.contents[path] for secret in runtime_secrets if secret) for path in paths))
`], { cwd: process.cwd(), env: deploySecurityEnv, encoding: 'utf-8' });
assert.strictEqual(deploySecurityProbe.status, 0, deploySecurityProbe.stderr || 'secret-safe gateway deploy probe should run');
assert.ok(deploySecurityProbe.stdout.includes('<redacted>'), 'unexpected remote stdout/stderr secrets should be redacted');
const deploySecurityOutput = `${deploySecurityProbe.stdout}\n${deploySecurityProbe.stderr}`;
for (const secret of [
  deploySecurityEnv.DEPLOY_PASSWORD,
  deploySecurityEnv.BACKEND_JWT_SECRET,
  deploySecurityEnv.WECHAT_APPSECRET,
  deploySecurityEnv.GEWU_DESKTOP_SYNC_TOKEN,
  deploySecurityEnv.GEWU_CLOUD_RELAY_HOST_TOKEN,
  deploySecurityEnv.MINIAPP_REVIEW_EXPERIENCE_CODE,
]) {
  assert.ok(!deploySecurityOutput.includes(secret), 'deploy stdout/stderr must not expose fixture secrets');
}
assert.deepStrictEqual(
  deploySecurityProbe.stdout.trim().split(/\r?\n/).slice(-6),
  ['True', 'True', 'True', 'True', 'True', 'True'],
  'migration, backend PM2 and gateway should keep secrets out of exec input, chmod 600 before writing, trap/finally cleanup, update PM2 env, and transfer every runtime secret',
);

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
assert.ok(!deployPy.includes('remote_env_prefix'), 'deploy helpers must not retain a future secret command-line expansion path');
assert.ok(!deployGatewayPy.includes('remote_env_prefix'), 'formal gateway deploy must not expand secrets into commands');
assert.ok(deployPy.includes('run_with_remote_env'), 'backend migration and PM2 should share secure env staging');
assert.ok(deployGatewayPy.includes('run_with_remote_env'), 'formal gateway should share secure env staging');
assert.ok(deployGatewayPy.includes('--update-env'), 'formal gateway restart should refresh PM2 environment variables');
assert.ok(!taskDoc.includes('Git contains only the literal `<review experience code>` placeholder'), 'task status must not contradict explicit non-production fixtures');
assert.ok(taskDoc.includes('No actual deployment review code is committed'), 'task status should distinguish test fixtures from deployment secrets');

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
