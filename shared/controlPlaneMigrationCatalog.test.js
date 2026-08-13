'use strict';

const assert = require('assert');

const { buildControlPlaneMigrationCatalog } = require('./controlPlaneMigrationCatalog');

function table(columns) {
  return { columns: columns.map(name => ({ name })) };
}

const inventory = {
  tables: {
    users: table([
      'id', 'wechat_openid', 'wechat_unionid', 'phone', 'name', 'role', 'status', 'login_enabled',
      'identity_kind', 'auth_version', 'disabled_at', 'teacher_id', 'review_status', 'reviewed_by',
      'reviewed_at', 'is_super_admin_identity', 'deleted', 'created_at', 'updated_at',
    ]),
    user_role_grants: table(['user_id', 'role', 'subject_type', 'subject_id', 'status', 'source', 'granted_by', 'created_at', 'updated_at', 'revoked_at']),
    authority_role_bindings: table(['binding_id', 'authority_id', 'user_id', 'role', 'subject_type', 'subject_id', 'status', 'grant_version', 'granted_by', 'created_at', 'updated_at', 'revoked_at']),
    teachers: table(['id', 'name', 'phone', 'hourly_rate', 'created_at']),
    students: table(['id', 'name', 'phone', 'balance', 'created_at']),
    desktop_device_authorizations: table(['id', 'device_id', 'user_id', 'public_key', 'key_fingerprint', 'status', 'source_challenge_id', 'credential_version', 'last_seen_at', 'revoked_at']),
    desktop_identity_challenges: table(['id', 'device_id', 'challenge_token_hash', 'short_code', 'status', 'expires_at']),
    desktop_device_session_challenges: table(['id', 'authorization_id', 'device_id', 'user_id', 'nonce_hash', 'status', 'expires_at']),
    desktop_sessions: table(['sid', 'user_id', 'device_id', 'authorization_id', 'active_role', 'auth_version', 'credential_version', 'status', 'issued_at', 'expires_at', 'revoke_reason', 'revoked_at']),
    authorization_audit_log: table(['id', 'actor_user_id', 'actor_phone', 'target_user_id', 'action', 'before_json', 'after_json', 'created_at']),
    miniapp_login_events: table(['id', 'user_id', 'phone_normalized', 'identity_kind', 'result_code', 'session_id', 'miniapp_version', 'platform', 'created_at']),
    authority_accounts: table(['user_id', 'authority_id', 'status', 'created_at', 'updated_at']),
    host_commands: table(['command_id', 'target_host_id', 'actor_user_id', 'device_id', 'envelope_json', 'payload_hash']),
    sync_authorizations: table(['id', 'token_hash', 'actor_user_id', 'expires_at']),
    constructor: table(['id', 'unexpected']),
    toString: table(['id', 'unexpected']),
    questions: table(['id', 'content', 'answer', 'owner_user_id']),
    deceptive_device_sessions: table(['id', 'secret_token', 'user_id']),
  },
};
Object.defineProperty(inventory.tables, '__proto__', {
  value: table(['id', 'unexpected']), enumerable: true, configurable: true,
});

const catalog = buildControlPlaneMigrationCatalog({ inventory });
const byTable = Object.fromEntries(catalog.tables.map(entry => [entry.tableName, entry]));

