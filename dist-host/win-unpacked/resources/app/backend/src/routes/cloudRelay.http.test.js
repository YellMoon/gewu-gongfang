'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

assert.ok(fs.readFileSync('package.json', 'utf8').includes('backend/src/routes/cloudRelay.http.test.js'));

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-backend-relay-http-'));
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'backend-relay-http-secret';
process.env.DB_PATH = path.join(tempRoot, 'relay.db');
process.env.READ_DB_PATH = process.env.DB_PATH;

const { DatabaseService } = require('../database');
const database = new DatabaseService();
const databaseModule = require('../database');
databaseModule.getInstance = () => database;
delete require.cache[require.resolve('../app')];
const { createApp } = require('../app');

(async () => {
  const server = createApp().listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/cloud`;
  try {
    for (const request of [
      ['/desktop-session/challenges/start', { method: 'POST', body: '{}' }],
      ['/desktop-session/requests/retired', {}],
      ['/desktop-session/challenges/retired/exchange', { method: 'POST', body: '{}' }],
      ['/desktop-sync/requests', { method: 'POST', body: '{}' }],
    ]) {
      const response = await fetch(`${baseUrl}${request[0]}`, {
        ...request[1], headers: { 'content-type': 'application/json' },
      });
      assert.strictEqual(response.status, 410, `${request[0]} must be retired`);
      assert.strictEqual((await response.json()).error.code, 'LEGACY_ARCHITECTURE_RETIRED');
    }
    assert.strictEqual(
      database.db.prepare("SELECT COUNT(*) AS count FROM miniapp_tasks WHERE task_type IN ('desktop-session-challenge-start','desktop-session-challenge-exchange','desktop-sync')").get().count,
      0,
      'retired relay routes must never enqueue work',
    );
    console.log('backend cloud relay retirement HTTP checks passed');
  } finally {
    await new Promise(resolve => server.close(resolve));
    database.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
