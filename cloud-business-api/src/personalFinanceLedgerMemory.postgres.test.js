'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawn } = require('node:child_process');
const { randomBytes, createHash } = require('node:crypto');
const { Client } = require('pg');
const { createPersonalFinanceRepository } = require('./personalFinanceRepository');

const image = 'postgres@sha256:a65e6a841f6c4dbc4abda3d67fa3bc21824e9611064fcd82e87ea67aad60a0c3';
function docker(args) {
  return new Promise((resolve, reject) => {
    const host = process.platform === 'win32' ? 'npipe:////./pipe/docker_engine' : 'unix:///var/run/docker.sock';
    const child = spawn('docker', ['--host', host, ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const output = [], errors = [];
    const timer = setTimeout(() => { child.kill(); reject(new Error('LEDGER_MEMORY_DOCKER_TIMEOUT')); }, 30000);
    child.stdout.on('data', chunk => output.push(chunk));
    child.stderr.on('data', chunk => errors.push(chunk));
    child.on('error', reject);
    child.on('exit', code => {
      clearTimeout(timer);
      if (code) reject(new Error(`LEDGER_MEMORY_DOCKER_${code}: ${Buffer.concat(errors).toString('utf8').slice(0, 300)}`));
      else resolve(Buffer.concat(output).toString('utf8'));
    });
  });
}

test('one owner ledger with 60000 detailed sources reads atomically within the database memory budget', { timeout: 180000 }, async () => {
  const name = `finance-ledger-memory-${randomBytes(8).toString('hex')}`;
  const password = randomBytes(24).toString('hex');
  let client, created = false;
  try {
    await docker(['run', '--pull=never', '--detach', '--name', name, '--label', `gewu.finance-ledger-memory=${name}`,
      '--memory', '768m', '--memory-swap', '1536m', '--cpus', '1',
      '--tmpfs', '/var/lib/postgresql/data:rw,noexec,nosuid,size=512m',
      '--env', 'POSTGRES_USER=fixture', '--env', `POSTGRES_PASSWORD=${password}`, '--env', 'POSTGRES_DB=fixture',
      '--publish', '127.0.0.1::5432', image]);
    created = true;
    const container = JSON.parse(await docker(['inspect', name]))[0];
    assert.equal(container.Config.Labels['gewu.finance-ledger-memory'], name);
    const port = Number(container.NetworkSettings.Ports['5432/tcp'][0].HostPort);
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        client = new Client({ host: '127.0.0.1', port, user: 'fixture', password, database: 'fixture', connectionTimeoutMillis: 1000 });
        client.on('error', () => {});
        await client.connect();
        break;
      } catch {
        await client?.end().catch(() => {});
        client = null;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    assert(client, 'isolated PostgreSQL must become ready');
    await client.query("SET statement_timeout='75s'");
    await client.query('SET max_parallel_workers_per_gather=0');
    await client.query(`CREATE SCHEMA business;
      CREATE TABLE business.personal_finance_owners(tenant_id text,account_id text,revision bigint);
      CREATE TABLE business.personal_finance_accounts(id text,tenant_id text,account_id text,data jsonb,ledger_ordinal bigint);
      CREATE TABLE business.personal_finance_observations(LIKE business.personal_finance_accounts INCLUDING ALL);
      CREATE TABLE business.personal_finance_annotations(LIKE business.personal_finance_accounts INCLUDING ALL,revision bigint);
      CREATE TABLE business.personal_finance_links(LIKE business.personal_finance_accounts INCLUDING ALL);
      CREATE TABLE business.personal_finance_balance_snapshots(LIKE business.personal_finance_accounts INCLUDING ALL);
      CREATE TABLE business.personal_finance_imports(LIKE business.personal_finance_accounts INCLUDING ALL,created_at timestamptz);
      CREATE TABLE business.personal_finance_receipts(tenant_id text,account_id text,receipt jsonb);
      CREATE TABLE business.personal_asset_records(id text,tenant_id text,account_id text);
      CREATE TABLE business.personal_asset_manual_records(LIKE business.personal_asset_records INCLUDING ALL,deleted boolean);
      INSERT INTO business.personal_finance_owners VALUES('tenant','owner',7);
      INSERT INTO business.personal_finance_observations
      SELECT 'source_'||i,'tenant','owner',jsonb_build_object(
        'id','source_'||i,'financialAccountId','account','amountMinor','9007199254740993',
        'currency','CNY','direction','debit','occurredAt','2026-01-01T00:00:00Z',
        'rawFields',(SELECT jsonb_object_agg('column_'||n,substr(md5(i::text||':'||n::text),1,16)) FROM generate_series(1,36) n)),i
      FROM generate_series(1,60000) i;
      INSERT INTO business.personal_finance_observations VALUES('other','tenant','other-owner','{"id":"other"}',1);`);
    let reads = 0;
    const repository = createPersonalFinanceRepository({
      query: (sql, values) => { reads++; assert.deepEqual(values, ['tenant', 'owner']); return client.query(sql, values); },
      transaction: () => { throw new Error('READ_ONLY_FIXTURE'); },
      parseBillFile: () => { throw new Error('NO_SOURCE_PARSING'); },
    });
    const ledger = await repository.getLedger({ tenantId: 'tenant', actor: { accountId: 'owner', roles: ['teacher'] } });
    assert.equal(reads, 1, 'all collections must share a single statement snapshot');
    assert.equal(ledger.revision, '7');
    assert.equal(ledger.observations.length, 60000);
    for (let i = 0; i < ledger.observations.length; i++) {
      const row = ledger.observations[i];
      assert.equal(row.id, `source_${i + 1}`);
      assert.equal(row.amountMinor, '9007199254740993');
      assert.equal(row.currency, 'CNY');
      for (const n of [1, 18, 36]) assert.equal(row.rawFields[`column_${n}`], createHash('md5').update(`${i + 1}:${n}`).digest('hex').slice(0, 16));
    }
    for (const key of ['accounts', 'annotations', 'links', 'balanceSnapshots', 'imports', 'legacyRecords']) assert.deepEqual(ledger[key], []);
    const events = await docker(['exec', name, 'cat', '/sys/fs/cgroup/memory.events']);
    assert.match(events, /\noom_kill 0\n/);
  } finally {
    await client?.end().catch(() => {});
    if (created) await docker(['rm', '--force', name]);
  }
});
