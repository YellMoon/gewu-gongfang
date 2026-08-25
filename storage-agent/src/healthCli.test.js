'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-storage-agent-health-cli-'));
try {
  const nasRoot = path.join(root, 'nas');
  fs.mkdirSync(nasRoot);
  const parser = path.join(root, 'parse_word.py');
  fs.writeFileSync(parser, '# parser\n', 'utf8');
  const privateKey = crypto.generateKeyPairSync('x25519').privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64url');
  const envPath = path.join(root, 'agent.env');
  fs.writeFileSync(envPath, [
    'CLOUD_BUSINESS_BASE_URL=https://cloud.example.invalid/cloud-business',
    'STORAGE_AGENT_ID=nas-agent-test',
    'STORAGE_AGENT_TOKEN=storage-agent-test-token-with-sufficient-length',
    `STORAGE_AGENT_PRIVATE_KEY=${privateKey}`,
    `NAS_STORAGE_ROOT=${nasRoot}`,
    `QUESTION_IMPORT_PARSER_PATH=${parser}`,
  ].join('\n'), 'utf8');
  const output = childProcess.execFileSync(process.execPath, ['src/healthCli.js', envPath], {
    cwd: path.resolve(__dirname, '..'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  const report = JSON.parse(output);
  assert.strictEqual(report.ok, true);
  assert.strictEqual(report.writableAuthority, false);
  assert.strictEqual(report.version, require('../package.json').version);
  console.log('storage agent health CLI checks passed');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
