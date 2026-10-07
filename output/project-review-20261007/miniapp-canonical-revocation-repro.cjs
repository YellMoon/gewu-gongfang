'use strict';
const fs = require('node:fs'); const path = require('node:path');
const root = path.resolve(__dirname, '../..'); const load = file => require(path.join(root, file));
const { createDisposablePg17Runtime, withVNextPg17SyntheticQuery: withQ } = load('shared/vnext-pg17/disposableRuntime');
const { createVNextPg17CatalogBoundary } = load('shared/vnext-pg17/catalogAssertion');
const { createBusinessFoundationCatalogBoundary } = load('shared/vnext-pg17/businessFoundationCatalogAssertion');
const { createMiniappCloudAccountRepository } = load('cloud-business-api/src/miniappCloudAccountRepository');
const { createMiniappCloudAccountService } = load('cloud-business-api/src/miniappCloudAccountService');
const { createCloudBusinessApp } = load('cloud-business-api/src/app');
(async () => {
  const rt = createDisposablePg17Runtime(); let handle; let server;
  try {
    await rt.start(); handle = await rt.createIsolatedHandle();
    const apply = { appliedAt: '2026-10-07T00:00:00.000Z', appliedBy: 'project-review' };
    await createVNextPg17CatalogBoundary(rt).apply(handle, apply);
    await createBusinessFoundationCatalogBoundary(rt).apply(handle, apply);
    const query = (sql, values) => withQ(handle, 'fixture-provisioner', q => q.query(sql, values));
    await query('CREATE ROLE gewu_cloud_schedule_reader');
    // Account and role schema required by the real repository. Family role/application
    // migrations do not affect the super_admin identity used in this fixture.
    for (const file of ['20260822-miniapp-cloud-accounts.sql', '20260822-miniapp-cloud-role-profiles.sql', '20260822-miniapp-student-access.sql', '20260926-miniapp-multi-active-role.sql']) {
      let sql = fs.readFileSync(path.join(root, 'cloud-business-api/sql', file), 'utf8');
      if (file.startsWith('20260822')) sql = sql.replace('BEGIN;', 'BEGIN; SET LOCAL ROLE vnext_pg17_business_owner;');
      await query(sql);
    }
    await query("INSERT INTO vnext_control_plane.vnext_authorities(authority_id,status,created_at,updated_at) VALUES('auth','active',now(),now())");
    await query("INSERT INTO vnext_control_plane.vnext_accounts(account_id,authority_id,status,auth_version,access_version,revocation_version,row_version,created_at,updated_at) VALUES('account','auth','active',1,1,1,1,now(),now())");
    await query("INSERT INTO business.miniapp_cloud_accounts(account_id,phone_hmac,status) VALUES('account',repeat('a',64),'active')");
    await query("INSERT INTO business.miniapp_cloud_role_grants(account_id,role,status) VALUES('account','super_admin','active')");
    const accountRepository = createMiniappCloudAccountRepository({ query, tenantId: 'tenant' });
    const cloudAccount = createMiniappCloudAccountService({
      now: () => new Date(), bootstrapAdminAccountId: 'account', accountRepository, ticketSecret: 'synthetic-review-secret-long-enough',
      // Initial login only: substitute WeChat's external code verification, preserving canonical account identity.
      canonicalWechatIdentity: { resolveOrBind: async () => ({ authorityId: 'auth', accountId: 'account', phoneHmac: 'a'.repeat(64), provisioned: false, bound: false }) },
    });
    const issued = await cloudAccount.login({ loginCode: 'synthetic-login-code', phoneCode: 'synthetic-phone-code' });
    const app = createCloudBusinessApp({ query, businessTenantId: 'tenant', miniappCloudAccount: cloudAccount });
    server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const url = `http://127.0.0.1:${server.address().port}/api/miniapp/cloud-context`;
    const inspect = async label => { const response = await fetch(url, { headers: { authorization: `Bearer ${issued.token}` } }); console.log(label + ':', JSON.stringify({ httpStatus: response.status, body: await response.json() })); };
    await inspect('BEFORE DISABLE');
    await query("UPDATE vnext_control_plane.vnext_accounts SET status='disabled',revocation_version=revocation_version+1,row_version=row_version+1,updated_at=now() WHERE account_id='account'");
    console.log('CANONICAL STATE:', JSON.stringify((await query("SELECT status,revocation_version FROM vnext_control_plane.vnext_accounts WHERE account_id='account'")).rows));
    await inspect('AFTER ACCOUNT DISABLE');
    await query("UPDATE vnext_control_plane.vnext_authorities SET status='revoked',updated_at=now() WHERE authority_id='auth'");
    await inspect('AFTER AUTHORITY REVOKE');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (handle) await rt.disposeHandle(handle).catch(() => {});
    await rt.stop().catch(() => {});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
