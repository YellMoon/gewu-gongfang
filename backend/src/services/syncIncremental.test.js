const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { DatabaseService } = require('../database');

function withTempService(testFn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-sync-'));
  const dbPath = path.join(dir, 'test.db');
  const previousDbPath = process.env.DB_PATH;
  const previousReadDbPath = process.env.READ_DB_PATH;
  process.env.DB_PATH = dbPath;
  process.env.READ_DB_PATH = dbPath;

  const service = new DatabaseService();
  try {
    testFn(service);
  } finally {
    service.close();
    if (previousDbPath === undefined) delete process.env.DB_PATH;
    else process.env.DB_PATH = previousDbPath;
    if (previousReadDbPath === undefined) delete process.env.READ_DB_PATH;
    else process.env.READ_DB_PATH = previousReadDbPath;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function testSameMillisecondWaterlineIsNotSkipped() {
  withTempService((service) => {
    const ts = '2026-05-15T00:00:00.123Z';
    service.db.prepare(
      'INSERT INTO students (id, name, phone, school, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run('same-ms-student', 'same-ms', '', '', ts, ts);

    const payload = service.getChangeQueueSince(ts, {
      tenantId: 'default',
      deviceId: 'server',
      clientId: 'test-device',
    });

    assert(payload.changes.some(
      change => change.table === 'students' && change.data.id === 'same-ms-student'
    ));
  });
}

function main() {
  testSameMillisecondWaterlineIsNotSkipped();
  console.log('syncIncremental tests passed');
}

main();
