'use strict';

const V_NEXT_CONTROL_PLANE_REFERENCE_TABLES = Object.freeze([
  'vNext_account_device_links', 'vNext_accounts', 'vNext_authorities',
  'vNext_authorization_audit_events', 'vNext_authorization_command_receipts',
  'vNext_authorization_outbox_events', 'vNext_capability_catalog',
  'vNext_capability_overrides', 'vNext_data_scope_grants', 'vNext_device_installations',
  'vNext_profile_bindings', 'vNext_role_grants', 'vNext_schema_meta',
  'vNext_trusted_devices', 'vNext_verified_contacts',
]);

const NONEMPTY = "CHECK(length(trim(%s))>0)";
const SHA256 = name => `CHECK(typeof(${name})='text' AND length(${name})=64 AND ${name} NOT GLOB '*[^0-9a-f]*')`;
const integerAtLeast = (name, minimum) => `CHECK(typeof(${name})='integer' AND ${name}>=${minimum})`;
const nullableIntegerAtLeast = (name, minimum) => `CHECK(${name} IS NULL OR (typeof(${name})='integer' AND ${name}>=${minimum}))`;
const id = name => `${name} TEXT NOT NULL PRIMARY KEY ${NONEMPTY.replace('%s', name)}`;
const time = name => `${name} TEXT NOT NULL CHECK(julianday(${name}) IS NOT NULL)`;
const version = name => `${name} INTEGER NOT NULL ${integerAtLeast(name, 1)}`;

