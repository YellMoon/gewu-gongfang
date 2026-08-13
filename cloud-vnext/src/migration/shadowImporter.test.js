'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Client } = require('pg');
const { canonicalJson } = require('../../../shared/migrationBundleProtocol');
const { canonicalSourceRow, hashCanonicalRecord } = require('../../../migration/vnext/canonicalTypes');
const { loadSourceTableCatalog, validateSourceTableCatalog } = require('../../../migration/vnext/sourceTableCatalog');
const sourceInventory = require('../../../migration/vnext/fixtures/phase1-authority-schema.json');
const { createSealedMigrationBundle, fingerprintPublicKey } = require('../../../scripts/vnext-migration/sealedMigrationBundle');
const { loadMigrations, validateSchemaContract } = require('../../schemaContract');
const { createVnextPool } = require('../db');
const { importShadowBundle } = require('./shadowImporter');

function canonicalRecord({ sourceTable, target, transformerId, record, sourceRecordKey }) {
  const typed = canonicalSourceRow(record, Object.keys(record));
  return {
    sourceTable,
    sourceRecordKey: canonicalJson(canonicalSourceRow(sourceRecordKey, Object.keys(sourceRecordKey))),
    target,
    transformerId,
    recordHash: hashCanonicalRecord(typed),
    record: typed,
  };
}

