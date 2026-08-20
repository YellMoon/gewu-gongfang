'use strict';

const assert = require('assert');
const {
  createDisposablePg17Runtime,
  withVNextPg17SyntheticQuery,
  createVNextPg17SyntheticQueryTrace,
  armVNextPg17SyntheticQueryTrace,
  inspectVNextPg17SyntheticQueryTrace,
} = require('./disposableRuntime');
const {
  fixture,
  command,
  manifest,
  insertSession,
  NOW,
} = require('./accountDeviceLinkRevocationMutation.test');
const {
  createVNextPg17AccountDeviceLinkRevocationMutation,
} = require('./accountDeviceLinkRevocationMutation');
const {
  createVNextPg17AccountDeviceLinkRevocationCanonicalParity,
} = require('./accountDeviceLinkRevocationCanonicalParity');
const {
  createVNextPg17PolicyPublicationMutation,
} = require('./policyPublicationMutation');
const {
  createVNextPg17TrustedSessionVerifierBoundary,
} = require('./trustedSessionVerifierBoundary');
const {
  createVNextPg17AccessContextResolver,
} = require('./accessContextResolver');
const { expectedCatalog } = require('./migrationManifest');

function isReadOnlyTraceStatement(query) {
  if (['COMMIT', 'ROLLBACK', 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'].includes(query)) return true;
  if (typeof query !== 'string' || !query.startsWith('SELECT ') || query.includes(';')) return false;
  const withoutStrings = query.replace(/'(?:''|[^'])*'/g, '');
  return !/\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE|DROP|SET\s+ROLE|CALL|DO|COPY)\b/i.test(withoutStrings);
}

async function targetRowsSnapshot(handle) {
  return withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
    const snapshot = {};
    for (const relation of expectedCatalog.relations) {
      const result = await facade.query(`SELECT row_to_json(item)::text AS row FROM ${relation} item ORDER BY row_to_json(item)::text`);
      snapshot[relation] = result.rows.map(item => item.row);
    }
    return snapshot;
  });
}

async function brandedResolver(runtime, handle, { surface = 'desktop', now = () => NOW, sessionId = 'actor-session-1' } = {}) {
  const boundary = createVNextPg17TrustedSessionVerifierBoundary({
    databaseBinding: handle,
    verifyPresentation: () => ({ sessionId }),
  });
  return Object.freeze({
    assertion: await boundary.verify(null),
    resolver: createVNextPg17AccessContextResolver({ runtime, handle, verifierBoundary: boundary, surface, now }),
  });
}

async function expectParityCodeWithoutWrites(handle, action, code) {
  const before = await targetRowsSnapshot(handle);
  await assert.rejects(action, error => error && error.code === code);
  assert.deepStrictEqual(await targetRowsSnapshot(handle), before);
}

async function storedVector(handle, idempotencyKey = 'revoke-link-1') {
  return withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
    const receipt = await facade.query(
      `SELECT outcome,result_code,canonical_request_sha256,canonical_result_json,canonical_result_sha256
       FROM vnext_control_plane.vnext_authorization_command_receipts
       WHERE authority_id='authority-1' AND idempotency_key=$1`,
      [idempotencyKey],
    );
    const audit = await facade.query(
      `SELECT context_sha256
       FROM vnext_control_plane.vnext_authorization_audit_events
       WHERE authority_id='authority-1' AND receipt_id=(
         SELECT receipt_id FROM vnext_control_plane.vnext_authorization_command_receipts
         WHERE authority_id='authority-1' AND idempotency_key=$1
       )`,
      [idempotencyKey],
    );
    const outbox = await facade.query(
      `SELECT canonical_payload_json,payload_sha256
       FROM vnext_control_plane.vnext_authorization_outbox_events
       WHERE authority_id='authority-1' AND receipt_id=(
         SELECT receipt_id FROM vnext_control_plane.vnext_authorization_command_receipts
         WHERE authority_id='authority-1' AND idempotency_key=$1
       )`,
      [idempotencyKey],
    );
    return Object.freeze({
      outcome: receipt.rows[0].outcome,
      resultCode: receipt.rows[0].result_code,
      requestSha256: receipt.rows[0].canonical_request_sha256,
      resultJson: receipt.rows[0].canonical_result_json,
      resultSha256: receipt.rows[0].canonical_result_sha256,
      auditContextSha256: audit.rows[0].context_sha256,
      ...(outbox.rows.length === 0 ? {} : {
        outboxPayloadJson: outbox.rows[0].canonical_payload_json,
        outboxPayloadSha256: outbox.rows[0].payload_sha256,
      }),
    });
  });
}

