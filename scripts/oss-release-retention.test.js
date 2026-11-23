const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createCleanupPlan, cleanupReleases } = require('./oss-release-retention');

const now = Date.parse('2026-11-23T00:00:00Z');
const old = '2026-10-01T00:00:00.000Z';
const recent = '2026-11-22T00:00:00.000Z';
const object = (key, modified = old) => ({ key, modified, bytes: 12, etag: '"same"' });
const objects = [
  object('desktop/app-8.40.1.exe'),
  object('desktop/app-8.40.0.exe'),
  object('desktop/app-8.39.1.exe'),
  object('desktop/app-8.38.0.exe'),
  object('desktop/app-8.37.0.exe', recent),
  object('desktop/app-8.41.0.exe'),
  object('desktop/releases/8.40.1/app-8.40.1.exe', recent),
  object('desktop/releases/8.38.0/latest.yml'),
  object('desktop/customer-data.json'),
  object('other/app-8.38.0.exe'),
  object('desktop/nested/app-8.38.0.exe'),
];
const plan = createCleanupPlan({ objects, prefix: 'desktop', currentVersion: '8.40.1',
  protectedKeys: new Set(['desktop/app-8.40.1.exe']), now });
assert.deepStrictEqual(plan.retainedVersions, ['8.40.1', '8.40.0', '8.39.1']);
assert.deepStrictEqual(plan.candidates.map(item => item.key), [
  'desktop/app-8.38.0.exe', 'desktop/releases/8.40.1/app-8.40.1.exe',
  'desktop/releases/8.38.0/latest.yml',
]);
assert.throws(() => createCleanupPlan({ objects, prefix: '', currentVersion: '8.40.1', protectedKeys: new Set(), now }));
assert.throws(() => createCleanupPlan({ objects, prefix: 'desktop', currentVersion: '8.40.1', protectedKeys: new Set(), now, graceDays: 0 }));

async function verifyCleanup() {
  const auditDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-retention-test-'));
  const calls = [];
  const feed = Buffer.from('version: 8.40.1\nfiles:\n  - url: app-8.40.1.exe\n    size: 12\n');
  const request = async (method, key) => {
    calls.push({ method, key });
    if (method === 'GET' && key === 'desktop/latest.yml') return { body: feed };
    if (method === 'GET' && key === '') return { body: Buffer.from('<ListBucketResult><IsTruncated>false</IsTruncated>'
      + objects.filter(item => !item.key.endsWith('latest.yml')).map(item => `<Contents><Key>${item.key}</Key><Size>${item.bytes}</Size><ETag>&quot;same&quot;</ETag><LastModified>${item.modified}</LastModified></Contents>`).join('') + '</ListBucketResult>') };
    if (method === 'HEAD') {
      const item = objects.find(entry => entry.key === key);
      return { headers: { 'content-length': '12', etag: item.etag, 'last-modified': new Date(item.modified).toUTCString() } };
    }
    if (method === 'DELETE') {
      assert.ok(fs.readdirSync(auditDir).length, 'inventory must be persisted before deletion');
      return {};
    }
    throw new Error(`Unexpected request ${method} ${key}`);
  };
  try {
    await cleanupReleases({ request, prefix: 'desktop', now });
    assert.ok(!calls.some(call => call.method === 'DELETE'), 'preview must be read-only');
    const result = await cleanupReleases({ request, prefix: 'desktop', now, apply: true, auditDir });
    assert.deepStrictEqual(result.deleted, ['desktop/app-8.38.0.exe', 'desktop/releases/8.40.1/app-8.40.1.exe']);
    assert.strictEqual(JSON.parse(fs.readFileSync(result.auditPath, 'utf8')).deleted.length, 2);
    let feedReads = 0;
    const changedRequest = async (method, key, query) => {
      if (method === 'GET' && key === 'desktop/latest.yml' && ++feedReads > 1) return { body: Buffer.from('changed') };
      return request(method, key, query);
    };
    calls.length = 0;
    await assert.rejects(cleanupReleases({ request: changedRequest, prefix: 'desktop', now, apply: true, auditDir }), /feed changed/);
    assert.ok(!calls.some(call => call.method === 'DELETE'), 'changed feed must stop cleanup');
    const changedObject = async (method, key, query) => {
      const response = await request(method, key, query);
      if (method === 'HEAD' && key === 'desktop/app-8.38.0.exe') response.headers.etag = '"changed"';
      return response;
    };
    calls.length = 0;
    await assert.rejects(cleanupReleases({ request: changedObject, prefix: 'desktop', now, apply: true, auditDir }), /Object changed/);
    assert.ok(!calls.some(call => call.method === 'DELETE'), 'changed object must not be deleted');
  } finally {
    fs.rmSync(auditDir, { recursive: true, force: true });
  }
}

verifyCleanup().then(() => console.log('OSS retention checks passed')).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
