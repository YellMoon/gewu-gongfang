const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const Database = require('better-sqlite3');
const { CloudRelaySocketServer } = require('./cloudRelayServer');
const { AuthoritySocketServer } = require('./authoritySocketServer');

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE authority_accounts(user_id TEXT PRIMARY KEY, authority_id TEXT, status TEXT);
  CREATE TABLE authority_role_bindings(
    binding_id TEXT PRIMARY KEY, authority_id TEXT, user_id TEXT, role TEXT,
    subject_type TEXT, subject_id TEXT, status TEXT, grant_version INTEGER, granted_by TEXT
  );
  CREATE TABLE desktop_device_authorizations(
    device_id TEXT PRIMARY KEY, user_id TEXT, status TEXT, public_key TEXT, credential_version INTEGER
  );
  CREATE TABLE primary_host_epochs(
    id TEXT PRIMARY KEY, device_id TEXT, db_authority_id TEXT, status TEXT
  );
`);
const server = http.createServer();
const relay = new CloudRelaySocketServer(server, {
  db,
  authorityEnabled: false,
  hostIdentity: () => ({ deviceId: 'host-1' }),
  desktopIdentity: () => ({ deviceId: 'desktop-1' }),
});
const authority = new AuthoritySocketServer(server, {
  handler: { handle: async () => ({ type: 'ok' }) },
});
let relayAuthorityUpgrades = 0;
let localAuthorityUpgrades = 0;
relay.authorityWss.handleUpgrade = () => { relayAuthorityUpgrades += 1; };
authority.wss.handleUpgrade = () => { localAuthorityUpgrades += 1; };

server.emit('upgrade', { url: '/ws/authority' }, {}, Buffer.alloc(0));

assert.strictEqual(relayAuthorityUpgrades, 0,
  'a primary host cloud relay must not own the local authority websocket path');
assert.strictEqual(localAuthorityUpgrades, 1,
  'the primary-host authority websocket must upgrade each request exactly once');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
assert.match(appSource, /app\.locals\.authorityDatabase\s*=\s*database/,
  'the backend app must expose the exact authority database used by its router and inbox');
assert.match(serverSource, /db:\s*app\.locals\.authorityDatabase/,
  'the backend cloud relay socket must share the app authority database instance');

server.removeAllListeners();
db.close();
console.log('websocket authority ownership checks passed');
