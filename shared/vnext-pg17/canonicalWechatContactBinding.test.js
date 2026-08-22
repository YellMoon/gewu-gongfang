'use strict';

const assert = require('assert');
const {
  createDisposablePg17Runtime,
  withVNextPg17SyntheticQuery,
  bindVNextPg17CanonicalWechatIdentity,
  readVNextPg17CanonicalAccountByVerifiedContact,
} = require('./disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('./catalogAssertion');

const AT = '2026-08-22T00:00:00.000Z';
const hash = character => character.repeat(64);

async function runCanonicalWechatContactBindingCases(runtime) {
  const ownedRuntime = !runtime;
  const activeRuntime = runtime || createDisposablePg17Runtime();
  if (ownedRuntime) await activeRuntime.start();
  const handle = await activeRuntime.createIsolatedHandle();
  const catalog = createVNextPg17CatalogBoundary(activeRuntime);
  try {
    await catalog.apply(handle, { appliedAt: AT, appliedBy: 'canonical-wechat-contact-test' });
    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
      await facade.query("INSERT INTO vnext_control_plane.vnext_authorities(authority_id,status,created_at,updated_at) VALUES('authority-1','active',$1,$1)", [AT]);
      await facade.query("INSERT INTO vnext_control_plane.vnext_accounts(account_id,authority_id,status,auth_version,access_version,revocation_version,row_version,created_at,updated_at) VALUES('account-1','authority-1','active',1,1,1,1,$1,$1),('account-2','authority-1','active',1,1,1,1,$1,$1)", [AT]);
      await facade.query("INSERT INTO vnext_control_plane.vnext_verified_contacts(contact_id,authority_id,account_id,contact_type,normalized_value_hash,verification_state,verification_evidence_hash,verified_at,revoked_at,row_version,created_at,updated_at) VALUES('phone-contact-1','authority-1','account-1','phone',$1,'verified',$2,$3,NULL,1,$3,$3)", [hash('f'), hash('0'), AT]);
    });
    const first = await bindVNextPg17CanonicalWechatIdentity(activeRuntime, handle, {
      authorityId: 'authority-1', accountId: 'account-1', openidContactId: 'openid-contact-1', openidHash: hash('a'), unionidContactId: 'unionid-contact-1', unionidHash: hash('b'), verificationEvidenceHash: hash('c'),
    });
    assert.deepStrictEqual(first, { authorityId: 'authority-1', accountId: 'account-1', openidContactId: 'openid-contact-1', unionidContactId: 'unionid-contact-1' });
    const replay = await bindVNextPg17CanonicalWechatIdentity(activeRuntime, handle, {
      authorityId: 'authority-1', accountId: 'account-1', openidContactId: 'ignored-openid', openidHash: hash('a'), unionidContactId: 'ignored-unionid', unionidHash: hash('b'), verificationEvidenceHash: hash('d'),
    });
    assert.deepStrictEqual(replay, first);
    assert.deepStrictEqual(await readVNextPg17CanonicalAccountByVerifiedContact(activeRuntime, handle, { contactType: 'wechat_openid', contactHash: hash('a') }), { authorityId: 'authority-1', accountId: 'account-1', phoneHmac: hash('f') });
    await assert.rejects(
      () => bindVNextPg17CanonicalWechatIdentity(activeRuntime, handle, { authorityId: 'authority-1', accountId: 'account-2', openidContactId: 'openid-contact-2', openidHash: hash('a'), unionidContactId: null, unionidHash: null, verificationEvidenceHash: hash('e') }),
      error => error && error.code === 'VNEXT_PG17_TEST_RUNTIME_UNAVAILABLE',
    );
  } finally {
    await activeRuntime.disposeHandle(handle);
    if (ownedRuntime) await activeRuntime.stop();
  }
}

if (require.main === module) {
  runCanonicalWechatContactBindingCases().then(() => console.log('vNext PG17 canonical WeChat contact binding checks passed')).catch(error => { console.error(error); process.exitCode = 1; });
}

module.exports = { runCanonicalWechatContactBindingCases };
