const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const db = new Database(':memory:');
db.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8'));

for (const table of [
  'authority_accounts',
  'authority_role_bindings',
  'role_application_mirrors',
  'role_grant_mirrors',
  'authority_scoped_projections',
  'device_grants',
  'device_leases',
  'primary_host_epochs',
  'host_commands',
  'host_receipts',
]) {
  assert(
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table),
    `${table} must exist in the gateway control-plane schema`
  );
}

assert(
  db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_host_commands_claimable'").get()
);
assert(
  db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_device_leases_active'").get()
);
assert(
  db.prepare("SELECT name FROM pragma_table_info('primary_host_epochs') WHERE name='host_credential_hash'").get(),
  'gateway host epochs must store the managed credential hash for WebSocket authentication'
);
assert(
  db.prepare("SELECT name FROM pragma_table_info('primary_host_epochs') WHERE name='host_public_key'").get(),
  'gateway host epochs must store the authority projection verification key'
);

db.close();
console.log('gateway authority control-plane schema tests passed');
