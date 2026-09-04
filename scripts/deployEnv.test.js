const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const deployPy = fs.readFileSync('scripts/deploy.py', 'utf-8');
const deployGatewayPy = fs.readFileSync('scripts/deploy_gateway.py', 'utf-8');
const packageJson = fs.readFileSync('package.json', 'utf-8');
const backendPackage = fs.readFileSync('backend/package.json', 'utf-8');
const taskDoc = fs.readFileSync('task.md', 'utf-8');
const rootPkg = JSON.parse(packageJson);
const backendPkg = JSON.parse(backendPackage);
const deployRequirementsPath = 'scripts/requirements-deploy.txt';
const STRONG_JWT_FIXTURE = 'J7@vN2#qR9!mT4$kL8&cW5*zH3^sP6?dF1';

assert.ok(fs.existsSync(deployRequirementsPath), 'deploy Python dependencies should be declared');
const deployRequirements = fs.readFileSync(deployRequirementsPath, 'utf-8');
assert.ok(deployRequirements.includes('paramiko'), 'deploy requirements should include paramiko');
assert.ok(deployRequirements.includes('python-dotenv'), 'deploy requirements should include python-dotenv');
assert.ok(!deployPy.includes('load_dotenv = None'), 'deploy should not silently skip .env.local when python-dotenv is missing');
assert.ok(deployPy.includes('def upload_shared(ssh):'), 'backend deployment must upload its sibling shared runtime modules');
assert.ok(deployPy.includes('upload_shared(ssh)'), 'backend deployment must invoke shared runtime upload before restart');
assert.ok(deployPy.includes('posixpath.join(posixpath.dirname(REMOTE_DIR), "shared")'), 'remote shared paths must stay POSIX when deploying from Windows');
assert.ok(deployPy.includes('pm2 restart {service_name} --update-env'), 'existing backend processes must reload the generated environment instead of failing pm2 start');
assert.ok(!deployGatewayPy.includes('backup_gateway_release(')
  && !deployGatewayPy.includes('gateway.db')
  && deployGatewayPy.includes('gateway-code.tar.gz')
  && deployGatewayPy.indexOf('gateway-code.tar.gz') < deployGatewayPy.indexOf('upload_dir(sftp, ssh, LOCAL_GATEWAY, REMOTE_GATEWAY)'),
  'the retired gateway must preserve its prior code without treating the obsolete SQLite database as authority');
assert.ok(deployGatewayPy.includes('LEGACY_SERVICE_NAMES = ("gateway",)')
  && deployGatewayPy.includes('def stop_legacy_gateway_services(')
  && deployGatewayPy.includes('pm2 delete {service_name}')
  && deployGatewayPy.indexOf('stop_legacy_gateway_services(ssh)') < deployGatewayPy.indexOf('restart_gateway(ssh)'),
  'gateway deployment must retire the legacy PM2 name before starting edu-gateway on the same port');
assert.ok(!deployGatewayPy.includes('upload_backend_support')
  && !deployGatewayPy.includes('LOCAL_BACKEND')
  && deployGatewayPy.includes('require_release_manifest("cloud_business")')
  && deployGatewayPy.includes('verify_retired_gateway'),
  'the retirement gateway must not upload legacy authority support and must be verified as a cloud-business subcomponent');

const envFixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-deploy-env-'));
const envFixturePath = path.join(envFixtureDir, '.env.local');
fs.writeFileSync(envFixturePath, [
  'APP_ENV=prod',
  'DEPLOY_HOST=deploy-env-test-host',
  'DEPLOY_PASSWORD=deploy-env-test-password',
  `BACKEND_JWT_SECRET="${STRONG_JWT_FIXTURE}"`,
  'WECHAT_APPID="wx-review-env-test"',
  'WECHAT_APPSECRET="wechat-review-env-secret"',
  'WECHAT_MINIAPP_ENV_VERSION=develop',
].join('\n'), 'utf-8');
const cleanEnv = { ...process.env, DOTENV_CONFIG_PATH: envFixturePath };
for (const name of ['APP_ENV', 'SCHEDULE_ENV', 'PORT', 'DEPLOY_HOST', 'DEPLOY_PASSWORD', 'DEPLOY_KEY_PATH', 'BACKEND_JWT_SECRET', 'WECHAT_APPID', 'WECHAT_APPSECRET']) {
  delete cleanEnv[name];
}
cleanEnv.DOTENV_CONFIG_PATH = envFixturePath;
const deployProbe = spawnSync('python', [
  '-c',
  'import scripts.deploy as d; values=d.remote_env_values(); print(d.APP_ENV); print(d.HOST); print(d.APP_PORT); print(values["GEWU_NODE_ROLE"]); print(values["GEWU_HOST_BASE_URL"] == "http://127.0.0.1:3002"); print(values["WECHAT_MINIAPP_ENV_VERSION"]); print("MINIAPP_REVIEW_EXPERIENCE_CODE" not in values); d.require_remote_env(); print("account-config-ok")',
], { cwd: process.cwd(), env: cleanEnv, encoding: 'utf-8' });
fs.rmSync(envFixtureDir, { recursive: true, force: true });
assert.strictEqual(deployProbe.status, 0, deployProbe.stderr || 'deploy env probe should succeed');
assert.deepStrictEqual(
  deployProbe.stdout.trim().split(/\r?\n/),
  ['prod', 'deploy-env-test-host', '3002', 'cloud-relay', 'True', 'develop', 'True', 'account-config-ok'],
  'deploy.py should load APP_ENV and host from DOTENV_CONFIG_PATH, resolve the prod port, and never default the cloud backend to primary-host authority'
);

const staleUnifiedVersionProbe = spawnSync('python', [
  '-c',
  'import scripts.deploy as d; print(d.remote_env_values()["GEWU_APP_VERSION"]); print(d.read_root_version())',
], {
  cwd: process.cwd(),
  env: { ...cleanEnv, GEWU_APP_VERSION: '4.0.0' },
  encoding: 'utf-8',
});
assert.strictEqual(staleUnifiedVersionProbe.status, 0, staleUnifiedVersionProbe.stderr || 'stale unified-version probe should run');
assert.deepStrictEqual(
  staleUnifiedVersionProbe.stdout.trim().split(/\r?\n/),
  [rootPkg.version, rootPkg.version],
  'release deployment must always inject the checked-out unified version, never a stale environment override',
);

const missingReviewEnv = {
  ...cleanEnv,
  APP_ENV: 'prod',
  DEPLOY_HOST: 'deploy-env-test-host',
  DEPLOY_PASSWORD: 'deploy-env-test-password',
  WECHAT_APPID: 'wx-review-env-test',
  WECHAT_APPSECRET: 'wechat-review-env-secret',
  BACKEND_JWT_SECRET: '',
};
const missingReviewProbe = spawnSync('python', [
  '-c',
  'import scripts.deploy as d\ntry:\n d.require_remote_env()\nexcept SystemExit as e:\n print(str(e))\nelse:\n raise SystemExit("expected fail-closed production configuration")',
], { cwd: process.cwd(), env: missingReviewEnv, encoding: 'utf-8' });
assert.strictEqual(missingReviewProbe.status, 0, missingReviewProbe.stderr || 'missing production secret probe should run');
assert.ok(missingReviewProbe.stdout.includes('BACKEND_JWT_SECRET'), 'production deploy should fail closed when the backend JWT secret is missing');

const weakJwtValue = 'weak-backend-jwt-secret';
const weakJwtEnv = {
  ...missingReviewEnv,
  BACKEND_JWT_SECRET: weakJwtValue,
};
const weakJwtProbe = spawnSync('python', [
  '-c',
  'import scripts.deploy as d\ntry:\n d.require_remote_env()\nexcept SystemExit as e:\n print(str(e))\nelse:\n raise SystemExit("expected strong backend JWT policy")',
], { cwd: process.cwd(), env: weakJwtEnv, encoding: 'utf-8' });
assert.strictEqual(weakJwtProbe.status, 0, weakJwtProbe.stderr || 'weak JWT probe should run');
assert.ok(weakJwtProbe.stdout.includes('BACKEND_JWT_SECRET is missing or weak'), 'production deploy should enforce a strong >=32-byte backend JWT secret');
assert.ok(!weakJwtProbe.stdout.includes(weakJwtValue), 'JWT validation errors must not echo the submitted secret');

