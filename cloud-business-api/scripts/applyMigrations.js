'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MIGRATION_FILE = /^\d{8}-[a-z0-9][a-z0-9-]*\.sql$/;

function failure(code) {
  return Object.assign(new Error(code), { code });
}

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function readMigrationFiles({ sqlDir }) {
  if (typeof sqlDir !== 'string' || !path.isAbsolute(sqlDir)) throw failure('CLOUD_MIGRATION_CONFIG_INVALID');
  return fs.readdirSync(sqlDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && MIGRATION_FILE.test(entry.name))
    .map(entry => {
      const filePath = path.join(sqlDir, entry.name);
      const sql = fs.readFileSync(filePath, 'utf8');
      return Object.freeze({ name: entry.name, sql, sha256: sha256(sql) });
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

async function applyMigrationPlan({ migrations, readApplied, executeSql, recordApplied }) {
  if (!Array.isArray(migrations) || typeof readApplied !== 'function' || typeof executeSql !== 'function' || typeof recordApplied !== 'function') {
    throw failure('CLOUD_MIGRATION_CONFIG_INVALID');
  }
  const result = { applied: [], skipped: [] };
  for (const migration of migrations) {
    if (!migration || typeof migration.name !== 'string' || typeof migration.sql !== 'string' || !/^[0-9a-f]{64}$/.test(migration.sha256 || '')) {
      throw failure('CLOUD_MIGRATION_CONFIG_INVALID');
    }
    const existing = await readApplied(migration.name);
    if (existing !== null) {
      if (existing !== migration.sha256) throw failure('CLOUD_MIGRATION_HASH_MISMATCH');
      result.skipped.push(migration.name);
      continue;
    }
    await executeSql(migration);
    await recordApplied(migration);
    result.applied.push(migration.name);
  }
  return Object.freeze({ applied: Object.freeze(result.applied), skipped: Object.freeze(result.skipped) });
}

function databaseConfigFromEnvironment(env) {
  const host = typeof env.POSTGRES_HOST === 'string' && env.POSTGRES_HOST.trim();
  const database = typeof env.POSTGRES_DB === 'string' && env.POSTGRES_DB.trim();
  const user = typeof env.POSTGRES_MIGRATOR_USER === 'string' && env.POSTGRES_MIGRATOR_USER.trim();
  const password = typeof env.POSTGRES_MIGRATOR_PASSWORD === 'string' && env.POSTGRES_MIGRATOR_PASSWORD;
  const port = Number(env.POSTGRES_PORT || 5432);
  if (!host || !database || !user || !password || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw failure('CLOUD_MIGRATION_CONFIG_INVALID');
  }
  return Object.freeze({ host, port, database, user, password, max: 1 });
}

async function applyMigrations({ client, migrations }) {
  if (!client || typeof client.query !== 'function') throw failure('CLOUD_MIGRATION_CONFIG_INVALID');
  await client.query('SELECT pg_advisory_lock(hashtext($1))', ['gewu-cloud-business-schema-migrations-v1']);
  try {
    await client.query('CREATE SCHEMA IF NOT EXISTS business');
    await client.query(`CREATE TABLE IF NOT EXISTS business.cloud_schema_migrations (
      name text COLLATE "C" PRIMARY KEY,
      sha256 text COLLATE "C" NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
      applied_at timestamptz NOT NULL DEFAULT transaction_timestamp()
    )`);
    return await applyMigrationPlan({
      migrations,
      readApplied: async name => {
        const result = await client.query('SELECT sha256 FROM business.cloud_schema_migrations WHERE name=$1', [name]);
        return result.rows[0]?.sha256 || null;
      },
      executeSql: async migration => {
        try {
          await client.query(migration.sql);
        } catch (error) {
          await client.query('ROLLBACK').catch(() => {});
          throw error;
        }
      },
      recordApplied: migration => client.query(
        'INSERT INTO business.cloud_schema_migrations(name,sha256) VALUES($1,$2)',
        [migration.name, migration.sha256],
      ),
    });
  } finally {
    await client.query('SELECT pg_advisory_unlock(hashtext($1))', ['gewu-cloud-business-schema-migrations-v1']).catch(() => {});
  }
}

async function main() {
  const { Pool } = require('pg');
  const pool = new Pool(databaseConfigFromEnvironment(process.env));
  const client = await pool.connect();
  try {
    const result = await applyMigrations({
      client,
      migrations: readMigrationFiles({ sqlDir: path.resolve(__dirname, '..', 'sql') }),
    });
    console.log(JSON.stringify(result));
  } finally {
    client.release();
    await pool.end();
  }
}

module.exports = { readMigrationFiles, applyMigrationPlan, databaseConfigFromEnvironment, applyMigrations };

if (require.main === module) {
  main().catch(error => {
    console.error(error.code || error.message);
    process.exitCode = 1;
  });
}