const STATEMENTS = Object.freeze([
  `CREATE TABLE IF NOT EXISTS vNext_schema_meta (${id('schema_key')} CHECK(schema_key='control-plane-reference'), schema_version INTEGER NOT NULL CHECK(schema_version=2), ${time('applied_at')})`,
  `CREATE TABLE IF NOT EXISTS vNext_authorities (${id('authority_id')}, status TEXT NOT NULL CHECK(status IN ('active','disabled','revoked')), ${time('created_at')}, ${time('updated_at')}, CHECK(julianday(updated_at)>=julianday(created_at)))`,
  `CREATE TABLE IF NOT EXISTS vNext_accounts (${id('account_id')}, authority_id TEXT NOT NULL ${NONEMPTY.replace('%s', 'authority_id')}, status TEXT NOT NULL CHECK(status IN ('active','disabled','revoked')), ${version('auth_version')}, ${version('access_version')}, ${version('revocation_version')}, ${version('row_version')}, ${time('created_at')}, ${time('updated_at')}, CHECK(julianday(updated_at)>=julianday(created_at)), UNIQUE(account_id,authority_id), FOREIGN KEY(authority_id) REFERENCES vNext_authorities(authority_id))`,
  `CREATE TABLE IF NOT EXISTS vNext_verified_contacts (${id('contact_id')}, authority_id TEXT NOT NULL ${NONEMPTY.replace('%s', 'authority_id')}, account_id TEXT NOT NULL ${NONEMPTY.replace('%s', 'account_id')}, contact_type TEXT NOT NULL CHECK(contact_type IN ('phone','wechat_openid','wechat_unionid')), normalized_value_hash TEXT NOT NULL ${NONEMPTY.replace('%s', 'normalized_value_hash')}, verification_state TEXT NOT NULL CHECK(verification_state IN ('verified','revoked')), verification_evidence_hash TEXT NOT NULL ${NONEMPTY.replace('%s', 'verification_evidence_hash')}, verified_at TEXT CHECK(verified_at IS NULL OR julianday(verified_at) IS NOT NULL), revoked_at TEXT CHECK(revoked_at IS NULL OR julianday(revoked_at) IS NOT NULL), ${version('row_version')}, ${time('created_at')}, ${time('updated_at')}, CHECK(julianday(updated_at)>=julianday(created_at)), CHECK((verification_state='verified' AND verified_at IS NOT NULL AND revoked_at IS NULL) OR (verification_state='revoked' AND verified_at IS NOT NULL AND revoked_at IS NOT NULL)), UNIQUE(authority_id,contact_type,normalized_value_hash), FOREIGN KEY(account_id,authority_id) REFERENCES vNext_accounts(account_id,authority_id))`,
  `CREATE TABLE IF NOT EXISTS vNext_role_grants (${id('grant_id')}, authority_id TEXT NOT NULL ${NONEMPTY.replace('%s', 'authority_id')}, account_id TEXT NOT NULL ${NONEMPTY.replace('%s', 'account_id')}, role TEXT NOT NULL CHECK(role IN ('super_admin','teacher','student')), status TEXT NOT NULL CHECK(status IN ('active','revoked','expired')), ${version('grant_version')}, ${version('row_version')}, ${time('starts_at')}, ends_at TEXT CHECK(ends_at IS NULL OR julianday(ends_at) IS NOT NULL), revoked_at TEXT CHECK(revoked_at IS NULL OR julianday(revoked_at) IS NOT NULL), granted_by_account_id TEXT, ${time('created_at')}, ${time('updated_at')}, CHECK(julianday(updated_at)>=julianday(created_at)), CHECK(ends_at IS NULL OR julianday(ends_at)>julianday(starts_at)), CHECK((status='active' AND revoked_at IS NULL) OR (status='revoked' AND revoked_at IS NOT NULL) OR (status='expired' AND ends_at IS NOT NULL AND revoked_at IS NULL)), FOREIGN KEY(account_id,authority_id) REFERENCES vNext_accounts(account_id,authority_id), FOREIGN KEY(granted_by_account_id,authority_id) REFERENCES vNext_accounts(account_id,authority_id))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS vNext_role_grants_one_active_role ON vNext_role_grants(authority_id,account_id,role) WHERE status='active'`,
  `CREATE TABLE IF NOT EXISTS vNext_capability_catalog (capability_id TEXT NOT NULL PRIMARY KEY ${NONEMPTY.replace('%s', 'capability_id')}, status TEXT NOT NULL CHECK(status IN ('active','retired')), surface_mask TEXT NOT NULL ${NONEMPTY.replace('%s', 'surface_mask')}, ${time('created_at')})`,
  `CREATE TABLE IF NOT EXISTS vNext_capability_overrides (${id('override_id')}, authority_id TEXT NOT NULL ${NONEMPTY.replace('%s', 'authority_id')}, account_id TEXT NOT NULL ${NONEMPTY.replace('%s', 'account_id')}, capability_id TEXT NOT NULL ${NONEMPTY.replace('%s', 'capability_id')}, effect TEXT NOT NULL CHECK(effect IN ('allow','deny')), status TEXT NOT NULL CHECK(status IN ('active','revoked','expired')), ${time('starts_at')}, ends_at TEXT CHECK(ends_at IS NULL OR julianday(ends_at) IS NOT NULL), ${version('row_version')}, ${time('created_at')}, ${time('updated_at')}, revoked_at TEXT CHECK(revoked_at IS NULL OR julianday(revoked_at) IS NOT NULL), CHECK(julianday(updated_at)>=julianday(created_at)), CHECK(ends_at IS NULL OR julianday(ends_at)>julianday(starts_at)), CHECK((status='active' AND revoked_at IS NULL) OR (status='revoked' AND revoked_at IS NOT NULL) OR (status='expired' AND ends_at IS NOT NULL AND revoked_at IS NULL)), FOREIGN KEY(account_id,authority_id) REFERENCES vNext_accounts(account_id,authority_id), FOREIGN KEY(capability_id) REFERENCES vNext_capability_catalog(capability_id))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS vNext_capability_overrides_one_active_capability ON vNext_capability_overrides(authority_id,account_id,capability_id) WHERE status='active'`,
  `CREATE TABLE IF NOT EXISTS vNext_data_scope_grants (${id('scope_grant_id')}, authority_id TEXT NOT NULL ${NONEMPTY.replace('%s', 'authority_id')}, account_id TEXT NOT NULL ${NONEMPTY.replace('%s', 'account_id')}, scope_type TEXT NOT NULL CHECK(scope_type IN ('teacher_profile','student_profile','school','household','resource_owner')), scope_value_hash TEXT NOT NULL ${NONEMPTY.replace('%s', 'scope_value_hash')}, effect TEXT NOT NULL CHECK(effect IN ('allow','deny')), status TEXT NOT NULL CHECK(status IN ('active','revoked','expired')), ${time('starts_at')}, ends_at TEXT CHECK(ends_at IS NULL OR julianday(ends_at) IS NOT NULL), ${version('row_version')}, ${time('created_at')}, ${time('updated_at')}, revoked_at TEXT CHECK(revoked_at IS NULL OR julianday(revoked_at) IS NOT NULL), CHECK(julianday(updated_at)>=julianday(created_at)), CHECK(ends_at IS NULL OR julianday(ends_at)>julianday(starts_at)), CHECK((status='active' AND revoked_at IS NULL) OR (status='revoked' AND revoked_at IS NOT NULL) OR (status='expired' AND ends_at IS NOT NULL AND revoked_at IS NULL)), FOREIGN KEY(account_id,authority_id) REFERENCES vNext_accounts(account_id,authority_id))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS vNext_data_scope_grants_one_active_scope ON vNext_data_scope_grants(authority_id,account_id,scope_type,scope_value_hash) WHERE status='active'`,
  `CREATE TABLE IF NOT EXISTS vNext_profile_bindings (${id('binding_id')}, authority_id TEXT NOT NULL ${NONEMPTY.replace('%s', 'authority_id')}, account_id TEXT NOT NULL ${NONEMPTY.replace('%s', 'account_id')}, profile_type TEXT NOT NULL CHECK(profile_type IN ('teacher','student')), profile_id TEXT NOT NULL ${NONEMPTY.replace('%s', 'profile_id')}, status TEXT NOT NULL CHECK(status IN ('active','revoked','pending')), evidence_hash TEXT NOT NULL ${NONEMPTY.replace('%s', 'evidence_hash')}, ${version('row_version')}, ${time('created_at')}, ${time('updated_at')}, revoked_at TEXT CHECK(revoked_at IS NULL OR julianday(revoked_at) IS NOT NULL), CHECK(julianday(updated_at)>=julianday(created_at)), CHECK((status='revoked' AND revoked_at IS NOT NULL) OR (status IN ('active','pending') AND revoked_at IS NULL)), FOREIGN KEY(account_id,authority_id) REFERENCES vNext_accounts(account_id,authority_id))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS vNext_profile_bindings_one_active_account_type ON vNext_profile_bindings(authority_id,account_id,profile_type) WHERE status='active'`,
  `CREATE UNIQUE INDEX IF NOT EXISTS vNext_profile_bindings_one_active_profile ON vNext_profile_bindings(authority_id,profile_type,profile_id) WHERE status='active'`,
  `CREATE TABLE IF NOT EXISTS vNext_trusted_devices (${id('device_id')}, authority_id TEXT NOT NULL ${NONEMPTY.replace('%s', 'authority_id')}, status TEXT NOT NULL CHECK(status IN ('active','risk_limited','revoked','retired')), hardware_evidence_hash TEXT, risk_code TEXT, ${version('credential_version')}, ${version('risk_version')}, ${version('row_version')}, ${time('created_at')}, ${time('updated_at')}, revoked_at TEXT CHECK(revoked_at IS NULL OR julianday(revoked_at) IS NOT NULL), CHECK(julianday(updated_at)>=julianday(created_at)), CHECK((status='revoked' AND revoked_at IS NOT NULL) OR (status!='revoked' AND revoked_at IS NULL)), UNIQUE(device_id,authority_id), FOREIGN KEY(authority_id) REFERENCES vNext_authorities(authority_id))`,
  `CREATE TABLE IF NOT EXISTS vNext_device_installations (${id('installation_id')}, authority_id TEXT NOT NULL ${NONEMPTY.replace('%s', 'authority_id')}, device_id TEXT NOT NULL ${NONEMPTY.replace('%s', 'device_id')}, installation_public_key TEXT NOT NULL ${NONEMPTY.replace('%s', 'installation_public_key')}, key_fingerprint TEXT NOT NULL ${NONEMPTY.replace('%s', 'key_fingerprint')}, status TEXT NOT NULL CHECK(status IN ('active','revoked','retired')), ${version('credential_version')}, ${version('row_version')}, ${time('created_at')}, ${time('updated_at')}, revoked_at TEXT CHECK(revoked_at IS NULL OR julianday(revoked_at) IS NOT NULL), CHECK(julianday(updated_at)>=julianday(created_at)), CHECK((status='revoked' AND revoked_at IS NOT NULL) OR (status!='revoked' AND revoked_at IS NULL)), UNIQUE(installation_id,device_id,authority_id), UNIQUE(authority_id,key_fingerprint), FOREIGN KEY(device_id,authority_id) REFERENCES vNext_trusted_devices(device_id,authority_id))`,
  `CREATE TABLE IF NOT EXISTS vNext_account_device_links (${id('link_id')}, authority_id TEXT NOT NULL ${NONEMPTY.replace('%s', 'authority_id')}, account_id TEXT NOT NULL ${NONEMPTY.replace('%s', 'account_id')}, device_id TEXT NOT NULL ${NONEMPTY.replace('%s', 'device_id')}, installation_id TEXT NOT NULL ${NONEMPTY.replace('%s', 'installation_id')}, status TEXT NOT NULL CHECK(status IN ('active','revoked','expired')), ${version('auth_version')}, ${version('access_version')}, ${version('row_version')}, ${time('created_at')}, ${time('updated_at')}, revoked_at TEXT CHECK(revoked_at IS NULL OR julianday(revoked_at) IS NOT NULL), CHECK(julianday(updated_at)>=julianday(created_at)), CHECK((status='revoked' AND revoked_at IS NOT NULL) OR (status='expired' AND revoked_at IS NULL) OR status='active'), UNIQUE(authority_id,account_id,installation_id), FOREIGN KEY(account_id,authority_id) REFERENCES vNext_accounts(account_id,authority_id), FOREIGN KEY(device_id,authority_id) REFERENCES vNext_trusted_devices(device_id,authority_id), FOREIGN KEY(installation_id,device_id,authority_id) REFERENCES vNext_device_installations(installation_id,device_id,authority_id))`,
  `CREATE TABLE IF NOT EXISTS vNext_authorization_command_receipts (${id('receipt_id')}, authority_id TEXT NOT NULL ${NONEMPTY.replace('%s', 'authority_id')}, actor_key TEXT NOT NULL ${NONEMPTY.replace('%s', 'actor_key')}, actor_account_id TEXT, idempotency_key TEXT NOT NULL ${NONEMPTY.replace('%s', 'idempotency_key')}, command_type TEXT NOT NULL ${NONEMPTY.replace('%s', 'command_type')}, target_kind TEXT NOT NULL ${NONEMPTY.replace('%s', 'target_kind')}, target_id TEXT NOT NULL ${NONEMPTY.replace('%s', 'target_id')}, canonical_request_sha256 TEXT NOT NULL ${SHA256('canonical_request_sha256')}, expected_row_version INTEGER ${nullableIntegerAtLeast('expected_row_version', 0)}, outcome TEXT NOT NULL CHECK(outcome IN ('accepted','rejected','noop')), result_code TEXT NOT NULL ${NONEMPTY.replace('%s', 'result_code')}, canonical_result_json TEXT NOT NULL CHECK(json_valid(canonical_result_json)), canonical_result_sha256 TEXT NOT NULL ${SHA256('canonical_result_sha256')}, committed_auth_version INTEGER ${nullableIntegerAtLeast('committed_auth_version', 1)}, committed_access_version INTEGER ${nullableIntegerAtLeast('committed_access_version', 1)}, committed_revocation_version INTEGER ${nullableIntegerAtLeast('committed_revocation_version', 1)}, committed_target_row_version INTEGER ${nullableIntegerAtLeast('committed_target_row_version', 1)}, ${time('created_at')}, UNIQUE(receipt_id,authority_id), UNIQUE(authority_id,actor_key,idempotency_key), FOREIGN KEY(authority_id) REFERENCES vNext_authorities(authority_id), FOREIGN KEY(actor_account_id,authority_id) REFERENCES vNext_accounts(account_id,authority_id))`,
  `CREATE TABLE IF NOT EXISTS vNext_authorization_outbox_events (${id('event_id')}, authority_id TEXT NOT NULL ${NONEMPTY.replace('%s', 'authority_id')}, receipt_id TEXT NOT NULL ${NONEMPTY.replace('%s', 'receipt_id')}, event_type TEXT NOT NULL ${NONEMPTY.replace('%s', 'event_type')}, aggregate_kind TEXT NOT NULL ${NONEMPTY.replace('%s', 'aggregate_kind')}, aggregate_id TEXT NOT NULL ${NONEMPTY.replace('%s', 'aggregate_id')}, aggregate_version INTEGER NOT NULL ${integerAtLeast('aggregate_version', 1)}, canonical_payload_json TEXT NOT NULL CHECK(json_valid(canonical_payload_json)), payload_sha256 TEXT NOT NULL ${SHA256('payload_sha256')}, ${time('occurred_at')}, UNIQUE(authority_id,receipt_id,event_type,aggregate_kind,aggregate_id), FOREIGN KEY(authority_id) REFERENCES vNext_authorities(authority_id), FOREIGN KEY(receipt_id,authority_id) REFERENCES vNext_authorization_command_receipts(receipt_id,authority_id))`,
  `CREATE TABLE IF NOT EXISTS vNext_authorization_audit_events (${id('event_id')}, authority_id TEXT NOT NULL ${NONEMPTY.replace('%s', 'authority_id')}, receipt_id TEXT NOT NULL ${NONEMPTY.replace('%s', 'receipt_id')}, reason_code TEXT NOT NULL ${NONEMPTY.replace('%s', 'reason_code')}, context_sha256 TEXT NOT NULL ${SHA256('context_sha256')}, ${time('created_at')}, UNIQUE(authority_id,receipt_id), FOREIGN KEY(authority_id) REFERENCES vNext_authorities(authority_id), FOREIGN KEY(receipt_id,authority_id) REFERENCES vNext_authorization_command_receipts(receipt_id,authority_id))`,
  `CREATE TRIGGER IF NOT EXISTS vNext_authorization_command_receipts_no_update BEFORE UPDATE ON vNext_authorization_command_receipts BEGIN SELECT RAISE(ABORT,'vNext command receipt is append-only'); END`,
  `CREATE TRIGGER IF NOT EXISTS vNext_authorization_command_receipts_no_delete BEFORE DELETE ON vNext_authorization_command_receipts BEGIN SELECT RAISE(ABORT,'vNext command receipt is append-only'); END`,
  `CREATE TRIGGER IF NOT EXISTS vNext_authorization_outbox_events_no_update BEFORE UPDATE ON vNext_authorization_outbox_events BEGIN SELECT RAISE(ABORT,'vNext outbox event is append-only'); END`,
  `CREATE TRIGGER IF NOT EXISTS vNext_authorization_outbox_events_no_delete BEFORE DELETE ON vNext_authorization_outbox_events BEGIN SELECT RAISE(ABORT,'vNext outbox event is append-only'); END`,
  `CREATE TRIGGER IF NOT EXISTS vNext_authorization_audit_events_no_update BEFORE UPDATE ON vNext_authorization_audit_events BEGIN SELECT RAISE(ABORT,'vNext audit is append-only'); END`,
  `CREATE TRIGGER IF NOT EXISTS vNext_authorization_audit_events_no_delete BEFORE DELETE ON vNext_authorization_audit_events BEGIN SELECT RAISE(ABORT,'vNext audit is append-only'); END`,
]);

