'use strict';

const { Pool } = require('pg');

function dbError(code, cause) {
  return Object.assign(new Error(code), { code, cause });
}

function createVnextPool({ connectionString, applicationName = 'gewu-vnext', max = 4 } = {}) {
  if (!/^postgres(?:ql)?:\/\//.test(String(connectionString || ''))) {
    throw dbError('VNEXT_POSTGRES_URL_REQUIRED');
  }
  const pool = new Pool({
    connectionString,
    application_name: applicationName,
    max,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 10_000,
  });
  pool.on('error', () => { /* callers observe query failures; do not log credentials */ });
  return pool;
}

async function withTransaction(client, operation) {
  await client.query('begin');
  try {
    await client.query("set local lock_timeout = '5s'");
    await client.query("set local statement_timeout = '30s'");
    const result = await operation(client);
    await client.query('commit');
    return result;
  } catch (error) {
    try { await client.query('rollback'); } catch (_) { /* preserve original error */ }
    throw error;
  }
}

module.exports = { createVnextPool, dbError, withTransaction };
