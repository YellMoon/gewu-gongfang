'use strict';

const assert = require('node:assert/strict');
const { createDisposablePg17Runtime, withVNextPg17SyntheticQuery: withQuery } = require('../../shared/vnext-pg17/disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('../../shared/vnext-pg17/catalogAssertion');
const { createDesktopAccountProfileReader } = require('./desktopAccountProfileService');

(async () => {
  const runtime = createDisposablePg17Runtime();
  let handle;
  try {
    await runtime.start();
    handle = await runtime.createIsolatedHandle();
    const now = new Date().toISOString();
    await createVNextPg17CatalogBoundary(runtime).apply(handle, { appliedAt: now, appliedBy: 'desktop-own-profile-read-test' });
    await withQuery(handle, 'fixture-provisioner', async q => {
      await q.query("INSERT INTO vnext_control_plane.vnext_authorities(authority_id,status,created_at,updated_at) VALUES('authority-1','active',$1,$1)", [now]);
      for (const [id, phoneHash, loginName] of [['own', 'a'.repeat(64), 'own.login'], ['other', 'b'.repeat(64), 'other.login']]) {
        await q.query("INSERT INTO vnext_control_plane.vnext_accounts(account_id,authority_id,status,auth_version,access_version,revocation_version,row_version,created_at,updated_at) VALUES($1,'authority-1','active',1,1,1,1,$2,$2)", [id, now]);
        await q.query("INSERT INTO vnext_control_plane.vnext_verified_contacts(contact_id,authority_id,account_id,contact_type,normalized_value_hash,verification_state,verification_evidence_hash,verified_at,row_version,created_at,updated_at) VALUES($1,'authority-1',$2,'phone',$3,'verified','fixture-evidence',$4,1,$4,$4)", [`contact-${id}`, id, phoneHash, now]);
        await q.query("INSERT INTO vnext_control_plane.vnext_desktop_password_credentials(authority_id,account_id,login_name,password_algorithm,password_salt_base64,password_hash_base64,credential_version,created_at,updated_at) VALUES('authority-1',$1,$2,'scrypt-v1','c2FsdA==','aGFzaA==',1,$3,$3)", [id, loginName, now]);
      }
    });
    const reader = createDesktopAccountProfileReader({ tenantId: 'tenant-1',
      canonicalQuery: (sql, values) => withQuery(handle, 'writer', q => q.query(sql, values)),
      identityQuery: (sql, values) => withQuery(handle, 'identity-verifier', q => q.query(sql, values)),
      businessQuery: async () => { throw Error('not required for credential metadata'); },
    });
    assert.equal(await reader.readAccountName({ authorityId: 'authority-1', accountId: 'own' }), 'own.login');
    assert.equal(await reader.readAccountName({ authorityId: 'authority-1', accountId: 'missing' }), null);
    assert.equal(await reader.readAccountName({ authorityId: 'wrong-authority', accountId: 'own' }), null);
    for (const role of ['writer', 'identity-verifier', 'runtime']) {
      await assert.rejects(() => withQuery(handle, role, q => q.query('SELECT login_name FROM vnext_control_plane.vnext_desktop_password_credentials')), error => error.code === '42501', `${role} must have no direct credential table access`);
    }
    for (const role of ['writer', 'runtime']) {
      await assert.rejects(() => withQuery(handle, role, q => q.query('SELECT login_name FROM vnext_control_plane.vnext_read_desktop_password_by_phone_hash($1)', ['a'.repeat(64)])), error => error.code === '42501', `${role} must not invoke the identity verifier function`);
    }
    const crossAccount = await withQuery(handle, 'identity-verifier', q => q.query('SELECT login_name FROM vnext_control_plane.vnext_read_desktop_password_by_phone_hash($1) WHERE authority_id=$2 AND account_id=$3', ['a'.repeat(64), 'authority-1', 'other']));
    assert.deepEqual(crossAccount.rows, [], 'credential projection must require the current account even when a phone matches another account');
    console.log('desktop account profile PostgreSQL own-login projection and restricted-role permission checks passed');
  } finally {
    if (handle) await runtime.disposeHandle(handle).catch(() => {});
    await runtime.stop().catch(() => {});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