function normalizeSql(sql) { return String(sql).replace(/\s+/g, ' ').trim(); }
const REQUIRED_TABLE_SQL = Object.freeze(Object.fromEntries(
  STATEMENTS.filter(statement => statement.startsWith('CREATE TABLE')).map(statement => {
    const tableName = /^CREATE TABLE IF NOT EXISTS ([A-Za-z0-9_]+)/.exec(statement)[1];
    return [tableName, normalizeSql(statement.replace('CREATE TABLE IF NOT EXISTS ', 'CREATE TABLE '))];
  }),
));

const REQUIRED_COLUMNS = Object.freeze({
  vNext_account_device_links: ['link_id','authority_id','account_id','device_id','installation_id','status','auth_version','access_version','row_version','created_at','updated_at','revoked_at'],
  vNext_authorities: ['authority_id','status','created_at','updated_at'],
  vNext_accounts: ['account_id','authority_id','status','auth_version','access_version','revocation_version','row_version','created_at','updated_at'],
  vNext_capability_catalog: ['capability_id','status','surface_mask','created_at'],
  vNext_capability_overrides: ['override_id','authority_id','account_id','capability_id','effect','status','starts_at','ends_at','row_version','created_at','updated_at','revoked_at'],
  vNext_data_scope_grants: ['scope_grant_id','authority_id','account_id','scope_type','scope_value_hash','effect','status','starts_at','ends_at','row_version','created_at','updated_at','revoked_at'],
  vNext_device_installations: ['installation_id','authority_id','device_id','installation_public_key','key_fingerprint','status','credential_version','row_version','created_at','updated_at','revoked_at'],
  vNext_profile_bindings: ['binding_id','authority_id','account_id','profile_type','profile_id','status','evidence_hash','row_version','created_at','updated_at','revoked_at'],
  vNext_role_grants: ['grant_id','authority_id','account_id','role','status','grant_version','row_version','starts_at','ends_at','revoked_at','granted_by_account_id','created_at','updated_at'],
  vNext_schema_meta: ['schema_key','schema_version','applied_at'],
  vNext_trusted_devices: ['device_id','authority_id','status','hardware_evidence_hash','risk_code','credential_version','risk_version','row_version','created_at','updated_at','revoked_at'],
  vNext_verified_contacts: ['contact_id','authority_id','account_id','contact_type','normalized_value_hash','verification_state','verification_evidence_hash','verified_at','revoked_at','row_version','created_at','updated_at'],
  vNext_authorization_audit_events: ['event_id','authority_id','receipt_id','reason_code','context_sha256','created_at'],
  vNext_authorization_command_receipts: ['receipt_id','authority_id','actor_key','actor_account_id','idempotency_key','command_type','target_kind','target_id','canonical_request_sha256','expected_row_version','outcome','result_code','canonical_result_json','canonical_result_sha256','committed_auth_version','committed_access_version','committed_revocation_version','committed_target_row_version','created_at'],
  vNext_authorization_outbox_events: ['event_id','authority_id','receipt_id','event_type','aggregate_kind','aggregate_id','aggregate_version','canonical_payload_json','payload_sha256','occurred_at'],
});
const REQUIRED_INDEX_SQL = Object.freeze({
  vNext_capability_overrides_one_active_capability: "CREATE UNIQUE INDEX vNext_capability_overrides_one_active_capability ON vNext_capability_overrides(authority_id,account_id,capability_id) WHERE status='active'",
  vNext_data_scope_grants_one_active_scope: "CREATE UNIQUE INDEX vNext_data_scope_grants_one_active_scope ON vNext_data_scope_grants(authority_id,account_id,scope_type,scope_value_hash) WHERE status='active'",
  vNext_profile_bindings_one_active_account_type: "CREATE UNIQUE INDEX vNext_profile_bindings_one_active_account_type ON vNext_profile_bindings(authority_id,account_id,profile_type) WHERE status='active'",
  vNext_profile_bindings_one_active_profile: "CREATE UNIQUE INDEX vNext_profile_bindings_one_active_profile ON vNext_profile_bindings(authority_id,profile_type,profile_id) WHERE status='active'",
  vNext_role_grants_one_active_role: "CREATE UNIQUE INDEX vNext_role_grants_one_active_role ON vNext_role_grants(authority_id,account_id,role) WHERE status='active'",
});
const REQUIRED_TRIGGER_SQL = Object.freeze({
  vNext_authorization_command_receipts_no_update: 'BEFORE UPDATE ON vNext_authorization_command_receipts BEGIN SELECT RAISE(ABORT,\'vNext command receipt is append-only\'); END',
  vNext_authorization_command_receipts_no_delete: 'BEFORE DELETE ON vNext_authorization_command_receipts BEGIN SELECT RAISE(ABORT,\'vNext command receipt is append-only\'); END',
  vNext_authorization_outbox_events_no_update: 'BEFORE UPDATE ON vNext_authorization_outbox_events BEGIN SELECT RAISE(ABORT,\'vNext outbox event is append-only\'); END',
  vNext_authorization_outbox_events_no_delete: 'BEFORE DELETE ON vNext_authorization_outbox_events BEGIN SELECT RAISE(ABORT,\'vNext outbox event is append-only\'); END',
  vNext_authorization_audit_events_no_update: 'BEFORE UPDATE ON vNext_authorization_audit_events BEGIN SELECT RAISE(ABORT,\'vNext audit is append-only\'); END',
  vNext_authorization_audit_events_no_delete: 'BEFORE DELETE ON vNext_authorization_audit_events BEGIN SELECT RAISE(ABORT,\'vNext audit is append-only\'); END',
});

