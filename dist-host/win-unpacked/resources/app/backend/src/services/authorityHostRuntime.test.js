const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-authority-host-runtime-'));
process.env.DB_PATH = path.join(tempRoot, 'runtime.db');
process.env.READ_DB_PATH = process.env.DB_PATH;
const { DatabaseService } = require('../database');
const { createAuthorityHostRuntime } = require('./authorityHostRuntime');

(async function main() {
  const database = new DatabaseService();
  try {
    const calls = [];
    const runtime = createAuthorityHostRuntime({
      database,
      targetHostId: 'host-runtime-1',
      commandSource: {
        claim: async input => {
          calls.push(input);
          return [];
        },
        renew: async () => {
          throw new Error('renew must not run without a claim');
        },
        publishReceipt: async () => {
          throw new Error('publish must not run without a claim');
        },
      },
    });
    assert.deepStrictEqual(
      await runtime.processor.processOnce(),
      { processed: 0, replayed: 0, recovered: 0 },
    );
    assert.strictEqual(calls[0].targetHostId, 'host-runtime-1');
    assert.strictEqual(typeof runtime.executor.execute, 'function');
    assert.strictEqual(typeof runtime.authorization.authorize, 'function');
    console.log('authorityHostRuntime tests passed');
  } finally {
    database.close();
    assert.ok(path.resolve(tempRoot).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