const deploySecurityEnv = {
  ...missingReviewEnv,
  BACKEND_JWT_SECRET: STRONG_JWT_FIXTURE,
  WECHAT_APPSECRET: 'unit-wechat-secret-fixture',
  GEWU_DESKTOP_SYNC_TOKEN: 'unit-desktop-sync-secret',
  GEWU_CLOUD_RELAY_HOST_TOKEN: 'unit-host-relay-secret',
};
const deploySecurityProbe = spawnSync('python', ['-c', `
import scripts.deploy as d
import scripts.deploy_gateway as g

class Stream:
    class Channel:
        def recv_exit_status(self): return 0
    def __init__(self, value): self.value, self.channel = value, self.Channel()
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
        leaks = "|".join(filter(None, [d.PASSWORD, d.BACKEND_JWT_SECRET, d.WECHAT_APPSECRET, d.os.getenv("GEWU_DESKTOP_SYNC_TOKEN"), d.os.getenv("GEWU_CLOUD_RELAY_HOST_TOKEN")]))
        return None, Stream("stdout=" + leaks), Stream("stderr=" + leaks)

ssh = FakeSsh()
paths = [
    "/tmp/gewu-pm2-env-unit-migrate",
    "/tmp/gewu-pm2-env-unit-backend",
]
d.migrate(ssh, path_factory=lambda: paths[0])
d.start_backend_service(ssh, "scheduling-backend-prod", path_factory=lambda: paths[1])
g.restart_gateway(ssh)
runtime_secrets = [d.BACKEND_JWT_SECRET, d.WECHAT_APPSECRET]
all_secrets = [d.PASSWORD] + runtime_secrets
secure_commands = ssh.commands[1:]
print(all(secret not in command for command in ssh.commands for secret in all_secrets if secret))
print(ssh.sftp.modes == [(path, 0o600) for path in paths] and all(ssh.sftp.events.index("chmod:" + path) < ssh.sftp.events.index("write:" + path) for path in paths))
print(ssh.sftp.removed == paths)
print(len(ssh.commands) == 4 and "mkdir -p" in ssh.commands[0] and all("trap" in command and path in command for command, path in zip(secure_commands[:2], paths)) and "trap" not in secure_commands[2])
print("node -e" in secure_commands[0] and "pm2 start" in secure_commands[1] and "--update-env" in secure_commands[1] and "pm2 delete edu-gateway" in secure_commands[2] and "GEWU_APP_VERSION=8.9.1" in secure_commands[2] and "--update-env" in secure_commands[2])
print(all(all(secret in ssh.sftp.contents[path] for secret in runtime_secrets if secret) for path in paths))
`], { cwd: process.cwd(), env: deploySecurityEnv, encoding: 'utf-8' });
assert.strictEqual(deploySecurityProbe.status, 0, deploySecurityProbe.stderr || 'secret-safe gateway deploy probe should run');
assert.ok(deploySecurityProbe.stdout.includes('<redacted>'), 'unexpected remote stdout/stderr secrets should be redacted');
const deploySecurityOutput = `${deploySecurityProbe.stdout}\n${deploySecurityProbe.stderr}`;
for (const secret of [
  deploySecurityEnv.DEPLOY_PASSWORD,
  deploySecurityEnv.BACKEND_JWT_SECRET,
  deploySecurityEnv.WECHAT_APPSECRET,
]) {
  assert.ok(!deploySecurityOutput.includes(secret), 'deploy stdout/stderr must not expose fixture secrets');
}
assert.deepStrictEqual(
  deploySecurityProbe.stdout.trim().split(/\r?\n/).slice(-6),
  ['True', 'True', 'True', 'True', 'True', 'True'],
  'migration, backend PM2 and gateway should keep secrets out of exec input, chmod 600 before writing, trap/finally cleanup, update PM2 env, and transfer every runtime secret',
);