async function assertStoredReplay(runtime, input, idempotencyKey) {
  const current = await fixture(runtime);
  try {
    const mutation = createVNextPg17AccountDeviceLinkRevocationMutation({
      runtime,
      handle: current.handle,
      resolver: current.actorResolver,
      now: () => NOW,
      idFactory: kind => idempotencyKey + '-' + kind,
    });
    await mutation.execute(current.actorAssertion, input);
    const parity = createVNextPg17AccountDeviceLinkRevocationCanonicalParity({
      runtime,
      handle: current.handle,
      resolver: current.actorResolver,
      now: () => NOW,
    });
    assert.deepStrictEqual(await parity.inspect(current.actorAssertion, input), await storedVector(current.handle, idempotencyKey));
  } finally {
    await runtime.disposeHandle(current.handle);
  }
}

async function assertFreshParity(runtime, input, prepare = async () => {}) {
  const expected = await fixture(runtime);
  const actual = await fixture(runtime);
  try {
    let expectedIds = 0;
    const expectedWriter = createVNextPg17AccountDeviceLinkRevocationMutation({
      runtime, handle: expected.handle, resolver: expected.actorResolver, now: () => NOW,
      idFactory: kind => `fresh-expected-${kind}-${++expectedIds}`,
    });
    let actualIds = 0;
    const actualWriter = createVNextPg17AccountDeviceLinkRevocationMutation({
      runtime, handle: actual.handle, resolver: actual.actorResolver, now: () => NOW,
      idFactory: kind => `fresh-actual-${kind}-${++actualIds}`,
    });
    await prepare(expectedWriter, expected);
    await prepare(actualWriter, actual);
    await expectedWriter.execute(expected.actorAssertion, input);
    const parity = createVNextPg17AccountDeviceLinkRevocationCanonicalParity({
      runtime, handle: actual.handle, resolver: actual.actorResolver, now: () => NOW,
    });
    const before = await targetRowsSnapshot(actual.handle);
    assert.deepStrictEqual(await parity.inspect(actual.actorAssertion, input), await storedVector(expected.handle, input.idempotencyKey));
    assert.deepStrictEqual(await targetRowsSnapshot(actual.handle), before);
  } finally {
    await runtime.disposeHandle(expected.handle);
    await runtime.disposeHandle(actual.handle);
  }
}

async function assertDamagedReplayIsRejected(runtime, relation, mutationSql) {
  const current = await fixture(runtime);
  try {
    const writer = createVNextPg17AccountDeviceLinkRevocationMutation({
      runtime,
      handle: current.handle,
      resolver: current.actorResolver,
      now: () => NOW,
      idFactory: kind => 'damaged-' + kind,
    });
    await writer.execute(current.actorAssertion, command());
    await withVNextPg17SyntheticQuery(current.handle, 'fixture-provisioner', async facade => {
      await facade.query('ALTER TABLE vnext_control_plane.' + relation + ' DISABLE TRIGGER vnext_' + relation.slice('vnext_'.length) + '_no_update');
      try {
        await facade.query(mutationSql);
      } finally {
        await facade.query('ALTER TABLE vnext_control_plane.' + relation + ' ENABLE TRIGGER vnext_' + relation.slice('vnext_'.length) + '_no_update');
      }
    });
    const parity = createVNextPg17AccountDeviceLinkRevocationCanonicalParity({
      runtime,
      handle: current.handle,
      resolver: current.actorResolver,
      now: () => NOW,
    });
    await assert.rejects(
      () => parity.inspect(current.actorAssertion, command()),
      error => error && error.code === 'VNEXT_PG17_LINK_REVOCATION_PARITY_RECEIPT_INVALID',
    );
  } finally {
    await runtime.disposeHandle(current.handle);
  }
}

