const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const trackedPython = execFileSync('git', ['ls-files', 'scripts/*.py'], {
  cwd: root,
  encoding: 'utf8',
}).trim().split(/\r?\n/u).filter(Boolean);

const literalParamikoRootPassword = /\bssh\.connect\([\s\S]{0,300}?["']root["']\s*,\s*["'][^"'\r\n]+["']/u;
const literalDeployPassword = /\b(?:DEPLOY_PASSWORD|SSH_PASSWORD)\s*=\s*["'][^"'\r\n]+["']/u;
const violations = trackedPython.filter(relative => fs.existsSync(path.join(root, relative))).filter(relative => {
  const source = fs.readFileSync(path.join(root, relative), 'utf8');
  return literalParamikoRootPassword.test(source) || literalDeployPassword.test(source);
});

assert.deepStrictEqual(violations, [], `tracked deployment scripts must not contain literal SSH passwords: ${violations.join(', ')}`);

for (const retired of [
  'check_docker.py',
  'check_docker_network.py',
  'check_nginx.py',
  'check_nginx_docker.py',
  'check_port.py',
  'debug_nginx.py',
  'debug_nginx2.py',
  'finish_deploy.py',
  'test_nginx.py',
  'upload_nginx.py',
  'upload_nginx2.py',
]) {
  assert.ok(!fs.existsSync(path.join(__dirname, retired)), `retired credential-bearing helper must stay deleted: ${retired}`);
}

console.log('hardcoded deployment credential retirement checks passed');
