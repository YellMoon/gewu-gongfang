'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createDisposablePg17Runtime,withVNextPg17SyntheticQuery} = require('../shared/vnext-pg17/disposableRuntime');
async function main() {
  const runtime=createDisposablePg17Runtime(); await runtime.start();
  const handle=await runtime.createIsolatedHandle();
  const sql=fs.readFileSync(path.join(__dirname,'cloud_postgres_security_fingerprint.sql'),'utf8');
  try {
    await withVNextPg17SyntheticQuery(handle,'fixture-provisioner',async db=>{
      await db.query('CREATE SCHEMA business');
      await db.query('CREATE TABLE business.backup_probe(id text)');
      await db.query("CREATE FUNCTION business.backup_probe() RETURNS int LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS 'SELECT 1'");
      const fingerprint=async()=> (await db.query(sql)).rows[0].md5;
      const base=await fingerprint(); assert.match(base,/^[a-f0-9]{32}$/);
      await db.query('GRANT SELECT ON business.backup_probe TO vnext_pg17_writer');
      assert.notEqual(await fingerprint(),base,'missing restored table privileges must fail verification');
      await db.query('REVOKE SELECT ON business.backup_probe FROM vnext_pg17_writer');
      assert.equal(await fingerprint(),base,'equivalent ACL order/defaults must normalize');
      await db.query('ALTER FUNCTION business.backup_probe() SECURITY INVOKER');
      assert.notEqual(await fingerprint(),base,'security-definer changes must fail');
      await db.query('ALTER FUNCTION business.backup_probe() SECURITY DEFINER');
      assert.equal(await fingerprint(),base);
      await db.query('ALTER FUNCTION business.backup_probe() SET search_path=business');
      assert.notEqual(await fingerprint(),base,'changed function search path must fail');
    });
    console.log('backup security fingerprint PostgreSQL fault checks passed');
  } finally {await runtime.disposeHandle(handle);await runtime.stop();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