async function assertAcceptedTargetDriftIsRejected(runtime) {
  const current = await fixture(runtime);
  try {
    const writer = createVNextPg17AccountDeviceLinkRevocationMutation({
      runtime,
      handle: current.handle,
      resolver: current.actorResolver,
      now: () => NOW,
      idFactory: kind => 'target-drift-' + kind,
    });
    await writer.execute(current.actorAssertion, command());
    await withVNextPg17SyntheticQuery(current.handle, 'fixture-provisioner', facade => facade.query(
      "UPDATE vnext_control_plane.vnext_account_device_links SET auth_version=auth_version+1 WHERE authority_id='authority-1' AND link_id='target-link-1'",
    ));
    const parity = createVNextPg17AccountDeviceLinkRevocationCanonicalParity({
      runtime,
      handle: current.handle,
      resolver: current.actorResolver,
      now: () => NOW,
    });
    await assert.rejects(
      () => parity.inspect(current.actorAssertion, command()),
      error => error && error.code === 'VNEXT_PG17_LINK_REVOCATION_PARITY_RECEIPT_INVALID',
    );
  } finally {
    await runtime.disposeHandle(current.handle);
  }
}

async function assertNoopReplay(runtime) {
  const current = await fixture(runtime);
  try {
    let ids = 0;
    const writer = createVNextPg17AccountDeviceLinkRevocationMutation({
      runtime,
      handle: current.handle,
      resolver: current.actorResolver,
      now: () => NOW,
      idFactory: kind => `noop-${kind}-${++ids}`,
    });
    await writer.execute(current.actorAssertion, command({ idempotencyKey: 'initial-link' }));
    const noop = command({ idempotencyKey: 'noop-link' });
    await writer.execute(current.actorAssertion, noop);
    const parity = createVNextPg17AccountDeviceLinkRevocationCanonicalParity({
      runtime,
      handle: current.handle,
      resolver: current.actorResolver,
      now: () => NOW,
    });
    assert.deepStrictEqual(await parity.inspect(current.actorAssertion, noop), await storedVector(current.handle, 'noop-link'));
  } finally {
    await runtime.disposeHandle(current.handle);
  }
}

async function assertStoredNonAcceptedVersionDriftIsRejected(runtime, input, idempotencyKey, versionField, prepare = async () => {}) {
  const current = await fixture(runtime);
  try {
    let ids = 0;
    const writer = createVNextPg17AccountDeviceLinkRevocationMutation({
      runtime,
      handle: current.handle,
      resolver: current.actorResolver,
      now: () => NOW,
      idFactory: kind => `non-accepted-${kind}-${++ids}`,
    });
    await prepare(writer, current);
    await writer.execute(current.actorAssertion, input);
    await withVNextPg17SyntheticQuery(current.handle, 'fixture-provisioner', async facade => {
      await facade.query('ALTER TABLE vnext_control_plane.vnext_authorization_command_receipts DISABLE TRIGGER vnext_authorization_command_receipts_no_update');
      try {
        await facade.query(
          `UPDATE vnext_control_plane.vnext_authorization_command_receipts SET ${versionField}=1 WHERE authority_id='authority-1' AND idempotency_key=$1`,
          [idempotencyKey],
        );
      } finally {
        await facade.query('ALTER TABLE vnext_control_plane.vnext_authorization_command_receipts ENABLE TRIGGER vnext_authorization_command_receipts_no_update');
      }
    });
    const parity = createVNextPg17AccountDeviceLinkRevocationCanonicalParity({
      runtime,
      handle: current.handle,
      resolver: current.actorResolver,
      now: () => NOW,
    });
    await assert.rejects(
      () => parity.inspect(current.actorAssertion, input),
      error => error && error.code === 'VNEXT_PG17_LINK_REVOCATION_PARITY_RECEIPT_INVALID',
    );
  } finally {
    await runtime.disposeHandle(current.handle);
  }
}

