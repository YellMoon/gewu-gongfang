const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { ensurePaperJobSchema, createOrGetPaperJob, claimPaperJobWithSnapshot, paperJobKey, stagePaperArtifact } = require('./paperJobRepository');
const { reconcilePaperArtifacts } = require('./paperStorageCleanup');

const db = new Database(':memory:'); ensurePaperJobSchema(db);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-paper-reconcile-'));
const createJob = id => {
  const key = paperJobKey('relay', id);
  createOrGetPaperJob(db, { jobKey: key, relayScope: 'relay', cloudTaskId: id, taskId: id, tenantId: 'tenant', ownerUserId: 'owner', requestHash: id, tempDir: path.join(root, 'assets', 'paper-job-temp', key) });
  return claimPaperJobWithSnapshot(db, key, () => [{ id: 'q', stem: id }]).job;
};
try {
  const tempJob = createJob('temp-only'); fs.mkdirSync(tempJob.temp_dir, { recursive: true }); fs.writeFileSync(path.join(tempJob.temp_dir, 'partial.pdf'), 'partial');
  const untrustedFinal = path.join(root, 'assets', 'exports', 'temp-only.pdf'); fs.mkdirSync(path.dirname(untrustedFinal), { recursive: true }); fs.writeFileSync(untrustedFinal, 'no-gate-sidecar');
  stagePaperArtifact(db, { artifactId: 'staged-temp', taskId: tempJob.task_id, jobKey: tempJob.job_key, ownerUserId: 'owner', tenantId: 'tenant', snapshotHash: tempJob.snapshot_hash, format: 'pdf', mimeType: 'application/pdf', filePath: untrustedFinal });
  fs.writeFileSync(`${untrustedFinal}.verified.json`, JSON.stringify({ artifactId: 'wrong-artifact', jobKey: tempJob.job_key, snapshotHash: tempJob.snapshot_hash, sha256: crypto.createHash('sha256').update('no-gate-sidecar').digest('hex'), sizeBytes: Buffer.byteLength('no-gate-sidecar') }));

  const finalJob = createJob('final-present'); const finalPath = path.join(root, 'assets', 'exports', 'final-present.pdf');
  fs.mkdirSync(path.dirname(finalPath), { recursive: true }); const bytes = Buffer.from('verified-final'); fs.writeFileSync(finalPath, bytes);
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  fs.writeFileSync(`${finalPath}.verified.json`, JSON.stringify({ artifactId: 'staged-final', jobKey: finalJob.job_key, snapshotHash: finalJob.snapshot_hash, sha256: digest, sizeBytes: bytes.length, pageCount: 1, formulaCount: 2, fallbackCount: 0, effectiveFormulaModes: ['latex-vector'] }));
  stagePaperArtifact(db, { artifactId: 'staged-final', taskId: finalJob.task_id, jobKey: finalJob.job_key, ownerUserId: 'owner', tenantId: 'tenant', snapshotHash: finalJob.snapshot_hash, format: 'pdf', mimeType: 'application/pdf', filePath: finalPath });

  const missingJob = createJob('verified-missing');
  stagePaperArtifact(db, { artifactId: 'verified-missing', taskId: missingJob.task_id, jobKey: missingJob.job_key, ownerUserId: 'owner', tenantId: 'tenant', snapshotHash: missingJob.snapshot_hash, format: 'pdf', mimeType: 'application/pdf', filePath: path.join(root, 'assets', 'exports', 'missing.pdf') });
  db.prepare("UPDATE paper_artifacts SET storage_status='verified',sha256='x',size_bytes=1 WHERE artifact_id='verified-missing'").run();

  const result = reconcilePaperArtifacts(db, root, { now: '2026-07-13T00:00:00.000Z' });
  assert.deepStrictEqual(result, { recovered: 1, abandoned: 1, missing: 1, rejectedPaths: 0 });
  assert.strictEqual(db.prepare("SELECT storage_status FROM paper_artifacts WHERE artifact_id='staged-final'").get().storage_status, 'verified');
  assert.strictEqual(db.prepare("SELECT status FROM paper_jobs WHERE job_key=?").get(finalJob.job_key).status, 'completed');
  assert.strictEqual(db.prepare("SELECT storage_status FROM paper_artifacts WHERE artifact_id='staged-temp'").get().storage_status, 'abandoned');
  assert.strictEqual(db.prepare("SELECT status FROM paper_jobs WHERE job_key=?").get(tempJob.job_key).status, 'retry_wait');
  assert.strictEqual(fs.existsSync(tempJob.temp_dir), false);
  assert.strictEqual(fs.existsSync(untrustedFinal), false, 'final without gate sidecar is untrusted and must be removed before retry');
  assert.strictEqual(db.prepare("SELECT storage_status FROM paper_artifacts WHERE artifact_id='verified-missing'").get().storage_status, 'missing');
} finally { db.close(); fs.rmSync(root, { recursive: true, force: true }); }
console.log('paper artifact reconcile checks passed');
