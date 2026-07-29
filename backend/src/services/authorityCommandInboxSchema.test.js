const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const db = new Database(':memory:');
db.exec(fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8'));

for (const table of [
  'device_grants',
  'device_leases',
  'host_commands',
  'host_receipts',
  'authority_projection_versions',
]) {
  assert.ok(
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table),
    `${table} must be created by the canonical backend schema`,
  );
}
assert.ok(
  db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_host_commands_claimable'").get(),
  'durable host commands must have a claim/recovery index',
);
assert.ok(
  db.prepare("SELECT name FROM pragma_table_info('authority_command_receipts') WHERE name='projection_version'").get(),
  'authority receipts must persist the committed projection version',
);

console.log('authorityCommandInbox schema tests passed');