async function assertReplaySurvivesPolicyRevisionChange(runtime) {
  const current = await fixture(runtime);
  try {
    const writer = createVNextPg17AccountDeviceLinkRevocationMutation({
      runtime,
      handle: current.handle,
      resolver: current.actorResolver,
      now: () => NOW,
      idFactory: kind => 'policy-replay-' + kind,
    });
    await writer.execute(current.actorAssertion, command({ idempotencyKey: 'policy-replay-link' }));
    const nextManifest = manifest();
    nextManifest.capabilities.find(item => item.capabilityId === 'user.review').allowedSurfaces = ['desktop', 'miniapp'];
    const policy = createVNextPg17PolicyPublicationMutation({
      runtime,
      handle: current.handle,
      resolver: current.actorResolver,
      now: () => NOW,
      idFactory: kind => 'policy-revision-' + kind,
    });
    await policy.execute(current.actorAssertion, {
      type: 'authorization_policy.publish',
      expectedPolicyRevision: 1,
      idempotencyKey: 'policy-revision-2',
      reasonCode: 'policy-update',
      manifest: nextManifest,
    });
    assert.deepStrictEqual(
      await writer.execute(current.actorAssertion, command({ idempotencyKey: 'policy-replay-link' })),
      { code: 'ACCOUNT_DEVICE_LINK_REVOKED', linkId: 'target-link-1', replayed: true, status: 'accepted' },
    );
    const parity = createVNextPg17AccountDeviceLinkRevocationCanonicalParity({
      runtime,
      handle: current.handle,
      resolver: current.actorResolver,
      now: () => NOW,
    });
    assert.deepStrictEqual(
      await parity.inspect(current.actorAssertion, command({ idempotencyKey: 'policy-replay-link' })),
      await storedVector(current.handle, 'policy-replay-link'),
    );
  } finally {
    await runtime.disposeHandle(current.handle);
  }
}

