'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { canonicalJson } = require('../../shared/migrationBundleProtocol');
const { expandCatalog, validateSourceTableCatalog } = require('../../migration/vnext/sourceTableCatalog');
const { createSealedBundleFromSnapshot } = require('./sealedSnapshotExport');
const { decryptBundleFile, fingerprintPublicKey, verifySealedMigrationBundle } = require('./sealedMigrationBundle');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-sealed-snapshot-export-'));
try {
  const snapshotPath = path.join(root, 'snapshot.sqlite');
  const db = new Database(snapshotPath);
  db.exec(`create table tenants(id text primary key,name text not null);
    create table desktop_sessions(sid text primary key,token text not null);
    create table sync_conflicts(id text primary key,payload text not null);
    create table vector_embeddings(id text primary key,payload text not null);`);
  db.prepare('insert into tenants values(?,?)').run('tenant-1', 'Tenant');
  db.prepare('insert into desktop_sessions values(?,?)').run('session-1', 'secret-token');
  db.prepare('insert into sync_conflicts values(?,?)').run('conflict-1', 'offline-draft');
  db.prepare('insert into vector_embeddings values(?,?)').run('vector-1', 'derived');
  db.close();
  const document = {
    schemaVersion: 1,
    canonical: [{ sourceTable: 'tenants', target: 'identity.tenants', dependencyOrder: 0, transformerId: 'identity.tenant' }],
    archive: { reason: 'Preserve inactive credentials as encrypted evidence.', sourceTables: ['desktop_sessions'] },
    local_partition: { reason: 'Keep offline conflicts pending authorized review.', sourceTables: ['sync_conflicts'] },
    rebuildable_cache: { reason: 'Preserve derived cache evidence for verification.', sourceTables: ['vector_embeddings'] },
    quarantine_only: { reason: 'Rows require deterministic quarantine review.', sourceTables: [] },
  };
  const catalog = expandCatalog(document);
  const inventory = { schemaVersion: 1, tableCount: 4, tables: [...catalog.tables].map(entry => ({ name: entry.sourceTable })) };
  const catalogHash = validateSourceTableCatalog({ inventory, catalog }).catalogHash;
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const encryptionKey = crypto.randomBytes(32);
  const bundlePath = path.join(root, 'bundle');
  const result = createSealedBundleFromSnapshot({
    snapshotPath, bundlePath, catalog, catalogHash, bundleId: 'snapshot-sealed-1', environment: 'shadow',
    sourceSnapshotHash: 'a'.repeat(64), sourceInventoryHash: 'b'.repeat(64), signingPrivateKey: privateKey, encryptionKey,
  });
  assert.strictEqual(result.totalRows, 4);
  assert.strictEqual(result.payloadCount, 4);
  const fingerprint = fingerprintPublicKey(publicKey);
  const verified = verifySealedMigrationBundle({
    bundlePath, signingPublicKey: publicKey, encryptionKey, allowedPublicKeyFingerprints: [fingerprint], expectedEnvironment: 'shadow',
  });
  assert.strictEqual(verified.payloads.length, 4);
  for (const payload of verified.payloads) {
    const rows = decryptBundleFile({
      bundlePath, relativePath: payload.relativePath, encryptionKey, signingPublicKey: publicKey,
      allowedPublicKeyFingerprints: [fingerprint], expectedEnvironment: 'shadow',
    }).toString('utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
    assert.strictEqual(rows.length, 1);
    assert.ok(rows[0].sourceRecordKey);
    assert.ok(rows[0].recordHash);
    assert.ok(rows[0].record);
  }
  const serialized = fs.readdirSync(bundlePath, { recursive: true })
    .filter(entry => fs.statSync(path.join(bundlePath, entry)).isFile())
    .map(entry => fs.readFileSync(path.join(bundlePath, entry)))
    .reduce((all, bytes) => Buffer.concat([all, bytes]), Buffer.alloc(0));
  assert.ok(!serialized.includes(Buffer.from('secret-token')));
  assert.ok(!serialized.includes(Buffer.from('offline-draft')));
  assert.ok(!serialized.includes(Buffer.from(canonicalJson({ sid: 'session-1' }))));
  console.log('sealed snapshot export preserves all dispositions');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
