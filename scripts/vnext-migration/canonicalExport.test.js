'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { exportCanonicalSnapshot } = require('./canonicalExport');
const { PLAINTEXT_FIXTURE_TOKEN } = require('./canonicalExportTestSupport');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-canonical-export-'));
try {
  const snapshotPath = path.join(root, 'snapshot.sqlite');
  const db = new Database(snapshotPath);
  db.exec(`
    CREATE TABLE tenants(id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE desktop_sessions(id TEXT PRIMARY KEY, token TEXT NOT NULL);
    CREATE TABLE sync_conflicts(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE vector_embeddings(id TEXT PRIMARY KEY, payload BLOB NOT NULL);
  `);
  db.prepare('INSERT INTO tenants(id,name) VALUES(?,?)').run('tenant-1', '\u683c\u7269');
  db.prepare('INSERT INTO desktop_sessions(id,token) VALUES(?,?)').run('session-1', 'secret-token');
  db.prepare('INSERT INTO sync_conflicts(id,payload) VALUES(?,?)').run('conflict-1', 'offline-draft');
  db.prepare('INSERT INTO vector_embeddings(id,payload) VALUES(?,?)').run('vector-1', Buffer.from([1, 2, 3]));
  db.close();

  const catalog = {
    schemaVersion: 1,
    tables: [
      { sourceTable: 'tenants', disposition: 'canonical', target: 'identity.tenants', stableIdStrategy: 'preserve-text', dependencyOrder: 0, transformerId: 'identity.tenant', aggregateInvariants: ['row_count'], fileReferenceFields: [], reason: null },
      { sourceTable: 'desktop_sessions', disposition: 'archive', target: null, stableIdStrategy: null, dependencyOrder: null, transformerId: null, aggregateInvariants: [], fileReferenceFields: [], reason: 'Credentials stay inactive archive evidence.' },
      { sourceTable: 'sync_conflicts', disposition: 'local_partition', target: null, stableIdStrategy: null, dependencyOrder: null, transformerId: null, aggregateInvariants: [], fileReferenceFields: [], reason: 'Offline changes require account review.' },
      { sourceTable: 'vector_embeddings', disposition: 'rebuildable_cache', target: null, stableIdStrategy: null, dependencyOrder: null, transformerId: null, aggregateInvariants: [], fileReferenceFields: [], reason: 'Derived vectors rebuild from canonical data.' },
    ],
  };
  const outputRoot = path.join(root, 'export');
  const report = exportCanonicalSnapshot({
    snapshotPath,
    outputRoot,
    catalog,
    plaintextFixtureToken: PLAINTEXT_FIXTURE_TOKEN,
  });

  assert.strictEqual(report.sourceTableCount, 4);
  assert.strictEqual(report.sourceRowCount, 4);
  assert.strictEqual(report.canonicalRowCount, 1);
  assert.strictEqual(report.archiveRowCount, 1);
  assert.strictEqual(report.localPartitionRowCount, 1);
  assert.strictEqual(report.rebuildableCacheRowCount, 1);
  assert.strictEqual(report.quarantineRowCount, 0);
  assert.match(report.exportHash, /^[a-f0-9]{64}$/);

  const tenantLines = fs.readFileSync(path.join(outputRoot, 'canonical', 'tenants.ndjson'), 'utf8').trim().split('\n');
  assert.strictEqual(tenantLines.length, 1);
  const tenant = JSON.parse(tenantLines[0]);
  assert.strictEqual(tenant.sourceTable, 'tenants');
  assert.strictEqual(tenant.sourceRecordKey, '{"id":{"type":"text","value":"tenant-1"}}');
  assert.deepStrictEqual(tenant.record.id, { type: 'text', value: 'tenant-1' });
  assert.deepStrictEqual(tenant.record.name, { type: 'text', value: '\u683c\u7269' });

  const archiveText = fs.readFileSync(path.join(outputRoot, 'archive', 'desktop_sessions.ndjson'), 'utf8');
  assert.ok(!archiveText.includes('secret-token'));
  assert.ok(!archiveText.includes('session-1'));
  const archive = JSON.parse(archiveText.trim());
  assert.deepStrictEqual(Object.keys(archive).sort(), ['recordHash', 'sourceTable']);

  const localText = fs.readFileSync(path.join(outputRoot, 'local_partition', 'sync_conflicts.ndjson'), 'utf8');
  assert.ok(localText.includes('offline-draft'));
  assert.ok(!JSON.stringify(report).includes(root));

  const repeatedRoot = path.join(root, 'export-repeat');
  const repeated = exportCanonicalSnapshot({
    snapshotPath, outputRoot: repeatedRoot, catalog, plaintextFixtureToken: PLAINTEXT_FIXTURE_TOKEN,
  });
  assert.strictEqual(repeated.exportHash, report.exportHash);

  assert.throws(
    () => exportCanonicalSnapshot({ snapshotPath, outputRoot: path.join(root, 'blocked'), catalog }),
    error => error && error.code === 'MIGRATION_CANONICAL_ENCRYPTION_REQUIRED',
  );
  assert.throws(
    () => exportCanonicalSnapshot({ snapshotPath, outputRoot, catalog, plaintextFixtureToken: PLAINTEXT_FIXTURE_TOKEN }),
    error => error && error.code === 'MIGRATION_CANONICAL_OUTPUT_EXISTS',
  );

  console.log('deterministic canonical snapshot export checks passed');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
