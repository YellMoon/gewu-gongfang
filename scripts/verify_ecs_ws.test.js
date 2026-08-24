const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, 'verify_ecs_ws.py'), 'utf8');
const wordParserSource = fs.readFileSync(path.join(__dirname, 'deploy_word_parser.py'), 'utf8');

assert.ok(source.includes('GEWU_ECS_SSH_HOST'), 'SSH host must come from the environment');
assert.ok(source.includes('GEWU_ECS_SSH_USER'), 'SSH user must come from the environment');
assert.ok(source.includes('GEWU_ECS_SSH_KEY_FILE'), 'SSH key path must come from the environment');
assert.ok(source.includes('load_system_host_keys'), 'system host keys must be loaded');
assert.ok(source.includes('paramiko.RejectPolicy()'), 'unknown SSH hosts must be rejected');
assert.doesNotMatch(source, /password\s*=/i, 'tracked SSH verifier must not contain a password');
assert.doesNotMatch(source, /AutoAddPolicy/i, 'unknown SSH hosts must not be trusted automatically');
assert.doesNotMatch(source, /主机心跳:\s*OK|任务轮询:\s*OK/, 'verification must not print fabricated success');
assert.doesNotMatch(source, /\b(?:\d{1,3}\.){3}\d{1,3}\b/, 'tracked SSH verifier must not pin a production IP');

for (const [name, pythonSource] of [
  ['verify_ecs_ws.py', source],
  ['deploy_word_parser.py', wordParserSource],
]) {
  assert.doesNotMatch(pythonSource, /password\s*=\s*['"]/i, `${name} must not contain a password literal`);
  assert.doesNotMatch(pythonSource, /AutoAddPolicy/i, `${name} must not trust unknown SSH hosts`);
  assert.ok(pythonSource.includes('paramiko.RejectPolicy()'), `${name} must reject unknown SSH hosts`);
  assert.ok(pythonSource.includes('GEWU_ECS_SSH_KEY_FILE'), `${name} must use key-based SSH configuration`);
}

console.log('verify_ecs_ws security boundary tests passed');
