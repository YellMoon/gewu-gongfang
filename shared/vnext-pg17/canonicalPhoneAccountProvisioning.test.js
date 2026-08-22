'use strict';

const assert = require('assert');
const {
  createDisposablePg17Runtime,
  withVNextPg17SyntheticQuery,
  provisionVNextPg17CanonicalPhoneAccount,
} = require('./disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('./catalogAssertion');

const AT = '2026-08-22T00:00:00.000Z';
const hash = character => character.repeat(64);

async function runCanonicalPhoneAccountProvisioningCases(runtime) {
  const ownedRuntime = !runtime;
  const activeRuntime = runtime || createDisposablePg17Runtime();
  if (ownedRuntime) await activeRuntime.start();
  const handle = await activeRuntime.createIsolatedHandle();
  const catalog = createVNextPg17CatalogBoundary(activeRuntime);
  try {
    await catalog.apply(handle, { appliedAt: AT, appliedBy: 'canonical-phone-account-test' });
    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
      await facade.query(
        "INSERT INTO vnext_control_plane.vnext_authorities(authority_id,status,created_at,updated_at) VALUES('authority-1','active',$1,$1)",
        [AT],
      );
      await facade.query(
        "INSERT INTO vnext_control_plane.vnext_accounts(account_id,authority_id,status,auth_version,access_version,revocation_version,row_version,created_at,updated_at) VALUES('legacy-account','authority-1','active',1,1,1,1,$1,$1)",
        [AT],
      );
    });

    const legacyBinding = await provisionVNextPg17CanonicalPhoneAccount(activeRuntime, handle, {
      accountId: 'legacy-account',
      contactId: 'legacy-contact',
      phoneHash: hash('0'),
      verificationEvidenceHash: hash('1'),
    });
    assert.deepStrictEqual(legacyBinding, { authorityId: 'authority-1', accountId: 'legacy-account', replayed: false });

    const first = await provisionVNextPg17CanonicalPhoneAccount(activeRuntime, handle, {
      accountId: 'account-1',
      contactId: 'contact-1',
      phoneHash: hash('a'),
      verificationEvidenceHash: hash('b'),
    });
    assert.deepStrictEqual(first, { authorityId: 'authority-1', accountId: 'account-1', replayed: false });

    const replay = await provisionVNextPg17CanonicalPhoneAccount(activeRuntime, handle, {
      accountId: 'account-unused',
      contactId: 'contact-unused',
      phoneHash: hash('a'),
      verificationEvidenceHash: hash('c'),
    });
    assert.deepStrictEqual(replay, { authorityId: 'authority-1', accountId: 'account-1', replayed: true });

    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
      const rows = await facade.query(
        "SELECT account_id AS \"accountId\", normalized_value_hash AS \"phoneHash\", verification_evidence_hash AS \"evidenceHash\" FROM vnext_control_plane.vnext_verified_contacts WHERE contact_type = 'phone' ORDER BY contact_id",
      );
      assert.deepStrictEqual(rows.rows, [
        { accountId: 'account-1', phoneHash: hash('a'), evidenceHash: hash('b') },
        { accountId: 'legacy-account', phoneHash: hash('0'), evidenceHash: hash('1') },
      ]);
      await assert.rejects(() => facade.query(
        "SELECT * FROM vnext_control_plane.vnext_provision_canonical_phone_account('account-2','contact-2',$1,$2)",
        [hash('d'), hash('e')],
      ));
    });

    await withVNextPg17SyntheticQuery(handle, 'writer', async facade => {
      await assert.rejects(() => facade.query(
        "SELECT * FROM vnext_control_plane.vnext_provision_canonical_phone_account('account-3','contact-3',$1,$2)",
        [hash('f'), hash('0')],
      ));
    });
  } finally {
    await activeRuntime.disposeHandle(handle);
    if (ownedRuntime) await activeRuntime.stop();
  }
}

if (require.main === module) {
  runCanonicalPhoneAccountProvisioningCases().then(() => {
    console.log('vNext PG17 canonical phone account provisioning checks passed');
  }).catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { runCanonicalPhoneAccountProvisioningCases };
