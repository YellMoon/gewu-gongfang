'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { Client } = require('pg');
const { loadSourceTableCatalog, validateSourceTableCatalog } = require('../migration/vnext/sourceTableCatalog');
const sourceInventory = require('../migration/vnext/fixtures/phase1-authority-schema.json');
const { loadMigrations, validateSchemaContract } = require('../cloud-vnext/schemaContract');
const { createVnextPool } = require('../cloud-vnext/src/db');
const { importShadowBundle } = require('../cloud-vnext/src/migration/shadowImporter');
const { createSealedBundleFromSnapshot } = require('./vnext-migration/sealedSnapshotExport');
const { loadExternalMigrationKeys } = require('./vnext-migration/migrationKeyMaterial');
const { verifySqliteSnapshot } = require('./vnext-migration/sqliteSnapshot');

function requiredEnvironment(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function sourceDispositionCounts(snapshotPath, catalog) {
  const db = new Database(snapshotPath, { readonly: true, fileMustExist: true });
  try {
    const counts = {};
    for (const entry of catalog.tables) {
      const quoted = `"${entry.sourceTable.replace(/"/g, '""')}"`;
      const count = Number(db.prepare(`select count(*) as count from ${quoted}`).get().count);
      counts[entry.disposition] = (counts[entry.disposition] || 0) + count;
    }
    return counts;
  } finally {
    db.close();
  }
}

async function run() {
  const snapshotPath = path.resolve(requiredEnvironment('VNEXT_REAL_SNAPSHOT_PATH'));
  const bundlePath = path.resolve(requiredEnvironment('VNEXT_REAL_BUNDLE_PATH'));
  const expectedSnapshotHash = requiredEnvironment('VNEXT_REAL_SNAPSHOT_HASH');
  const setupConnectionString = requiredEnvironment('VNEXT_POSTGRES_SETUP_URL');
  const migratorConnectionString = requiredEnvironment('VNEXT_POSTGRES_TEST_URL');
  const database = requiredEnvironment('VNEXT_POSTGRES_TEST_DATABASE');
  const keyDirectory = path.resolve(requiredEnvironment('VNEXT_MIGRATION_KEY_DIRECTORY'));
  if (!/^gewu_vnext_shadow_real_[a-z0-9_]+$/.test(database)) throw new Error('VNEXT_REAL_SHADOW_DATABASE_INVALID');
  if (fs.existsSync(bundlePath) || fs.existsSync(`${bundlePath}.partial`)) throw new Error('VNEXT_REAL_BUNDLE_TARGET_EXISTS');

  const verifiedSnapshot = verifySqliteSnapshot({ snapshotPath, expectedSnapshotHash });
  assert.strictEqual(verifiedSnapshot.tableCount, 99);
  assert.strictEqual(verifiedSnapshot.tableRowCount, 93);
  const catalog = loadSourceTableCatalog(path.join(__dirname, '..', 'migration', 'vnext', 'source-table-catalog.json'));
  const catalogHash = validateSourceTableCatalog({ inventory: sourceInventory, catalog }).catalogHash;
  const migrations = loadMigrations(path.join(__dirname, '..', 'cloud-vnext', 'migrations'));
  const schemaContractHash = validateSchemaContract(migrations).contractHash;
  const sourceCounts = sourceDispositionCounts(snapshotPath, catalog);
  assert.strictEqual(Object.values(sourceCounts).reduce((sum, value) => sum + value, 0), verifiedSnapshot.tableRowCount);

  const setup = new Client({ connectionString: setupConnectionString, application_name: 'gewu-vnext-real-shadow-setup' });
  await setup.connect();
  try {
    const identity = await setup.query("select current_database() as database, current_setting('server_version_num') as version_num");
    assert.strictEqual(identity.rows[0].database, database);
    assert.strictEqual(Math.floor(Number(identity.rows[0].version_num) / 10000), 17);
    const existing = await setup.query("select count(*)::integer as count from information_schema.schemata where schema_name='migration'");
    assert.strictEqual(existing.rows[0].count, 0, 'real shadow database must begin empty');
    for (const migration of migrations) await setup.query(migration.sql);
  } finally {
    await setup.end();
  }

  const { publicKey, privateKey, encryptionKey, publicKeyFingerprint } = loadExternalMigrationKeys({
    keyDirectory, repositoryRoot: path.join(__dirname, '..'),
  });
  const bundle = createSealedBundleFromSnapshot({
    snapshotPath, bundlePath, catalog, catalogHash, environment: 'shadow',
    bundleId: `real-shadow-${expectedSnapshotHash.slice(0, 16)}`,
    sourceSnapshotHash: expectedSnapshotHash,
    sourceInventoryHash: verifiedSnapshot.inventoryHash,
    signingPrivateKey: privateKey,
    encryptionKey,
  });
  assert.strictEqual(bundle.totalRows, verifiedSnapshot.tableRowCount);

  const pool = createVnextPool({ connectionString: migratorConnectionString, applicationName: 'gewu-vnext-real-shadow-import' });
  try {
    const executionIdentity = await pool.query('select current_user as current_user, rolsuper from pg_roles where rolname=current_user');
    assert.deepStrictEqual(executionIdentity.rows[0], { current_user: 'gewu_vnext_migrator', rolsuper: false });
    const options = {
      pool, bundlePath, signingPublicKey: publicKey, encryptionKey,
      allowedPublicKeyFingerprints: [publicKeyFingerprint], expectedEnvironment: 'shadow',
      authorityId: 'real-shadow-authority-20260813', expectedSchemaContractHash: schemaContractHash,
    };
    const first = await importShadowBundle(options);
    const second = await importShadowBundle(options);
    assert.strictEqual(first.ledgerInserted, verifiedSnapshot.tableRowCount);
    assert.strictEqual(second.noop, verifiedSnapshot.tableRowCount);
    assert.strictEqual(second.ledgerInserted, 0);
    const verified = await pool.query(`select
      (select count(*)::integer from migration.record_ledger where migration_batch_id=$1) as ledger,
      (select count(*)::integer from migration.preserved_records where migration_batch_id=$1) as preserved,
      (select count(*)::integer from migration.quarantine_records where migration_batch_id=$1) as quarantined,
      (select count(*)::integer from identity.accounts) as active_accounts,
      (select count(*)::integer from access.account_roles) as active_roles,
      (select count(*)::integer from identity.legacy_account_evidence) as legacy_accounts,
      (select count(*)::integer from access.legacy_role_evidence) as legacy_roles`, [first.batchId]);
    assert.strictEqual(verified.rows[0].ledger, verifiedSnapshot.tableRowCount);
    assert.strictEqual(verified.rows[0].active_accounts, 0);
    assert.strictEqual(verified.rows[0].active_roles, 0);
    assert.strictEqual(verified.rows[0].quarantined, first.quarantined);
    console.log(JSON.stringify({
      postgresMajor: 17,
      database,
      snapshotHash: expectedSnapshotHash,
      snapshotInventoryHash: verifiedSnapshot.inventoryHash,
      schemaContractHash,
      catalogHash,
      sourceTableCount: verifiedSnapshot.tableCount,
      sourceRowCount: verifiedSnapshot.tableRowCount,
      sourceDispositionCounts: sourceCounts,
      bundleHash: bundle.bundleHash,
      publicKeyFingerprint,
      encryptedPayloadCount: bundle.encryptedFileCount,
      first,
      second,
      databaseCounts: verified.rows[0],
      signerAndEncryptionKeysPersistedOutsideRepository: true,
    }));
  } finally {
    await pool.end();
  }
}

run().catch(error => {
  console.error(error && (error.stack || error.message) || error);
  process.exitCode = 1;
});
