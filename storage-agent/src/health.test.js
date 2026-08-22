'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runStorageAgentHealthCheck } = require('./health');

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-storage-agent-health-'));
  const sentinel = path.join(root, 'existing-object');
  fs.writeFileSync(sentinel, 'preserve', 'utf8');
  try {
    const result = await runStorageAgentHealthCheck({
      config: { agentId: 'storage-agent-1', nasRoot: root },
      version: '8.0.6',
      randomId: () => 'healthcheck-1',
      now: () => new Date('2026-08-22T00:00:00.000Z'),
    });
    assert.deepStrictEqual(result, {
      ok: true,
      agentId: 'storage-agent-1',
      version: '8.0.6',
      checkedAt: '2026-08-22T00:00:00.000Z',
      writableAuthority: false,
    });
    assert.strictEqual(fs.readFileSync(sentinel, 'utf8'), 'preserve', 'a health rehearsal must not touch ordinary NAS objects');
    assert.ok(!fs.existsSync(path.join(root, '.gewu-storage-agent', 'health', 'healthcheck-1.probe')), 'the probe file must be cleaned up after read-back verification');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().then(() => console.log('storage agent health checks passed')).catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