assert.deepStrictEqual(catalog.tables.map(entry => entry.tableName), [...catalog.tables.map(entry => entry.tableName)].sort());
assert.strictEqual(catalog.schemaVersion, 1);
assert.strictEqual(catalog.mode, 'control-plane-catalog-only');
assert.ok(catalog.tables.every(entry => entry.disposition), 'every source table needs exactly one disposition');
assert.ok(Object.isFrozen(catalog));
assert.ok(Object.isFrozen(catalog.tables));
assert.ok(catalog.tables.every(entry => Object.isFrozen(entry)));
assert.deepStrictEqual(byTable.users.admittedColumns, [
  'auth_version', 'created_at', 'deleted', 'disabled_at', 'id', 'identity_kind', 'is_super_admin_identity',
  'login_enabled', 'review_status', 'reviewed_at', 'reviewed_by', 'status', 'updated_at', 'wechat_openid', 'wechat_unionid',
]);
assert.ok(byTable.users.deniedColumns.includes('role'));
assert.ok(byTable.users.deniedColumns.includes('phone'));
assert.ok(byTable.users.deniedColumns.includes('name'));
assert.ok(byTable.users.deniedColumns.includes('teacher_id'));
assert.strictEqual(byTable.users.disposition, 'candidate_evidence');
assert.strictEqual(byTable.user_role_grants.disposition, 'restricted_legacy_grant_evidence');
assert.strictEqual(byTable.authority_role_bindings.disposition, 'candidate_evidence');
assert.deepStrictEqual(byTable.teachers.admittedColumns, ['id']);
assert.deepStrictEqual(byTable.students.admittedColumns, ['id']);
assert.strictEqual(byTable.teachers.disposition, 'profile_reference_only');
assert.strictEqual(byTable.students.disposition, 'profile_reference_only');
assert.strictEqual(byTable.desktop_device_authorizations.disposition, 'archived_reauthentication_required');
assert.ok(!byTable.desktop_device_authorizations.admittedColumns.includes('source_challenge_id'));
assert.strictEqual(byTable.desktop_identity_challenges.disposition, 'intentionally_excluded');
assert.deepStrictEqual(byTable.desktop_identity_challenges.deniedColumns, ['challenge_token_hash', 'device_id', 'expires_at', 'id', 'short_code', 'status']);
assert.strictEqual(byTable.desktop_device_session_challenges.disposition, 'intentionally_excluded');
assert.strictEqual(byTable.desktop_sessions.disposition, 'archived_inert_session_evidence');
assert.ok(!byTable.desktop_sessions.admittedColumns.includes('sid'));
assert.strictEqual(byTable.authorization_audit_log.disposition, 'candidate_audit_evidence');
assert.ok(!byTable.authorization_audit_log.admittedColumns.includes('actor_phone'));
assert.ok(!byTable.authorization_audit_log.admittedColumns.includes('before_json'));
assert.ok(!byTable.authorization_audit_log.admittedColumns.includes('after_json'));
assert.strictEqual(byTable.miniapp_login_events.disposition, 'candidate_identity_event_evidence');
assert.ok(!byTable.miniapp_login_events.admittedColumns.includes('phone_normalized'));
assert.strictEqual(byTable.questions.disposition, 'intentionally_excluded');
assert.strictEqual(byTable.deceptive_device_sessions.disposition, 'intentionally_excluded');
assert.deepStrictEqual(byTable.authority_accounts.admittedColumns, ['authority_id', 'created_at', 'status', 'updated_at', 'user_id']);
assert.strictEqual(byTable.host_commands.disposition, 'intentionally_excluded');
assert.ok(byTable.host_commands.deniedColumns.includes('target_host_id'));
assert.strictEqual(byTable.sync_authorizations.disposition, 'intentionally_excluded');
assert.ok(byTable.sync_authorizations.deniedColumns.includes('token_hash'));
assert.strictEqual(byTable.constructor.disposition, 'intentionally_excluded');
assert.strictEqual(byTable.toString.disposition, 'intentionally_excluded');
assert.strictEqual(byTable.__proto__.disposition, 'intentionally_excluded');
for (const entry of catalog.tables) {
  const sourceColumns = inventory.tables[entry.tableName].columns.map(column => column.name).sort();
  assert.deepStrictEqual([...new Set([...entry.admittedColumns, ...entry.deniedColumns])].sort(), sourceColumns);
  assert.strictEqual(entry.admittedColumns.some(column => entry.deniedColumns.includes(column)), false);
  assert.ok(Object.isFrozen(entry.admittedColumns));
  assert.ok(Object.isFrozen(entry.deniedColumns));
}

const drift = buildControlPlaneMigrationCatalog({
  inventory: { tables: { users: table(['id', 'status', 'identity_kind']) } },
});
assert.strictEqual(drift.tables[0].disposition, 'unresolved_schema_drift');
assert.ok(drift.tables[0].missingRequiredColumns.includes('auth_version'));
assert.ok(Object.isFrozen(drift.tables[0].missingRequiredColumns));

assert.throws(
  () => buildControlPlaneMigrationCatalog({ inventory: { tables: { users: { columns: [{ name: 'id' }, { name: 42 }] } } } }),
  error => error && error.code === 'CONTROL_PLANE_CATALOG_INVENTORY_INVALID',
);

const repeat = buildControlPlaneMigrationCatalog({ inventory });
assert.deepStrictEqual(repeat, catalog, 'catalog output must be deterministic and contain only schema metadata');
const shuffled = {
  tables: Object.fromEntries(Object.entries(inventory.tables).reverse().map(([name, value]) => [name, {
    columns: [...value.columns].reverse(), rows: [{ secret_payload: 'must-not-appear' }],
  }])),
};
assert.deepStrictEqual(buildControlPlaneMigrationCatalog({ inventory: shuffled }), catalog);
assert.ok(!JSON.stringify(catalog).includes('must-not-appear'));

console.log('control-plane migration catalog checks passed');