function kernelError(code) { return Object.assign(new Error(code), { code }); }
function assertConnection(db) {
  if (!db || typeof db.exec !== 'function' || typeof db.prepare !== 'function' || typeof db.transaction !== 'function' || typeof db.pragma !== 'function') throw kernelError('VNEXT_REFERENCE_SQLITE_CONNECTION_REQUIRED');
  db.pragma('foreign_keys = ON');
  if (Number(db.pragma('foreign_keys', { simple: true })) !== 1) throw kernelError('VNEXT_REFERENCE_FOREIGN_KEYS_REQUIRED');
}
function assertSchema(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'vNext_%' ORDER BY name").all().map(row => row.name);
  if (JSON.stringify(tables) !== JSON.stringify(V_NEXT_CONTROL_PLANE_REFERENCE_TABLES)) throw kernelError('VNEXT_REFERENCE_SCHEMA_DRIFT');
  for (const [table, expected] of Object.entries(REQUIRED_COLUMNS)) {
    const actual = db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw kernelError('VNEXT_REFERENCE_SCHEMA_DRIFT');
  }
  const tableSql = db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name LIKE 'vNext_%'").all();
  if (tableSql.some(table => normalizeSql(table.sql) !== REQUIRED_TABLE_SQL[table.name])) throw kernelError('VNEXT_REFERENCE_SCHEMA_DRIFT');
  const indexes = db.prepare("SELECT name,sql,tbl_name FROM sqlite_master WHERE type='index' AND sql IS NOT NULL AND (name LIKE 'vNext_%' OR tbl_name LIKE 'vNext_%')").all();
  if (indexes.length !== Object.keys(REQUIRED_INDEX_SQL).length || indexes.some(index => normalizeSql(index.sql) !== REQUIRED_INDEX_SQL[index.name])) throw kernelError('VNEXT_REFERENCE_SCHEMA_DRIFT');
  const triggers = db.prepare("SELECT name,sql,tbl_name FROM sqlite_master WHERE type='trigger' AND (name LIKE 'vNext_%' OR tbl_name LIKE 'vNext_%')").all();
  if (triggers.length !== Object.keys(REQUIRED_TRIGGER_SQL).length || triggers.some(trigger => normalizeSql(trigger.sql) !== `CREATE TRIGGER ${trigger.name} ${REQUIRED_TRIGGER_SQL[trigger.name]}`)) throw kernelError('VNEXT_REFERENCE_SCHEMA_DRIFT');
}
function bootstrapVNextControlPlaneReference(db, { now = () => new Date().toISOString(), testHooks = {} } = {}) {
  assertConnection(db);
  const hasMetaTable = db.prepare("SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name='vNext_schema_meta'").get();
  if (hasMetaTable) assertSchema(db);
  const apply = db.transaction(() => {
    for (let index = 0; index < STATEMENTS.length; index += 1) { db.exec(STATEMENTS[index]); if (typeof testHooks.afterStatement === 'function') testHooks.afterStatement({ index: index + 1 }); }
    db.prepare(`INSERT INTO vNext_schema_meta(schema_key,schema_version,applied_at) VALUES('control-plane-reference',2,?) ON CONFLICT(schema_key) DO NOTHING`).run(String(now()));
    const meta = db.prepare("SELECT schema_version FROM vNext_schema_meta WHERE schema_key='control-plane-reference'").get();
    if (!meta || Number(meta.schema_version) !== 2) throw kernelError('VNEXT_REFERENCE_SCHEMA_DRIFT');
    assertSchema(db);
  });
  apply();
  return Object.freeze({ schemaVersion: 2, tables: V_NEXT_CONTROL_PLANE_REFERENCE_TABLES });
}
module.exports = { V_NEXT_CONTROL_PLANE_REFERENCE_TABLES, bootstrapVNextControlPlaneReference };
