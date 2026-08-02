const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { createPrimaryHostLocalProjectionReader } = require('./primaryHostLocalProjectionReader');
const {
  createAuthorityRuntimeHostEpochService,
} = require('../backend/src/services/authorityRuntimeHostEpochService');

async function run() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE authority_accounts (
      user_id TEXT PRIMARY KEY, authority_id TEXT NOT NULL, status TEXT NOT NULL
    );
    CREATE TABLE authority_role_bindings (
      binding_id TEXT PRIMARY KEY, authority_id TEXT NOT NULL, user_id TEXT NOT NULL,
      role TEXT NOT NULL, subject_type TEXT, subject_id TEXT, status TEXT NOT NULL,
      grant_version INTEGER NOT NULL, granted_by TEXT
    );
    CREATE TABLE device_leases (
      lease_id TEXT PRIMARY KEY, grant_id TEXT NOT NULL, authority_id TEXT NOT NULL, device_id TEXT NOT NULL,
      user_id TEXT NOT NULL, active_role TEXT NOT NULL, grant_version INTEGER NOT NULL,
      status TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT
    );
    CREATE TABLE device_grants (
      grant_id TEXT PRIMARY KEY, authority_id TEXT NOT NULL, device_id TEXT NOT NULL,
      user_id TEXT NOT NULL, host_generation INTEGER NOT NULL, status TEXT NOT NULL,
      grant_version INTEGER NOT NULL, revoked_at TEXT
    );
    CREATE TABLE primary_host_epochs (
      id TEXT PRIMARY KEY, db_authority_id TEXT NOT NULL, device_id TEXT NOT NULL,
      generation INTEGER NOT NULL, status TEXT NOT NULL
    );
  `);
  db.prepare("INSERT INTO authority_accounts VALUES('super-1','authority-1','active')").run();
  db.prepare(`INSERT INTO authority_role_bindings VALUES(
    'binding-super','authority-1','super-1','super_admin',NULL,NULL,'active',3,'test')`).run();
  db.prepare(`INSERT INTO device_leases VALUES(
    'lease-1','grant-1','authority-1','host-1','super-1','super_admin',3,'active',
    '2026-08-03T00:00:00.000Z',NULL)`).run();
  db.prepare(`INSERT INTO device_grants VALUES(
    'grant-1','authority-1','host-1','super-1',9,'active',3,NULL)`).run();
  const runtimeHostEpochs = createAuthorityRuntimeHostEpochService({ db });
  db.prepare(`INSERT INTO authority_runtime_host_epochs
    (host_epoch_id,authority_id,host_generation,host_device_id,host_public_key,status,verified_at)
    VALUES('epoch-1','authority-1',9,'host-1','host-public-key','active','2026-08-02T00:00:00.000Z')`).run();
  const calls = [];
  let actorRole = 'super_admin';
  let materializeMutation = null;
  let projection = {
    authorityId: 'authority-1',
    hostEpochId: 'epoch-1',
    userId: 'super-1',
    role: 'super_admin',
    sourceVersion: 7,
    payload: { roleApplications: [] },
  };
  const read = createPrimaryHostLocalProjectionReader({
    refreshControlRecords: async () => {
      calls.push('refresh');
      throw Object.assign(new Error('cloud offline'), { code: 'CLOUD_OFFLINE' });
    },
    hostAuthorityContext: async () => {
      calls.push('context');
      return {
        authorityId: 'authority-1',
        hostEpochId: 'epoch-1',
        actor: { userId: 'super-1', deviceId: 'host-1', role: actorRole },
        lease: { id: 'lease-1', grantVersion: 3 },
      };
    },
    resolveHostEpoch: hostEpochId => runtimeHostEpochs.find(hostEpochId),
    materializeProjections: async target => {
      calls.push(['materialize', target]);
      projection = {
        ...projection,
        role: actorRole,
        sourceVersion: 7,
        generatedAt: '2026-08-02T00:00:00.000Z',
      };
      if (materializeMutation) {
        const mutate = materializeMutation;
        materializeMutation = null;
        mutate();
      }
      return { materialized: 1, failed: 0 };
    },
    projectionStore: {
      read(input) {
        calls.push(['read', input]);
        return projection;
      },
    },
    db,
    now: () => new Date('2026-08-02T00:00:00.000Z'),
  });

  assert.deepEqual(await read({ minSourceVersion: 7 }), projection);
  assert.deepEqual(calls.slice(0, 2), ['refresh', 'context']);
  assert.deepEqual(calls[2], ['materialize', {
    authorityId: 'authority-1',
    hostEpochId: 'epoch-1',
  }]);
  assert.deepEqual(calls[3], ['read', {
    authorityId: 'authority-1',
    userId: 'super-1',
    role: 'super_admin',
  }]);
  db.prepare("UPDATE authority_runtime_host_epochs SET status='retired' WHERE host_epoch_id='epoch-1'").run();
  await assert.rejects(
    () => read(),
    error => error?.code === 'AUTHORITY_PROJECTION_HOST_EPOCH_INACTIVE',
    'a retired runtime host epoch must fail closed even when the rest of the control context remains active',
  );
  db.prepare("UPDATE authority_runtime_host_epochs SET status='active' WHERE host_epoch_id='epoch-1'").run();
  await assert.rejects(
    () => read({ minSourceVersion: 8 }),
    error => error?.code === 'AUTHORITY_PROJECTION_VERSION_PENDING',
  );

  db.prepare("UPDATE authority_role_bindings SET status='revoked' WHERE binding_id='binding-super'").run();
  await assert.rejects(
    () => read(),
    error => error?.code === 'AUTHORITY_PROJECTION_ROLE_NOT_GRANTED',
    'a revoked canonical binding must invalidate an already materialized privileged projection',
  );

  actorRole = 'visitor';
  db.prepare("UPDATE device_leases SET active_role='visitor' WHERE lease_id='lease-1'").run();
  assert.equal((await read()).role, 'visitor', 'visitor needs an active account but no canonical role binding');

  db.prepare("UPDATE authority_accounts SET status='disabled' WHERE user_id='super-1'").run();
  await assert.rejects(
    () => read(),
    error => error?.code === 'AUTHORITY_PROJECTION_ACCOUNT_NOT_ACTIVE',
  );

  db.prepare("UPDATE authority_accounts SET status='active' WHERE user_id='super-1'").run();
  db.prepare("UPDATE device_leases SET expires_at='2026-08-01T23:59:59.000Z' WHERE lease_id='lease-1'").run();
  await assert.rejects(
    () => read(),
    error => error?.code === 'AUTHORITY_PROJECTION_LEASE_INACTIVE',
  );

  db.prepare("UPDATE device_leases SET expires_at='2026-08-03T00:00:00.000Z' WHERE lease_id='lease-1'").run();
  materializeMutation = () => db.prepare(`UPDATE device_grants
    SET status='revoked',revoked_at='2026-08-02T00:00:00.000Z' WHERE grant_id='grant-1'`).run();
  await assert.rejects(
    () => read(),
    error => error?.code === 'AUTHORITY_PROJECTION_DEVICE_GRANT_INACTIVE',
    'a device grant revoked during materialization must invalidate the read before return',
  );

  db.prepare("UPDATE device_grants SET status='active',revoked_at=NULL WHERE grant_id='grant-1'").run();
  materializeMutation = () => db.prepare(`UPDATE device_grants
    SET grant_version=grant_version+1 WHERE grant_id='grant-1'`).run();
  await assert.rejects(
    () => read(),
    error => error?.code === 'AUTHORITY_PROJECTION_GRANT_VERSION_STALE',
    'a device grant version advanced during materialization must invalidate the old lease/context pair',
  );
  db.close();
}

run().then(() => console.log('primary host local projection reader tests passed'));