async function assertFailClosedInputsAndAuthorization(runtime) {
  const current = await fixture(runtime);
  const other = await fixture(runtime);
  try {
    const parity = createVNextPg17AccountDeviceLinkRevocationCanonicalParity({
      runtime,
      handle: current.handle,
      resolver: current.actorResolver,
      now: () => NOW,
    });
    await expectParityCodeWithoutWrites(current.handle, () => parity.inspect({}, command()), 'VNEXT_PG17_LINK_REVOCATION_PARITY_UNAVAILABLE');
    await expectParityCodeWithoutWrites(current.handle, () => parity.inspect(other.actorAssertion, command()), 'VNEXT_PG17_LINK_REVOCATION_PARITY_UNAVAILABLE');
    await expectParityCodeWithoutWrites(current.handle, () => parity.inspect(current.actorAssertion, command({ extra: true })), 'VNEXT_PG17_LINK_REVOCATION_PARITY_INVALID');
    let getterReads = 0;
    const accessorCommand = { ...command() };
    Object.defineProperty(accessorCommand, 'reasonCode', { enumerable: true, get() { getterReads += 1; return 'device_lost'; } });
    await expectParityCodeWithoutWrites(current.handle, () => parity.inspect(current.actorAssertion, accessorCommand), 'VNEXT_PG17_LINK_REVOCATION_PARITY_INVALID');
    assert.strictEqual(getterReads, 0);
    await expectParityCodeWithoutWrites(current.handle, () => parity.inspect(current.actorAssertion, new Proxy(command(), {})), 'VNEXT_PG17_LINK_REVOCATION_PARITY_INVALID');
    const invalidClock = createVNextPg17AccountDeviceLinkRevocationCanonicalParity({ runtime, handle: current.handle, resolver: current.actorResolver, now: () => '2026-08-15T00:01:00+00:00' });
    await expectParityCodeWithoutWrites(current.handle, () => invalidClock.inspect(current.actorAssertion, command()), 'VNEXT_PG17_LINK_REVOCATION_PARITY_UNAVAILABLE');
    const throwingClock = createVNextPg17AccountDeviceLinkRevocationCanonicalParity({ runtime, handle: current.handle, resolver: current.actorResolver, now: () => { throw new Error('private clock detail'); } });
    await expectParityCodeWithoutWrites(current.handle, () => throwingClock.inspect(current.actorAssertion, command()), 'VNEXT_PG17_LINK_REVOCATION_PARITY_UNAVAILABLE');
    const expiredClock = createVNextPg17AccountDeviceLinkRevocationCanonicalParity({ runtime, handle: current.handle, resolver: current.actorResolver, now: () => '2026-08-15T00:11:00.000Z' });
    await expectParityCodeWithoutWrites(current.handle, () => expiredClock.inspect(current.actorAssertion, command()), 'VNEXT_PG17_LINK_REVOCATION_PARITY_UNAVAILABLE');
    const miniapp = await brandedResolver(runtime, current.handle, { surface: 'miniapp' });
    const miniappParity = createVNextPg17AccountDeviceLinkRevocationCanonicalParity({ runtime, handle: current.handle, resolver: miniapp.resolver, now: () => NOW });
    await expectParityCodeWithoutWrites(current.handle, () => miniappParity.inspect(miniapp.assertion, command()), 'VNEXT_PG17_LINK_REVOCATION_PARITY_UNAVAILABLE');
    await withVNextPg17SyntheticQuery(current.handle, 'fixture-provisioner', facade => facade.query(
      "UPDATE vnext_control_plane.vnext_role_grants SET status='revoked',revoked_at=$1,updated_at=$1 WHERE authority_id='authority-1' AND account_id='account-1' AND role='super_admin'",
      [NOW],
    ));
    await expectParityCodeWithoutWrites(current.handle, () => parity.inspect(current.actorAssertion, command()), 'VNEXT_PG17_LINK_REVOCATION_PARITY_UNAVAILABLE');
    const capabilityFixture = await fixture(runtime);
    try {
      const revisedManifest = manifest();
      revisedManifest.roleDefaults.super_admin = revisedManifest.roleDefaults.super_admin.filter(capabilityId => capabilityId !== 'device.revoke');
      const policy = createVNextPg17PolicyPublicationMutation({
        runtime,
        handle: capabilityFixture.handle,
        resolver: capabilityFixture.actorResolver,
        now: () => NOW,
        idFactory: kind => 'no-device-revoke-' + kind,
      });
      await policy.execute(capabilityFixture.actorAssertion, {
        type: 'authorization_policy.publish', expectedPolicyRevision: 1, idempotencyKey: 'no-device-revoke', reasonCode: 'policy-update', manifest: revisedManifest,
      });
      const capabilityParity = createVNextPg17AccountDeviceLinkRevocationCanonicalParity({ runtime, handle: capabilityFixture.handle, resolver: capabilityFixture.actorResolver, now: () => NOW });
      await expectParityCodeWithoutWrites(capabilityFixture.handle, () => capabilityParity.inspect(capabilityFixture.actorAssertion, command()), 'VNEXT_PG17_LINK_REVOCATION_PARITY_UNAVAILABLE');
    } finally {
      await runtime.disposeHandle(capabilityFixture.handle);
    }
    const reauthFixture = await fixture(runtime);
    try {
      const expired = await brandedResolver(runtime, reauthFixture.handle, { now: () => '2026-08-15T00:11:00.000Z' });
      const expiredParity = createVNextPg17AccountDeviceLinkRevocationCanonicalParity({ runtime, handle: reauthFixture.handle, resolver: expired.resolver, now: () => '2026-08-15T00:11:00.000Z' });
      await expectParityCodeWithoutWrites(reauthFixture.handle, () => expiredParity.inspect(expired.assertion, command()), 'VNEXT_PG17_LINK_REVOCATION_PARITY_UNAVAILABLE');
    } finally {
      await runtime.disposeHandle(reauthFixture.handle);
    }
    const futureFixture = await fixture(runtime);
    try {
      await withVNextPg17SyntheticQuery(futureFixture.handle, 'fixture-provisioner', async facade => {
        await insertSession(facade, 'future-reauth-session', 'account-1', 'device-1', 'installation-1', 'bootstrap-bootstrap-link');
        await facade.query("INSERT INTO vnext_control_plane.vnext_recent_reauthentication_events(reauth_event_id,authority_id,session_id,factor_class,evidence_sha256,account_auth_version,account_access_version,account_revocation_version,device_credential_version,device_risk_version,installation_credential_version,link_auth_version,link_access_version,link_row_version,verified_at,expires_at,created_at) VALUES('future-reauth-1','authority-1','future-reauth-session','passkey',repeat('c',64),1,1,1,1,1,1,1,1,1,'2026-08-15T00:02:00.000Z','2026-08-15T00:10:00.000Z','2026-08-15T00:02:00.000Z')");
      });
      const future = await brandedResolver(runtime, futureFixture.handle, { sessionId: 'future-reauth-session' });
      const futureParity = createVNextPg17AccountDeviceLinkRevocationCanonicalParity({ runtime, handle: futureFixture.handle, resolver: future.resolver, now: () => NOW });
      await expectParityCodeWithoutWrites(futureFixture.handle, () => futureParity.inspect(future.assertion, command()), 'VNEXT_PG17_LINK_REVOCATION_PARITY_UNAVAILABLE');
    } finally {
      await runtime.disposeHandle(futureFixture.handle);
    }
    assert.throws(
      () => createVNextPg17AccountDeviceLinkRevocationCanonicalParity({ runtime, handle: current.handle, resolver: other.actorResolver, now: () => NOW }),
      error => error && error.code === 'VNEXT_PG17_LINK_REVOCATION_PARITY_INVALID',
    );
    assert.throws(
      () => createVNextPg17AccountDeviceLinkRevocationCanonicalParity({ runtime, handle: current.handle, resolver: { resolve: async () => ({}) }, now: () => NOW }),
      error => error && error.code === 'VNEXT_PG17_LINK_REVOCATION_PARITY_INVALID',
    );
  } finally {
    await runtime.disposeHandle(current.handle);
    await runtime.disposeHandle(other.handle);
  }
}

