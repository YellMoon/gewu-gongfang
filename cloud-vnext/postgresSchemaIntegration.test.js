'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { loadMigrations } = require('./schemaContract');

function expectedFailure(error, sqlState) {
  return Boolean(error && error.code === sqlState);
}

async function run() {
  const connectionString = String(process.env.VNEXT_POSTGRES_TEST_URL || '').trim();
  if (!connectionString) throw new Error('VNEXT_POSTGRES_TEST_URL_REQUIRED');
  const expectedDatabase = String(process.env.VNEXT_POSTGRES_TEST_DATABASE || '').trim();
  if (!/^gewu_vnext_(?:schema|shadow)_[a-z0-9_]+$/.test(expectedDatabase)) {
    throw new Error('VNEXT_POSTGRES_TEST_DATABASE_INVALID');
  }

  const client = new Client({ connectionString, application_name: 'gewu-vnext-schema-integration' });
  await client.connect();
  try {
    const identity = await client.query('select current_database() as database, current_setting(\'server_version_num\') as version_num');
    assert.strictEqual(identity.rows[0].database, expectedDatabase);
    assert.strictEqual(Math.floor(Number(identity.rows[0].version_num) / 10000), 17);

    const before = await client.query(`select count(*)::integer as count from information_schema.schemata
      where schema_name = any($1::text[])`, [['identity', 'access', 'business', 'question', 'storage', 'audit', 'migration']]);
    assert.strictEqual(before.rows[0].count, 0, 'integration database must begin without vNext schemas');

    for (const migration of loadMigrations(path.join(__dirname, 'migrations'))) {
      await client.query(migration.sql);
    }

    const tableCount = await client.query(`select count(*)::integer as count from information_schema.tables
      where table_schema = any($1::text[])`, [['identity', 'access', 'business', 'question', 'storage', 'audit', 'migration']]);
    assert.ok(tableCount.rows[0].count >= 80);

    const missingIndexes = await client.query(`
      select c.conrelid::regclass::text as table_name, c.conname
      from pg_constraint c
      where c.contype = 'f'
        and c.connamespace in (select oid from pg_namespace where nspname = any($1::text[]))
        and not exists (
          select 1 from pg_index i
          where i.indrelid = c.conrelid and i.indisvalid and i.indpred is null
            and (i.indkey::smallint[])[0:cardinality(c.conkey)-1] @> c.conkey
        )
      order by 1, 2`, [['identity', 'access', 'business', 'question', 'storage', 'audit', 'migration']]);
    assert.deepStrictEqual(missingIndexes.rows, []);

    const privileges = await client.query(`select
      has_schema_privilege('gewu_vnext_runtime', 'migration', 'usage') as runtime_migration_usage,
      has_table_privilege('gewu_vnext_runtime', 'business.students', 'delete') as runtime_delete,
      has_table_privilege('gewu_vnext_runtime', 'migration.record_ledger', 'select') as runtime_ledger_read,
      has_table_privilege('gewu_vnext_auditor', 'audit.authorization_events', 'select') as auditor_read,
      (select not rolcanlogin and not rolsuper from pg_roles where rolname = 'gewu_vnext_runtime') as runtime_safe_role`);
    assert.deepStrictEqual(privileges.rows[0], {
      runtime_migration_usage: false,
      runtime_delete: false,
      runtime_ledger_read: false,
      auditor_read: true,
      runtime_safe_role: true,
    });

    await client.query(`insert into identity.tenants(id,name,status,created_at,updated_at)
      values ('integration-tenant','integration','active',now(),now())`);

    await assert.rejects(
      client.query(`insert into storage.file_objects(id,tenant_id,logical_kind,logical_name,created_at)
        values ('integration-file','integration-tenant','test','file',now());
        insert into storage.file_versions(id,file_object_id,version_number,sha256,byte_size,status,created_at)
        values ('integration-version','integration-file',1,repeat('a',64),1,'verified',now())`),
      error => expectedFailure(error, '23514'),
    );

    await client.query(`insert into audit.authorization_events(
      id,tenant_id,capability_key,scope_snapshot,decision,reason_code,policy_version,correlation_id,occurred_at
    ) values ('integration-audit','integration-tenant','test', '{}'::jsonb,'deny','test','v1','integration',now())`);
    await assert.rejects(
      client.query("update audit.authorization_events set reason_code = 'changed' where id = 'integration-audit'"),
      error => expectedFailure(error, '55000'),
    );

    await client.query(`insert into identity.accounts(id,tenant_id,status,row_version,created_at,updated_at)
      values ('integration-account','integration-tenant','active',1,now(),now());
      insert into access.devices(id,tenant_id,device_class,risk_status,created_at)
      values ('integration-device','integration-tenant','desktop','trusted',now());
      insert into access.installations(id,device_id,public_key,key_fingerprint,clone_status,created_at)
      values ('integration-installation','integration-device',decode('00','hex'),'fingerprint','clear',now())`);
    await assert.rejects(
      client.query(`insert into access.account_device_links(
        id,account_id,installation_id,status,activated_at
      ) values ('integration-link','integration-account','integration-installation','active',now())`),
      error => expectedFailure(error, '23514'),
    );

    const dependencyOrder = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'migration', 'vnext', 'source-table-catalog.json'), 'utf8'));
    const enrollment = dependencyOrder.canonical.find(entry => entry.sourceTable === 'enrollments');
    const schedule = dependencyOrder.canonical.find(entry => entry.sourceTable === 'schedules');
    assert.ok(enrollment.dependencyOrder > schedule.dependencyOrder);

    console.log(JSON.stringify({
      postgresMajor: 17,
      database: expectedDatabase,
      tableCount: tableCount.rows[0].count,
      missingForeignKeyIndexes: missingIndexes.rowCount,
      rejectedUnverifiedFile: true,
      rejectedMutableAudit: true,
      rejectedUnprovenActivation: true,
    }));
  } finally {
    await client.end();
  }
}

run().catch(error => {
  console.error(error && (error.stack || error.message) || error);
  process.exitCode = 1;
});
