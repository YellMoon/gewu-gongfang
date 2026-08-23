'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadEnvironmentFile } = require('./launchConfig');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-storage-launch-'));
try {
  const config = path.join(root, 'agent.env');
  fs.writeFileSync(config, 'ONE=1\nTWO=value=with=equals\n', 'utf8');
  assert.deepStrictEqual(loadEnvironmentFile(config), { ONE: '1', TWO: 'value=with=equals' });
  fs.writeFileSync(config, 'ONE=1\nONE=2\n', 'utf8');
  assert.throws(() => loadEnvironmentFile(config), /STORAGE_AGENT_LAUNCH_CONFIG_INVALID/);
  console.log('storage agent launch config checks passed');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