const commandFailureProbe = spawnSync('python', ['-c', `
import scripts.deploy as d

class Channel:
    def __init__(self, status): self.status = status
    def recv_exit_status(self): return self.status

class Stream:
    def __init__(self, value, status): self.value, self.channel = value, Channel(status)
    def read(self): return self.value.encode("utf-8")

class RemoteFile:
    def write(self, value): pass
    def flush(self): pass
    def close(self): pass

class Sftp:
    def file(self, path, mode): return RemoteFile()
    def chmod(self, path, mode): pass
    def remove(self, path): pass
    def close(self): pass

class Ssh:
    def __init__(self, statuses): self.statuses = list(statuses)
    def open_sftp(self): return Sftp()
    def exec_command(self, command, timeout=30):
        status = self.statuses.pop(0)
        return None, Stream("private-output", status), Stream("private-error", status)

def must_abort(label, callback):
    try:
        callback()
    except d.RemoteCommandError as error:
        message = str(error)
        print(label, error.exit_status, "private-output" not in message, "private-error" not in message)
    else:
        raise SystemExit(label + " did not abort")

must_abort("run", lambda: d.run(Ssh([9]), "false"))
must_abort("migrate", lambda: d.migrate(Ssh([0, 17]), path_factory=lambda: "/tmp/gewu-pm2-env-migrate-fail"))
must_abort("start", lambda: d.start_backend_service(Ssh([23]), "service", path_factory=lambda: "/tmp/gewu-pm2-env-start-fail"))
must_abort("health-status", lambda: d.check_remote_health(Ssh([28]), 3002, "backend", "5.14.3"))

class JsonSsh(Ssh):
    def __init__(self, body): self.body = body
    def exec_command(self, command, timeout=30):
        return None, Stream(self.body, 0), Stream('', 0)

try:
    d.check_remote_health(JsonSsh('{"ok":true,"time":"2026-07-15T00:00:00.000Z","version":"5.14.2"}'), 3002, "backend", "5.14.3")
except d.RemoteHealthError as error:
    print("health-version", "private" not in str(error))
else:
    raise SystemExit("old health version did not abort")

exact = d.check_remote_health(JsonSsh('{"ok":true,"time":"2026-07-15T00:00:00.000Z","version":"5.14.3"}'), 3002, "backend", "5.14.3")
print("health-exact", exact["version"] == "5.14.3")

class SequenceHealthSsh:
    def __init__(self, responses): self.responses, self.calls = list(responses), 0
    def exec_command(self, command, timeout=30):
        self.calls += 1
        status, body = self.responses.pop(0)
        return None, Stream(body, status), Stream('', status)

delayed = SequenceHealthSsh([
    (7, ''),
    (0, '{"ok":true,"time":"2026-07-15T00:00:01.000Z","version":"5.14.3"}'),
])
ready = d.wait_for_remote_health(delayed, 3001, "gateway", "5.14.3", attempts=3, delay_seconds=0)
print("health-retry", ready["version"] == "5.14.3", delayed.calls == 2)

contract_delay = SequenceHealthSsh([
    (0, '{"ok":true,"time":"2026-07-15T00:00:01.000Z","version":"5.14.2"}'),
    (0, '{"ok":true,"time":"2026-07-15T00:00:02.000Z","version":"5.14.3"}'),
])
contract_ready = d.wait_for_remote_health(contract_delay, 3001, "gateway", "5.14.3", attempts=3, delay_seconds=0)
print("health-contract-retry", contract_ready["version"] == "5.14.3", contract_delay.calls == 2)

never_ready = SequenceHealthSsh([(7, ''), (7, '')])
try:
    d.wait_for_remote_health(never_ready, 3001, "gateway", "5.14.3", attempts=2, delay_seconds=0)
except d.RemoteHealthError as error:
    print("health-retry-exhausted", never_ready.calls == 2, "private" not in str(error))
else:
    raise SystemExit("bounded health retries did not abort")

try:
    d.wait_for_remote_health(never_ready, 3001, "gateway", "5.14.3", attempts=0, delay_seconds=0)
except ValueError:
    print("health-zero-attempts", True)
else:
    raise SystemExit("zero health attempts were accepted")

cleanup_secret = "cleanup-secret-value"
d.upload_remote_env_file = lambda ssh, path_factory=None: "/tmp/gewu-pm2-env-dual-failure"
d.remove_remote_env_file = lambda ssh, path: (_ for _ in ()).throw(RuntimeError(cleanup_secret))
try:
    d.run_with_remote_env(Ssh([41]), "false")
except d.RemoteCommandError as error:
    combined = str(error) + " " + " ".join(getattr(error, "__notes__", []))
    print("dual-failure", error.exit_status, cleanup_secret not in combined)
else:
    raise SystemExit("dual failure lost the command error")
try:
    d.run_with_remote_env(Ssh([0]), "true")
except d.RemoteEnvironmentCleanupError as error:
    print("cleanup-only", cleanup_secret not in str(error))
else:
    raise SystemExit("cleanup-only failure was ignored")
`], { cwd: process.cwd(), env: deploySecurityEnv, encoding: 'utf-8' });
assert.strictEqual(commandFailureProbe.status, 0, commandFailureProbe.stderr || 'remote command failure probe should run');
assert.ok(commandFailureProbe.stdout.includes('run 9 True True'), 'run should raise a sanitized error with the remote exit status');
assert.ok(commandFailureProbe.stdout.includes('migrate 17 True True'), 'migration should abort on a nonzero remote command');
assert.ok(commandFailureProbe.stdout.includes('start 23 True True'), 'PM2 start should abort on a nonzero remote command');
assert.ok(commandFailureProbe.stdout.includes('health-status 28 True True'), 'health checks should abort on a nonzero HTTP command');
assert.ok(commandFailureProbe.stdout.includes('health-version True'), 'health checks should reject a structurally valid response with an old unified version');
assert.ok(commandFailureProbe.stdout.includes('health-exact True'), 'health checks should accept the exact expected unified version');
assert.ok(commandFailureProbe.stdout.includes('health-retry True True'), 'deployment health polling should tolerate bounded startup delay');
assert.ok(commandFailureProbe.stdout.includes('health-contract-retry True True'), 'deployment health polling should tolerate a stale-version contract during startup');
assert.ok(commandFailureProbe.stdout.includes('health-retry-exhausted True True'), 'deployment health polling should fail after its bounded attempt count');
assert.ok(commandFailureProbe.stdout.includes('health-zero-attempts True'), 'deployment health polling should reject a zero attempt budget');
assert.ok(commandFailureProbe.stdout.includes('dual-failure 41 True'), 'command failure should remain primary when environment cleanup also fails');
assert.ok(commandFailureProbe.stdout.includes('cleanup-only True'), 'successful commands should still fail safely when environment cleanup fails');

