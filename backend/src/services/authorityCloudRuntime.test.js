const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-authority-cloud-runtime-'));
process.env.DB_PATH = path.join(tempRoot, 'runtime.db');
process.env.READ_DB_PATH = process.env.DB_PATH;
const { DatabaseService } = require('../database');
const { createAuthorityCloudRuntime } = require('./authorityCloudRuntime');

(async function main() {
  const database = new DatabaseService();
  try {
    const runtime = createAuthorityCloudRuntime({ database });
    assert.strictEqual(typeof runtime.execute, 'function');
    assert.strictEqual(typeof runtime.findReceipt, 'function');
    assert.strictEqual(Object.hasOwn(runtime, 'processor'), false,
      'cloud authority must not expose a desktop-host command processor');
    console.log('authorityCloudRuntime tests passed');
  } finally {
    database.close();
    assert.ok(path.resolve(tempRoot).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