async function runAccountDeviceLinkRevocationCanonicalParityCases(runtime) {
  const expected = await fixture(runtime);
  const actual = await fixture(runtime);
  try {
    let ids = 0;
    const mutation = createVNextPg17AccountDeviceLinkRevocationMutation({
      runtime,
      handle: expected.handle,
      resolver: expected.actorResolver,
      now: () => NOW,
      idFactory: kind => `parity-${kind}-${++ids}`,
    });
    await mutation.execute(expected.actorAssertion, command());
    const expectedVector = await storedVector(expected.handle);
    const replayParity = createVNextPg17AccountDeviceLinkRevocationCanonicalParity({
      runtime,
      handle: expected.handle,
      resolver: expected.actorResolver,
      now: () => NOW,
    });
    assert.deepStrictEqual(await replayParity.inspect(expected.actorAssertion, command()), expectedVector);
    await assert.rejects(
      () => replayParity.inspect(expected.actorAssertion, command({ reasonCode: 'changed-reason' })),
      error => error && error.code === 'VNEXT_PG17_LINK_REVOCATION_PARITY_IDEMPOTENCY_CONFLICT',
    );

    const parity = createVNextPg17AccountDeviceLinkRevocationCanonicalParity({
      runtime,
      handle: actual.handle,
      resolver: actual.actorResolver,
      now: () => NOW,
    });
    const before = await targetRowsSnapshot(actual.handle);
    const trace = createVNextPg17SyntheticQueryTrace(runtime, actual.handle, 'verifier');
    armVNextPg17SyntheticQueryTrace(trace);
    const actualVector = await parity.inspect(actual.actorAssertion, command());
    assert.deepStrictEqual(actualVector, expectedVector);
    assert.deepStrictEqual(await targetRowsSnapshot(actual.handle), before);
    const queries = inspectVNextPg17SyntheticQueryTrace(trace).queries;
    const recomputationBegin = queries.lastIndexOf('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    assert.notStrictEqual(recomputationBegin, -1);
    assert.strictEqual(queries.at(-1), 'COMMIT');
    assert.strictEqual(isReadOnlyTraceStatement('SELECT 1'), true);
    assert.strictEqual(isReadOnlyTraceStatement("SELECT 'UPDATE'"), true);
    assert.strictEqual(isReadOnlyTraceStatement('SELECT 1; DELETE FROM vnext_control_plane.vnext_accounts'), false);
    assert.strictEqual(isReadOnlyTraceStatement('BEGIN; UPDATE vnext_control_plane.vnext_accounts SET status=\'active\''), false);
    assert.strictEqual(isReadOnlyTraceStatement('SELECT * FROM (DELETE FROM vnext_control_plane.vnext_accounts RETURNING *) AS mutated'), false);
    assert.strictEqual(queries.every(isReadOnlyTraceStatement), true);
  } finally {
    await runtime.disposeHandle(expected.handle);
    await runtime.disposeHandle(actual.handle);
  }

  await assertStoredReplay(runtime, command({ expectedTargetRowVersion: 2, idempotencyKey: 'stale-link' }), 'stale-link');
  await assertStoredReplay(runtime, command({ targetLinkId: 'bootstrap-bootstrap-link', idempotencyKey: 'self-link' }), 'self-link');
  await assertStoredReplay(runtime, command({ targetLinkId: 'missing-link', idempotencyKey: 'missing-link' }), 'missing-link');
  await assertNoopReplay(runtime);
  await assertFreshParity(runtime, command({ expectedTargetRowVersion: 2, idempotencyKey: 'fresh-stale-link' }));
  await assertFreshParity(runtime, command({ targetLinkId: 'bootstrap-bootstrap-link', idempotencyKey: 'fresh-self-link' }));
  await assertFreshParity(runtime, command({ targetLinkId: 'missing-link', idempotencyKey: 'fresh-missing-link' }));
  await assertFreshParity(
    runtime,
    command({ idempotencyKey: 'fresh-noop-link' }),
    async (writer, current) => writer.execute(current.actorAssertion, command({ idempotencyKey: 'fresh-prior-accepted' })),
  );
  for (const versionField of ['committed_auth_version', 'committed_access_version', 'committed_revocation_version', 'committed_target_row_version']) {
    await assertStoredNonAcceptedVersionDriftIsRejected(
      runtime,
      command({ targetLinkId: 'missing-link', idempotencyKey: `rejected-${versionField}` }),
      `rejected-${versionField}`,
      versionField,
    );
    await assertStoredNonAcceptedVersionDriftIsRejected(
      runtime,
      command({ idempotencyKey: `noop-${versionField}` }),
      `noop-${versionField}`,
      versionField,
      async (writer, current) => writer.execute(current.actorAssertion, command({ idempotencyKey: `noop-prior-${versionField}` })),
    );
  }
  await assertReplaySurvivesPolicyRevisionChange(runtime);
  await assertFailClosedInputsAndAuthorization(runtime);
  await assertAcceptedTargetDriftIsRejected(runtime);
  await assertDamagedReplayIsRejected(
    runtime,
    'vnext_authorization_command_receipts',
    "UPDATE vnext_control_plane.vnext_authorization_command_receipts SET result_code='FORGED_RESULT' WHERE idempotency_key='revoke-link-1'",
  );
  await assertDamagedReplayIsRejected(
    runtime,
    'vnext_authorization_audit_events',
    "UPDATE vnext_control_plane.vnext_authorization_audit_events SET context_sha256=repeat('a',64) WHERE receipt_id=(SELECT receipt_id FROM vnext_control_plane.vnext_authorization_command_receipts WHERE idempotency_key='revoke-link-1')",
  );
  await assertDamagedReplayIsRejected(
    runtime,
    'vnext_authorization_outbox_events',
    "UPDATE vnext_control_plane.vnext_authorization_outbox_events SET payload_sha256=repeat('a',64) WHERE receipt_id=(SELECT receipt_id FROM vnext_control_plane.vnext_authorization_command_receipts WHERE idempotency_key='revoke-link-1')",
  );
}

if (require.main === module) {
  const runtime = createDisposablePg17Runtime();
  runtime.start()
    .then(() => runAccountDeviceLinkRevocationCanonicalParityCases(runtime))
    .then(() => process.stdout.write('vNext PG17 link-revocation canonical parity checks passed\n'))
    .finally(() => runtime.stop())
    .catch(error => {
      process.stderr.write(`${error.code || error.message}\n`);
      process.exitCode = 1;
    });
}

module.exports = { runAccountDeviceLinkRevocationCanonicalParityCases };
