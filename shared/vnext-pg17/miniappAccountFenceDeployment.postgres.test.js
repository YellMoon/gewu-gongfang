'use strict';
const assert = require('node:assert/strict');
const { createDisposablePg17Runtime, withVNextPg17SyntheticQuery: withQ } = require('./disposableRuntime');
const { MIGRATIONS } = require('./migrationManifest');
const { buildCloudControlPlaneM30UpgradeSql } = require('../../scripts/vnext-migration/cloudControlPlaneM30Upgrade');
const { buildCloudControlPlaneM30StateSql } = require('../../scripts/vnext-migration/cloudControlPlaneM30State');
const { buildCloudControlPlaneM29StateSql } = require('../../scripts/vnext-migration/cloudControlPlaneM29State');
(async () => {
  const rt = createDisposablePg17Runtime(); let h;
  try {
    await rt.start(); h = await rt.createIsolatedHandle();
    await withQ(h, 'fixture-provisioner', async q => {
      await q.query('CREATE ROLE gewu_app');
      await q.query('BEGIN; SET LOCAL ROLE vnext_pg17_owner');
      for (const m of MIGRATIONS.slice(0, 29)) {
        await q.query(m.sql);
        await q.query('INSERT INTO vnext_control_plane.vnext_schema_migrations(migration_id,semantic_version,manifest_sha256,applied_at,applied_by) VALUES($1,$2,$3,now(),$4)', [m.migrationId,m.semanticVersion,m.manifestSha256,'M29-upgrade-fixture']);
      }
      await q.query('COMMIT');
      const state = async () => JSON.parse((await q.query(buildCloudControlPlaneM30StateSql())).rows[0].state);
      assert.deepEqual(await state(), { ledgerCount: 29, prefixValid: true, targetCount: 0, functionCount: 0, metadataValid: false });
      const sql = buildCloudControlPlaneM30UpgradeSql().sql.replace(/^\\set ON_ERROR_STOP on\n/u, '');
      await q.query(sql);
      assert.deepEqual(await state(), { ledgerCount: 30, prefixValid: true, targetCount: 1, functionCount: 1, metadataValid: true });
      const prior = JSON.parse((await q.query(buildCloudControlPlaneM29StateSql())).rows[0].state);
      assert(prior.metadataValid && prior.prefixValid && prior.targetCount === 1, 'M29 gate must accept the intact prefix after M30');
      await assert.rejects(() => q.query(sql), error => error.code === 'P0001' && /M29_PREFIX_INVALID/.test(error.message));
      await q.query('ROLLBACK');
      assert.equal((await q.query("SELECT pg_has_role('gewu_app','vnext_pg17_owner','MEMBER') AS member")).rows[0].member, false);
      await q.query('GRANT EXECUTE ON FUNCTION vnext_control_plane.vnext_read_miniapp_account_fence(text,text) TO PUBLIC');
      assert.equal((await state()).metadataValid, false, 'public EXECUTE drift must fail the deployment gate');
    });
    console.log('M30 PG17 deployment: exact M29 prefix, atomic upgrade, M29 forward compatibility, retry refusal, owner revocation and public ACL drift passed');
  } finally { if (h) await rt.disposeHandle(h).catch(() => {}); await rt.stop().catch(() => {}); }
})().catch(error => { console.error(error); process.exitCode = 1; });
