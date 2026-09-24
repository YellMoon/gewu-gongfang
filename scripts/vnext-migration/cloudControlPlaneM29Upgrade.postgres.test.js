'use strict';
// UTF-8: execute the actual generated upgrade in a disposable PostgreSQL cluster.
const assert = require('node:assert/strict');
const { createDisposablePg17Runtime, withVNextPg17SyntheticQuery } = require('../../shared/vnext-pg17/disposableRuntime');
const { MIGRATIONS } = require('../../shared/vnext-pg17/migrationManifest');
const { buildCloudControlPlaneM29UpgradeSql } = require('./cloudControlPlaneM29Upgrade');
const { buildCloudControlPlaneM29StateSql } = require('./cloudControlPlaneM29State');

async function main() {
  const runtime = createDisposablePg17Runtime();
  await runtime.start();
  let handle;
  try {
    handle = await runtime.createIsolatedHandle();
    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async db => {
      await db.query('CREATE ROLE gewu_app NOLOGIN NOINHERIT');
      await db.query('BEGIN');
      await db.query('SET LOCAL ROLE vnext_pg17_owner');
      for (const migration of MIGRATIONS.slice(0, 28)) {
        await db.query(migration.sql);
        if (migration.postApply) await db.query(migration.postApply.text, migration.postApply.values(new Date().toISOString()));
        await db.query('INSERT INTO vnext_control_plane.vnext_schema_migrations(migration_id,semantic_version,manifest_sha256,applied_at,applied_by) VALUES($1,$2,$3,now(),$4)', [migration.migrationId, migration.semanticVersion, migration.manifestSha256, 'm29-upgrade-test']);
      }
      await db.query('COMMIT');
      const readState = async () => JSON.parse((await db.query(buildCloudControlPlaneM29StateSql())).rows[0].state);
      assert.deepEqual(await readState(), { ledgerCount: 28, prefixValid: true, targetCount: 0, columnCount: 0, functionCount: 0, metadataValid: false });
      const sql = buildCloudControlPlaneM29UpgradeSql().sql.replace(/^\\set ON_ERROR_STOP on\n/, '');
      const wrongPrefixSql = sql.replace(MIGRATIONS[27].manifestSha256, 'f'.repeat(64));
      await assert.rejects(db.query(wrongPrefixSql), /VNEXT_CLOUD_CONTROL_PLANE_M28_PREFIX_INVALID/);
      await db.query('ROLLBACK');
      assert.equal((await readState()).columnCount, 0, 'bad prefix cannot partially add the column');
      await db.query(sql);
      assert.deepEqual(await readState(), { ledgerCount: 29, prefixValid: true, targetCount: 1, columnCount: 1, functionCount: 2, metadataValid: true });
      assert.equal((await db.query("SELECT pg_has_role('gewu_app','vnext_pg17_owner','MEMBER') AS member")).rows[0].member, false);
      await db.query('GRANT EXECUTE ON FUNCTION vnext_control_plane.vnext_list_named_desktop_account_devices(text,text) TO PUBLIC');
      assert.equal((await readState()).metadataValid, false, 'gate rejects an unauthorized execute grant');
      await db.query('REVOKE EXECUTE ON FUNCTION vnext_control_plane.vnext_list_named_desktop_account_devices(text,text) FROM PUBLIC');
      assert.equal((await readState()).metadataValid, true);
    });
    console.log('M28 to M29 actual PostgreSQL upgrade and drift rejection checks passed');
  } finally {
    if (handle) await runtime.disposeHandle(handle);
    await runtime.stop();
  }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = main;
