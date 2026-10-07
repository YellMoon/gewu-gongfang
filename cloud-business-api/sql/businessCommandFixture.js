'use strict';
// Test-only pool over a real restricted PostgreSQL connection. Every command
// transaction and its mutation services share the production writer's ALS scope.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { withVNextPg17SyntheticQuery: withQuery } = require('../../shared/vnext-pg17/disposableRuntime');
const { createBusinessCommandWriter } = require('../src/businessCommandTransaction');

async function createPgBusinessCommandFixture(handle) {
  await withQuery(handle, 'fixture-provisioner', db => db.query(fs.readFileSync(path.join(__dirname, '20261007-business-command-receipts.sql'), 'utf8')));
  const db = await withQuery(handle, 'writer', async connection => {
    assert.deepEqual((await connection.query('SELECT session_user,current_user')).rows[0], { session_user: 'vnext_pg17_writer', current_user: 'vnext_pg17_writer' });
    await assert.rejects(() => connection.query('SELECT * FROM business.desktop_business_command_receipts'), error => error.code === '42501');
    return connection;
  });
  let busy = false;
  const waiting = [];
  const acquire = async () => {
    if (busy) await new Promise(resolve => waiting.push(resolve));
    else busy = true;
    let released = false;
    return { query: (sql, values) => db.query(sql, values), release() {
      assert.equal(released, false, 'fixture pool clients must be released once');
      released = true;
      const next = waiting.shift();
      if (next) next(); else busy = false;
    } };
  };
  return createBusinessCommandWriter({ connect: acquire, async query(sql, values) {
    const client = await acquire();
    try { return await client.query(sql, values); } finally { client.release(); }
  } });
}

function canonicalFixtureContext(context, accountId = 'fixture-account') {
  assert(context && typeof context === 'object', 'HTTP fixture authentication needs an explicit context');
  const account = context.accountId || accountId;
  assert.equal(typeof account, 'string'); assert(account.trim() && account === account.trim());
  return { authorityId: 'fixture-authority', ...context, accountId: account };
}

async function assertPgBusinessCommandReceipts(handle, accountId) {
  const rows = await withQuery(handle, 'fixture-provisioner', async db => (await db.query('SELECT actor_id,http_status,completed_at FROM business.desktop_business_command_receipts ORDER BY command_id')).rows);
  assert(rows.length > 0, 'the current adapter/outbox path must persist actual PostgreSQL receipts');
  for (const row of rows) {
    assert(row.actor_id && row.completed_at && row.http_status >= 200 && row.http_status < 500);
    if (accountId) assert.equal(row.actor_id, accountId);
  }
}
module.exports = { createPgBusinessCommandFixture, canonicalFixtureContext, assertPgBusinessCommandReceipts };
