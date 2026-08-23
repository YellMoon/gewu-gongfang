'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runStorageAgentHealthCheck } = require('./health');

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-storage-agent-health-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-storage-agent-health-outside-'));
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

    fs.rmSync(path.join(root, '.gewu-storage-agent'), { recursive: true, force: true });
    fs.symlinkSync(outside, path.join(root, '.gewu-storage-agent'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(
      () => runStorageAgentHealthCheck({
        config: { agentId: 'storage-agent-1', nasRoot: root },
        version: '8.0.6',
        randomId: () => 'healthcheck-2',
        now: () => new Date('2026-08-22T00:00:00.000Z'),
      }),
      /STORAGE_AGENT_HEALTH_FAILED/,
      'a linked health namespace must not redirect a probe outside the NAS root'
    );
    assert.deepStrictEqual(fs.readdirSync(outside), [], 'a rejected health link must not write outside the NAS root');

    const linkedRoot = `${root}-linked`;
    fs.symlinkSync(outside, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(
      () => runStorageAgentHealthCheck({
        config: { agentId: 'storage-agent-1', nasRoot: linkedRoot },
        version: '8.0.6',
        randomId: () => 'healthcheck-3',
        now: () => new Date('2026-08-22T00:00:00.000Z'),
      }),
      /STORAGE_AGENT_HEALTH_FAILED/,
      'the configured NAS root itself must not be a junction or symbolic link'
    );
    assert.deepStrictEqual(fs.readdirSync(outside), [], 'a linked NAS root must not receive a health probe');
    fs.rmSync(linkedRoot, { recursive: true, force: true });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
}

main().then(() => console.log('storage agent health checks passed')).catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
