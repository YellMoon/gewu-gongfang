const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-authority-app-http-'));
process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(tempRoot, 'authority-app.db');
process.env.READ_DB_PATH = process.env.DB_PATH;
process.env.REQUIRE_NONCE = 'true';

const { DatabaseService } = require('../database');
const database = new DatabaseService();
const databaseModule = require('../database');
databaseModule.getInstance = () => database;
delete require.cache[require.resolve('../app')];
const { createApp } = require('../app');

async function expectRetired(baseUrl, requestPath, options, expectedCode) {
  const response = await fetch(`${baseUrl}${requestPath}`, options);
  const body = await response.json();
  assert.strictEqual(response.status, 410, JSON.stringify(body));
  assert.strictEqual(body.error.code, expectedCode);
}

(async function main() {
  const server = createApp().listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const commandCountBefore = database.db
      .prepare('SELECT COUNT(*) AS count FROM authority_command_ledger')
      .get().count;

    await expectRetired(baseUrl, '/api/authority/commands', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'schedule.update.v1' }),
    }, 'AUTHORITY_ENDPOINT_RETIRED');
    await expectRetired(baseUrl, '/api/authority/commands', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    }, 'AUTHORITY_ENDPOINT_RETIRED');
    await expectRetired(baseUrl, '/api/authority/commands', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-gewu-authority-user-id': 'retired-user',
        'x-gewu-authority-device-id': 'retired-device',
        'x-gewu-authority-role': 'teacher',
        'x-gewu-device-signature': 'retired-signature',
      },
      body: JSON.stringify({ type: 'role-admin.grant.v1' }),
    }, 'AUTHORITY_ENDPOINT_RETIRED');
    await expectRetired(baseUrl, '/api/authority/host/commands/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ limit: 1 }),
    }, 'AUTHORITY_ENDPOINT_RETIRED');
    await expectRetired(baseUrl, '/api/authority/projections/current', {},
      'AUTHORITY_ENDPOINT_RETIRED');
    await expectRetired(baseUrl, '/api/cloud/tasks', {}, 'CLOUD_RELAY_RETIRED');

    const commandCountAfter = database.db
      .prepare('SELECT COUNT(*) AS count FROM authority_command_ledger')
      .get().count;
    assert.strictEqual(commandCountAfter, commandCountBefore,
      'retired authority requests must not mutate the local command ledger');
    console.log('authorityProtocol retired app HTTP tests passed');
  } finally {
    await new Promise(resolve => server.close(resolve));
    database.close();
    assert.ok(path.resolve(tempRoot).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