const cleanupFailureProbe = spawnSync('python', ['-c', `
import scripts.deploy as d

class RemoteFile:
    def __init__(self, owner): self.owner = owner
    def write(self, value): self.owner.events.append("write")
    def flush(self):
        self.owner.events.append("flush")
        if self.owner.fail_flush: raise RuntimeError("flush-primary")
    def close(self):
        self.owner.events.append("file-close")
        if self.owner.fail_file_close: raise RuntimeError("file-close-primary")

class Sftp:
    def __init__(self, owner, fail_flush=False, fail_file_close=False, fail_remove=False, fail_close=False):
        self.owner, self.fail_flush, self.fail_file_close = owner, fail_flush, fail_file_close
        self.fail_remove, self.fail_close, self.events = fail_remove, fail_close, owner.events
    def file(self, path, mode): self.events.append("file-open"); return RemoteFile(self)
    def chmod(self, path, mode): self.events.append("chmod")
    def remove(self, path):
        self.events.append("remove")
        if self.fail_remove: raise RuntimeError("remove-secondary")
    def close(self):
        self.events.append("sftp-close")
        if self.fail_close: raise RuntimeError("sftp-close-primary")

class Ssh:
    def __init__(self, configs): self.configs, self.events = list(configs), []
    def open_sftp(self): return Sftp(self, **self.configs.pop(0))

def check(label, configs, expected):
    ssh = Ssh(configs)
    try:
        d.upload_remote_env_file(ssh, path_factory=lambda: "/tmp/gewu-pm2-env-cleanup-case")
    except RuntimeError as error:
        print(label, str(error) == expected, ",".join(ssh.events))
    else:
        raise SystemExit(label + " did not fail")

check("flush", [{"fail_flush": True, "fail_file_close": True, "fail_remove": True, "fail_close": True}], "flush-primary")
check("file-close", [{"fail_file_close": True}], "file-close-primary")
check("sftp-close", [{"fail_close": True}, {}], "sftp-close-primary")
`], { cwd: process.cwd(), env: deploySecurityEnv, encoding: 'utf-8' });
assert.strictEqual(cleanupFailureProbe.status, 0, cleanupFailureProbe.stderr || 'remote env cleanup failure probe should run');
const cleanupLines = cleanupFailureProbe.stdout.trim().split(/\r?\n/).filter(line => /^(flush|file-close|sftp-close) /.test(line));
assert.ok(cleanupLines.some(line => line.startsWith('flush True ') && line.includes('file-close') && line.includes('remove') && line.includes('sftp-close')), 'flush failure should remain primary while every cleanup is attempted');
assert.ok(cleanupLines.some(line => line.startsWith('file-close True ') && line.includes('remove') && line.includes('sftp-close')), 'file close failure should trigger removal and SFTP close');
assert.ok(cleanupLines.some(line => line.startsWith('sftp-close True ') && line.includes('remove')), 'SFTP close failure should trigger best-effort removal through a fresh channel');

const knownHostsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-known-hosts-'));
const knownHostsPath = path.join(knownHostsDir, 'known_hosts');
const knownHostsProbeEnv = { ...deploySecurityEnv, GEWU_SSH_KNOWN_HOSTS: knownHostsPath };
const knownHostsProbe = spawnSync('python', ['-c', `
import pathlib
import paramiko

path = pathlib.Path(r"${knownHostsPath.replace(/\\/g, '\\\\')}")
key = paramiko.RSAKey.generate(1024)
path.write_text("deploy-env-test-host " + key.get_name() + " " + key.get_base64() + "\\n", encoding="utf-8")
import scripts.deploy as d
client = paramiko.SSHClient()
d.configure_host_key_verification(client)
print(isinstance(client._policy, paramiko.RejectPolicy))
print(client._host_keys.lookup("deploy-env-test-host") is not None)
client._log = lambda *args: None
try:
    client._policy.missing_host_key(client, "unknown.example.test", key)
except paramiko.SSHException:
    print("unknown-rejected")
else:
    raise SystemExit("unknown host was trusted")
`], { cwd: process.cwd(), env: knownHostsProbeEnv, encoding: 'utf-8' });
fs.rmSync(knownHostsDir, { recursive: true, force: true });
assert.strictEqual(knownHostsProbe.status, 0, knownHostsProbe.stderr || 'known-host verification probe should run');
assert.deepStrictEqual(knownHostsProbe.stdout.trim().split(/\r?\n/), ['True', 'True', 'unknown-rejected'], 'deployment must load the controlled pin and reject unknown hosts');

const untrustedProdEnv = { ...deploySecurityEnv };
delete untrustedProdEnv.GEWU_SSH_KNOWN_HOSTS;
const untrustedProdProbe = spawnSync('python', ['-c', `
import scripts.deploy as d
import paramiko
client = paramiko.SSHClient()
client._system_host_keys.clear()
client._host_keys.clear()
try:
    d.configure_host_key_verification(client)
except SystemExit as error:
    print(str(error))
else:
    raise SystemExit("production accepted no trusted host key")
`], { cwd: process.cwd(), env: untrustedProdEnv, encoding: 'utf-8' });
assert.strictEqual(untrustedProdProbe.status, 0, untrustedProdProbe.stderr || 'untrusted production probe should run');
assert.ok(untrustedProdProbe.stdout.includes('trusted SSH host key required'), 'production should fail before connecting when no system key or controlled pin matches');

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
}

for (const name of ['WECHAT_APPID', 'WECHAT_APPSECRET']) {
  assert.ok(deployPy.includes(name), `pm2 deploy should pass ${name}`);
}
assert.ok(!deployPy.includes('MINIAPP_REVIEW_EXPERIENCE_CODE'), 'pm2 deploy must not retain the removed review experience code');
assert.ok(!deployPy.includes('validate_review_experience_code'), 'pm2 deploy must not retain the removed review-code validator');
assert.ok(!deployPy.includes('remote_env_prefix'), 'deploy helpers must not retain a future secret command-line expansion path');
assert.ok(!deployGatewayPy.includes('remote_env_prefix'), 'formal gateway deploy must not expand secrets into commands');
assert.ok(deployPy.includes('run_with_remote_env'), 'backend migration and PM2 should share secure env staging');
assert.ok(!deployGatewayPy.includes('run_with_remote_env'), 'the retired gateway must not receive backend authority secrets');
assert.ok(deployGatewayPy.includes('GEWU_APP_VERSION=') && deployGatewayPy.includes('--update-env'), 'retirement gateway restart should refresh only its public cloud component version');
assert.ok(!taskDoc.includes('Git contains only the literal `<review experience code>` placeholder'), 'task status must not restore the removed review-code workflow');

