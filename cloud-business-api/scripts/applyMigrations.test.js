'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  readMigrationFiles,
  applyMigrationPlan,
  databaseConfigFromEnvironment,
} = require('./applyMigrations');

(async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-cloud-migrations-'));
  try {
    fs.writeFileSync(path.join(tempRoot, '20260823-b.sql'), 'SELECT 2;\n', 'utf8');
    fs.writeFileSync(path.join(tempRoot, '20260822-a.sql'), 'SELECT 1;\n', 'utf8');
    fs.writeFileSync(path.join(tempRoot, '20260823-b.test.js'), 'ignored', 'utf8');
    const migrations = readMigrationFiles({ sqlDir: tempRoot });
    assert.deepStrictEqual(migrations.map(item => item.name), ['20260822-a.sql', '20260823-b.sql']);
    assert.match(migrations[0].sha256, /^[0-9a-f]{64}$/);

    const applied = new Map();
    const calls = [];
    await applyMigrationPlan({
      migrations,
      readApplied: async name => applied.get(name) || null,
      executeSql: async migration => calls.push(migration.name),
      recordApplied: async migration => applied.set(migration.name, migration.sha256),
    });
    assert.deepStrictEqual(calls, ['20260822-a.sql', '20260823-b.sql']);

    calls.length = 0;
    await applyMigrationPlan({
      migrations,
      readApplied: async name => applied.get(name) || null,
      executeSql: async migration => calls.push(migration.name),
      recordApplied: async migration => applied.set(migration.name, migration.sha256),
    });
    assert.deepStrictEqual(calls, [], 'an already recorded migration must not run again');

    await assert.rejects(
      () => applyMigrationPlan({
        migrations: [{ ...migrations[0], sha256: '0'.repeat(64) }],
        readApplied: async name => applied.get(name) || null,
        executeSql: async () => { throw new Error('must not execute'); },
        recordApplied: async () => { throw new Error('must not record'); },
      }),
      /CLOUD_MIGRATION_HASH_MISMATCH/,
    );

    assert.throws(
      () => databaseConfigFromEnvironment({ POSTGRES_HOST: 'db', POSTGRES_DB: 'gewu', POSTGRES_MIGRATOR_USER: 'migrator' }),
      /CLOUD_MIGRATION_CONFIG_INVALID/,
    );
    assert.deepStrictEqual(databaseConfigFromEnvironment({
      POSTGRES_HOST: 'db', POSTGRES_PORT: '5433', POSTGRES_DB: 'gewu',
      POSTGRES_MIGRATOR_USER: 'migrator', POSTGRES_MIGRATOR_PASSWORD: 'secret',
    }), {
      host: 'db', port: 5433, database: 'gewu', user: 'migrator', password: 'secret', max: 1,
    });
    console.log('cloud migration runner checks passed');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
