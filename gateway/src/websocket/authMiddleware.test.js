const assert = require('assert');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { authenticateWebSocket } = require('./authMiddleware');

function socketProbe() {
  return {
    writes: [],
    destroyed: false,
    write(value) { this.writes.push(value); },
    destroy() { this.destroyed = true; },
  };
}

const db = new Database(':memory:');
db.exec(`CREATE TABLE primary_host_epochs (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  status TEXT NOT NULL,
  host_credential_hash TEXT NOT NULL,
  credential_version INTEGER NOT NULL
)`);
const credential = 'managed-host-credential-test-only';
const credentialHash = crypto.createHash('sha256').update(credential).digest('hex');
db.prepare(`INSERT INTO primary_host_epochs
  (id,device_id,generation,status,host_credential_hash,credential_version)
  VALUES('epoch-1','host-1',3,'active',?,1)`).run(credentialHash);

const acceptedSocket = socketProbe();
const acceptedRequest = {
  url: '/ws/cloud-relay?role=host&deviceId=host-1',
  headers: {
    'x-gewu-host-device-id': 'host-1',
    'x-gewu-host-generation': '3',
    'x-gewu-host-credential': credential,
  },
};
let accepted = false;
authenticateWebSocket(acceptedRequest, acceptedSocket, error => {
  assert.ifError(error);
  accepted = true;
}, { db });
assert.strictEqual(accepted, true);
assert.strictEqual(acceptedRequest.user.deviceId, 'host-1');
assert.strictEqual(acceptedRequest.user.activeRole, 'host');
assert.strictEqual(acceptedSocket.destroyed, false);

const legacySocket = socketProbe();
authenticateWebSocket({
  url: '/ws/cloud-relay?role=host&deviceId=host-1&token=legacy-shared-token',
  headers: {},
}, legacySocket, () => {
  throw new Error('legacy shared token must not authenticate a host');
}, { db });
assert.strictEqual(legacySocket.destroyed, true);

db.close();
console.log('gateway WebSocket managed host auth tests passed');