assert.ok(deployPy.includes('DEPLOY_KEY_PATH'), 'pm2 deploy should support SSH key authentication');
assert.ok(deployPy.includes('key_filename'), 'pm2 deploy should pass SSH key path to paramiko');
assert.ok(deployPy.includes('BACKEND_JWT_SECRET'), 'pm2 deploy should read BACKEND_JWT_SECRET from local deploy env');
assert.ok(deployPy.includes('"JWT_SECRET": BACKEND_JWT_SECRET'), 'pm2 deploy should inject BACKEND_JWT_SECRET as remote JWT_SECRET');
assert.ok(deployPy.includes('"app_port": "3002"'), 'production backend should default to port 3002 behind nginx');
assert.ok(deployPy.includes('APP_PORT = os.getenv("PORT", DEFAULTS["app_port"])'), 'pm2 deploy should support overriding the environment-specific backend port');
assert.ok(deployPy.includes('"PORT": APP_PORT'), 'pm2 deploy should inject the resolved backend port');
assert.ok(deployPy.includes('health_port = APP_PORT'), 'pm2 deploy health check should use the resolved backend port');
assert.ok(deployPy.includes('check_remote_health(ssh, health_port, "backend", read_root_version())'), 'pm2 status should require the configured backend port and exact root version');
assert.ok(
  deployGatewayPy.includes('backend_deploy.wait_for_remote_health(')
    && deployGatewayPy.includes('expected_version,')
    && deployGatewayPy.includes('return verify_retired_gateway(ssh, expected_version)'),
  'Gateway deploy should poll for startup and require the exact cloud-business version plus retirement contract',
);
const restartGatewaySource = deployGatewayPy.slice(
  deployGatewayPy.indexOf('def restart_gateway('),
  deployGatewayPy.indexOf('def stop_legacy_gateway_services('),
);
assert.ok(restartGatewaySource.includes('pm2 delete {SERVICE_NAME}')
  && restartGatewaySource.includes('pm2 start src/app.js --name {SERVICE_NAME} --update-env'),
  'Gateway deploy must replace an existing same-name PM2 process so it cannot keep an obsolete script path or environment');
assert.ok(!restartGatewaySource.includes('pm2 restart {SERVICE_NAME}'),
  'Gateway deploy must not restart a same-name PM2 process in place');
assert.ok(!deployPy.includes("/api/health || echo"), 'backend deploy health must never turn a failure into success');
assert.ok(!deployGatewayPy.includes("/api/health || echo"), 'gateway deploy health must never turn a failure into success');
assert.ok(deployPy.includes('recv_exit_status'), 'remote command execution must inspect the Paramiko exit status');
assert.ok(deployPy.includes('RejectPolicy'), 'SSH deployment must use reject-on-unknown host-key policy');
assert.ok(!deployPy.includes('AutoAddPolicy'), 'SSH deployment must never auto-trust an unknown host');
assert.ok(deployPy.includes('load_dotenv'), 'pm2 deploy should load local deploy variables without a wrapper command');
assert.ok(deployPy.includes('.env.local'), 'pm2 deploy should prefer the project .env.local file');
assert.ok(deployPy.includes('read_root_version'), 'pm2 deploy should derive GEWU_APP_VERSION from the root package version');
assert.ok(deployPy.includes('redact_command'), 'pm2 deploy should redact sensitive values from printed commands');
assert.ok(deployPy.includes('GEWU_DESKTOP_SYNC_TOKEN') && deployPy.includes('GEWU_CLOUD_RELAY_HOST_TOKEN'), 'pm2 deploy should redact desktop sync secrets');
assert.ok(deployPy.includes('os.getenv("WECHAT_APPSECRET")'), 'pm2 deploy should redact the WeChat app secret');
assert.ok(deployPy.includes('safe_print'), 'pm2 deploy should print remote Unicode output safely on Windows consoles');
assert.ok(deployPy.includes('LEGACY_BACKEND_DEPLOY_RETIRED')
  && !deployPy.includes("require_release_manifest('backend'")
  && !deployPy.includes("record_release_receipt('backend'"),
  'the legacy backend deploy command must fail closed without creating a false unified-release receipt');
assert.ok(backendPackage.includes('"sanitize-html"'), 'backend production dependencies should include sanitize-html used by questionBankService');
assert.strictEqual(backendPkg.version, rootPkg.version, 'backend package version should stay aligned with root package version');

assert.ok(packageJson.includes('scripts/deployEnv.test.js'), 'deploy env test should run in npm test');

console.log('deploy env checks passed');
