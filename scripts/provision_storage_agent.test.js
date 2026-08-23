'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createProvision, writeProvision, writeCloudProvision } = require('./provision_storage_agent');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-storage-agent-'));
try {
  const parser = path.join(temp, 'parse_word.py');
  fs.writeFileSync(parser, '# parser\n', 'utf8');
  const provision = createProvision({
    cloudBaseUrl: 'https://physicsedu.xyz/cloud-business', agentId: 'nas-agent-ugreen-b8f3',
    nasRoot: temp, parserPath: parser, randomBytes: size => Buffer.alloc(size, 7),
  });
  assert.match(provision.privateKey, /^[A-Za-z0-9_-]+$/);
  assert.match(provision.publicKey, /^[A-Za-z0-9_-]+$/);
  assert.match(provision.token, /^[A-Za-z0-9_-]{48}$/);
  const configPath = path.join(temp, 'agent.env');
  writeProvision({ configPath, provision });
  const text = fs.readFileSync(configPath, 'utf8');
  assert.match(text, /^CLOUD_BUSINESS_BASE_URL=https:\/\/physicsedu\.xyz\/cloud-business$/m);
  assert.match(text, /^STORAGE_AGENT_PRIVATE_KEY=/m);
  assert.ok(!text.includes('undefined'));
  const cloudPath = path.join(temp, 'cloud-agent.env');
  writeCloudProvision({ configPath: cloudPath, provision });
  const cloud = fs.readFileSync(cloudPath, 'utf8');
  assert.match(cloud, /^CLOUD_STORAGE_AGENT_PUBLIC_KEY=/m);
  assert.ok(!cloud.includes('STORAGE_AGENT_PRIVATE_KEY'));
  console.log('storage agent provisioning checks passed');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