async function run() {
  const connectionString = String(process.env.VNEXT_POSTGRES_TEST_URL || '').trim();
  const expectedDatabase = String(process.env.VNEXT_POSTGRES_TEST_DATABASE || '').trim();
  if (!/^gewu_vnext_shadow_[a-z0-9_]+$/.test(expectedDatabase)) throw new Error('VNEXT_POSTGRES_TEST_DATABASE_INVALID');
  const migrations = loadMigrations(path.join(__dirname, '..', '..', 'migrations'));
  const schemaContractHash = validateSchemaContract(migrations).contractHash;
  const catalog = loadSourceTableCatalog(path.join(__dirname, '..', '..', '..', 'migration', 'vnext', 'source-table-catalog.json'));
  const catalogHash = validateSourceTableCatalog({ inventory: sourceInventory, catalog }).catalogHash;

  const setup = new Client({ connectionString });
  await setup.connect();
  try {
    const identity = await setup.query("select current_database() as database, current_setting('server_version_num') as version_num");
    assert.strictEqual(identity.rows[0].database, expectedDatabase);
    assert.strictEqual(Math.floor(Number(identity.rows[0].version_num) / 10000), 17);
    const schemas = await setup.query("select count(*)::integer as count from information_schema.schemata where schema_name='migration'");
    assert.strictEqual(schemas.rows[0].count, 0);
    for (const migration of migrations) await setup.query(migration.sql);
  } finally {
    await setup.end();
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-shadow-import-'));
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const fingerprint = fingerprintPublicKey(publicKey);
  const encryptionKey = crypto.randomBytes(32);
  const common = {
    environment: 'shadow', sourceSnapshotHash: 'a'.repeat(64), sourceInventoryHash: 'b'.repeat(64),
    catalogHash, signingPrivateKey: privateKey, encryptionKey,
  };
  const records = [
    canonicalRecord({
      sourceTable: 'tenants', target: 'identity.tenants', transformerId: 'identity.tenant',
      sourceRecordKey: { id: 'tenant-1' },
      record: { id: 'tenant-1', name: 'Shadow Tenant', status: 'active', created_at: '2026-08-13T00:00:00.000Z', updated_at: '2026-08-13T00:00:00.000Z' },
    }),
    canonicalRecord({
      sourceTable: 'users', target: 'identity.legacy_account_evidence', transformerId: 'identity.legacy-user-evidence',
      sourceRecordKey: { id: 'user-1' },
      record: { id: 'user-1', name: 'Legacy User', role: 'super_admin', is_super_admin_identity: 1n, created_at: '2026-08-13T00:00:00.000Z' },
    }),
    canonicalRecord({
      sourceTable: 'user_role_grants', target: 'access.legacy_role_evidence', transformerId: 'access.legacy-role-evidence',
      sourceRecordKey: { user_id: 'user-1', role: 'super_admin' },
      record: { user_id: 'user-1', role: 'super_admin', status: 'active', created_at: '2026-08-13T00:00:00.000Z' },
    }),
  ];
  const preservedRecords = [
    canonicalRecord({
      sourceTable: 'desktop_sessions', target: null, transformerId: null,
      sourceRecordKey: { sid: 'session-1' }, record: { sid: 'session-1', token: 'inactive-secret' },
    }),
    canonicalRecord({
      sourceTable: 'sync_conflicts', target: null, transformerId: null,
      sourceRecordKey: { id: 'conflict-1' }, record: { id: 'conflict-1', payload: 'offline-pending-review' },
    }),
  ];
  preservedRecords[0].disposition = 'archive';
  preservedRecords[1].disposition = 'local_partition';
  delete preservedRecords[0].target;
  delete preservedRecords[0].transformerId;
  delete preservedRecords[1].target;
  delete preservedRecords[1].transformerId;
  const firstBundle = path.join(root, 'bundle-one');
  createSealedMigrationBundle({ ...common, bundlePath: firstBundle, bundleId: 'shadow-import-one',
    payloads: [
      { relativePath: 'business/canonical.ndjson', classification: 'business', records },
      { relativePath: 'archive/desktop_sessions.ndjson', classification: 'archive', records: [preservedRecords[0]] },
      { relativePath: 'offline/sync_conflicts.ndjson', classification: 'offline', records: [preservedRecords[1]] },
    ] });

  const pool = createVnextPool({ connectionString, applicationName: 'gewu-vnext-shadow-import-test' });
  try {
    const options = {
      pool, bundlePath: firstBundle, signingPublicKey: publicKey, allowedPublicKeyFingerprints: [fingerprint],
      encryptionKey, expectedEnvironment: 'shadow', authorityId: 'shadow-authority-20260813',
      expectedSchemaContractHash: schemaContractHash,
    };
    const first = await importShadowBundle(options);
    assert.deepStrictEqual({ inserted: first.inserted, noop: first.noop, quarantined: first.quarantined, ledgerInserted: first.ledgerInserted },
      { inserted: 3, noop: 0, quarantined: 0, ledgerInserted: 5 });
    const second = await importShadowBundle(options);
    assert.deepStrictEqual({ inserted: second.inserted, noop: second.noop, quarantined: second.quarantined, ledgerInserted: second.ledgerInserted },
      { inserted: 0, noop: 5, quarantined: 0, ledgerInserted: 0 });

    const state = await pool.query(`select
      (select count(*)::integer from identity.tenants) as tenants,
      (select count(*)::integer from identity.legacy_account_evidence) as legacy_accounts,
      (select count(*)::integer from access.legacy_role_evidence) as legacy_roles,
      (select count(*)::integer from identity.accounts) as active_accounts,
      (select count(*)::integer from access.account_roles) as active_roles,
      (select count(*)::integer from migration.record_ledger) as ledger,
      (select count(*)::integer from migration.preserved_records) as preserved`);
    assert.deepStrictEqual(state.rows[0], { tenants: 1, legacy_accounts: 1, legacy_roles: 1, active_accounts: 0, active_roles: 0, ledger: 5, preserved: 2 });
    const preservedClasses = await pool.query('select preservation_class from migration.preserved_records order by preservation_class');
    assert.deepStrictEqual(preservedClasses.rows.map(row => row.preservation_class), ['archive', 'local_partition']);
    const evidence = await pool.query("select review_status from identity.legacy_account_evidence where id='user-1'");
    assert.strictEqual(evidence.rows[0].review_status, 'pending_review');

    const conflict = canonicalRecord({
      sourceTable: 'tenants', target: 'identity.tenants', transformerId: 'identity.tenant',
      sourceRecordKey: { id: 'tenant-conflicting-source' },
      record: { id: 'tenant-1', name: 'Conflicting Tenant', status: 'active', created_at: '2026-08-13T00:00:00.000Z', updated_at: '2026-08-13T00:00:00.000Z' },
    });
    const conflictBundle = path.join(root, 'bundle-conflict');
    createSealedMigrationBundle({ ...common, bundlePath: conflictBundle, bundleId: 'shadow-import-conflict',
      payloads: [{ relativePath: 'business/conflict.ndjson', classification: 'business', records: [conflict] }] });
    const conflicted = await importShadowBundle({ ...options, bundlePath: conflictBundle });
    assert.strictEqual(conflicted.quarantined, 1);
    const conflictState = await pool.query(`select
      (select name from identity.tenants where id='tenant-1') as tenant_name,
      (select count(*)::integer from migration.quarantine_records) as quarantines`);
    assert.deepStrictEqual(conflictState.rows[0], { tenant_name: 'Shadow Tenant', quarantines: 1 });

    const tampered = structuredClone(records[0]);
    tampered.record.name = { type: 'text', value: 'Tampered without hash' };
    const tamperedBundle = path.join(root, 'bundle-tampered-record');
    createSealedMigrationBundle({ ...common, bundlePath: tamperedBundle, bundleId: 'shadow-import-tampered-record',
      payloads: [{ relativePath: 'business/tampered.ndjson', classification: 'business', records: [tampered] }] });
    await assert.rejects(
      importShadowBundle({ ...options, bundlePath: tamperedBundle }),
      error => error && error.code === 'VNEXT_IMPORT_RECORD_HASH_MISMATCH',
    );

    console.log(JSON.stringify({ first, second, conflict: conflicted, activeAccounts: 0, activeRoles: 0 }));
  } finally {
    await pool.end();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run().catch(error => {
  console.error(error && (error.stack || error.message) || error);
  process.exitCode = 1;
});
