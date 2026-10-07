'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createDisposablePg17Runtime, withVNextPg17SyntheticQuery: withQ } = require('../../shared/vnext-pg17/disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('../../shared/vnext-pg17/catalogAssertion');
const { createBusinessFoundationCatalogBoundary } = require('../../shared/vnext-pg17/businessFoundationCatalogAssertion');
const { createMiniappCloudAccountRepository } = require('../src/miniappCloudAccountRepository');
const { createMiniappCloudAccountService } = require('../src/miniappCloudAccountService');
const { createCloudBusinessApp } = require('../src/app');
const APPLY = { appliedAt: '2026-10-07T00:00:00.000Z', appliedBy: 'canonical-fence-regression' };
(async () => {
  const rt = createDisposablePg17Runtime(); let h; let server;
  try {
    await rt.start(); h = await rt.createIsolatedHandle();
    await createVNextPg17CatalogBoundary(rt).apply(h, APPLY);
    await createBusinessFoundationCatalogBoundary(rt).apply(h, APPLY);
    const provision = (sql, values) => withQ(h, 'fixture-provisioner', q => q.query(sql, values));
    await provision('CREATE ROLE gewu_cloud_schedule_reader');
    await provision('GRANT USAGE ON SCHEMA business TO gewu_cloud_schedule_reader');
    for (const file of ['20260822-miniapp-cloud-accounts.sql', '20260822-miniapp-cloud-role-profiles.sql', '20260822-miniapp-student-access.sql', '20260926-miniapp-multi-active-role.sql']) {
      let sql = fs.readFileSync(path.join(__dirname, file), 'utf8');
      if (file.startsWith('20260822')) sql = sql.replace('BEGIN;', 'BEGIN; SET LOCAL ROLE vnext_pg17_business_owner;');
      await provision(sql);
    }
    await provision("INSERT INTO vnext_control_plane.vnext_authorities(authority_id,status,created_at,updated_at) VALUES('auth','active',now(),now())");
    await provision("INSERT INTO vnext_control_plane.vnext_accounts(account_id,authority_id,status,auth_version,access_version,revocation_version,row_version,created_at,updated_at) VALUES('account','auth','active',9007199254740993,1,1,1,now(),now())");
    await provision("INSERT INTO business.miniapp_cloud_accounts(account_id,phone_hmac,status) VALUES('account',repeat('a',64),'active'); INSERT INTO business.miniapp_cloud_role_grants(account_id,role,status) VALUES('account','super_admin','active')");
    const query = (sql, values) => withQ(h, 'fixture-provisioner', async q => {
      await q.query('SET SESSION AUTHORIZATION gewu_cloud_schedule_reader');
      try { return await q.query(sql, values); } finally { await q.query('RESET SESSION AUTHORIZATION'); }
    });
    const canonicalQuery = (sql, values) => withQ(h, 'identity-verifier', q => q.query(sql, values));
    const repository = createMiniappCloudAccountRepository({ query, canonicalQuery, tenantId: 'tenant' });
    assert.equal((await repository.readCanonicalFence({ authorityId: 'auth', accountId: 'account' })).accountId, 'account');
    assert.equal((await repository.readContext({ accountId: 'account' })).accountId, 'account');
    const service = createMiniappCloudAccountService({ now: () => new Date('2026-10-07T00:00:00Z'), bootstrapAdminAccountId: 'account', ticketSecret: 'synthetic-canonical-fence-secret-long-enough', accountRepository: repository,
      canonicalWechatIdentity: { resolveOrBind: async () => ({ authorityId: 'auth', accountId: 'account', phoneHmac: 'a'.repeat(64), provisioned: false, bound: false }) } });
    const login = () => service.login({ loginCode: 'synthetic-login', phoneCode: 'synthetic-phone' });
    server = createCloudBusinessApp({ query, businessTenantId: 'tenant', miniappCloudAccount: service }).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const http = async (token, expected) => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/miniapp/cloud-context`, { headers: { authorization: `Bearer ${token}` } });
      assert.equal(response.status, expected); const body = await response.json();
      if (expected === 403) assert.equal(body.code, 'CLOUD_MINIAPP_IDENTITY_REJECTED');
    };
    let issued = await login(); await http(issued.token, 200);
    assert.equal((await repository.readCanonicalFence({ authorityId: 'auth', accountId: 'account' })).authVersion, '9007199254740993');
    for (const column of ['auth_version', 'access_version', 'revocation_version']) {
      await provision(`UPDATE vnext_control_plane.vnext_accounts SET ${column}=${column}+1,row_version=row_version+1,updated_at=clock_timestamp() WHERE account_id='account'`);
      await http(issued.token, 403); issued = await login(); await http(issued.token, 200);
    }
    for (const status of ['disabled', 'revoked']) {
      await provision("UPDATE vnext_control_plane.vnext_accounts SET status=$1,revocation_version=revocation_version+1,row_version=row_version+1,updated_at=clock_timestamp() WHERE account_id='account'", [status]);
      await http(issued.token, 403); await assert.rejects(login, { code: 'CLOUD_MINIAPP_IDENTITY_REJECTED' });
      await provision("UPDATE vnext_control_plane.vnext_accounts SET status='active',row_version=row_version+1,updated_at=clock_timestamp() WHERE account_id='account'");
      await http(issued.token, 403); issued = await login(); await http(issued.token, 200);
    }
    for (const status of ['disabled', 'revoked']) {
      await provision("UPDATE vnext_control_plane.vnext_authorities SET status=$1,updated_at=updated_at+interval '1 microsecond' WHERE authority_id='auth'", [status]);
      await http(issued.token, 403); await assert.rejects(login, { code: 'CLOUD_MINIAPP_IDENTITY_REJECTED' });
      await provision("UPDATE vnext_control_plane.vnext_authorities SET status='active',updated_at=updated_at+interval '1 microsecond' WHERE authority_id='auth'");
      await http(issued.token, 403); issued = await login(); await http(issued.token, 200);
    }
    assert.equal(await repository.readCanonicalFence({ authorityId: 'other', accountId: 'account' }), null);
    for (const role of ['runtime', 'writer', 'verifier']) await withQ(h, role, q => assert.rejects(() => q.query("SELECT * FROM vnext_control_plane.vnext_read_miniapp_account_fence('auth','account')"), error => error.code === '42501'));
    await withQ(h, 'identity-verifier', q => assert.rejects(() => q.query('SELECT * FROM vnext_control_plane.vnext_accounts'), error => error.code === '42501'));
    await withQ(h, 'identity-verifier', q => assert.rejects(() => q.query("UPDATE vnext_control_plane.vnext_accounts SET status='disabled' WHERE account_id='account'"), error => error.code === '42501'));
    await createVNextPg17CatalogBoundary(rt).assert(h);
    console.log('canonical fence PG17: real verifier/reader roles, bigint, version revocation, disabled/revoked/re-enabled accounts and authorities, HTTP rejection and least privilege passed');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (h) await rt.disposeHandle(h).catch(() => {});
    await rt.stop().catch(() => {});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
