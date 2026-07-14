const assert = require('assert');
const Database = require('better-sqlite3');
const {
  ensurePaperJobSchema,
  createOrGetPaperJob,
  claimPaperJobWithSnapshot,
  findVerifiedArtifact,
  recordVerifiedArtifact,
  stagePaperArtifact,
  markPaperJobRetry,
  requestPaperJobCancel,
  recoverStalePaperJobs,
  paperJobKey,
} = require('./paperJobRepository');

const db = new Database(':memory:');
ensurePaperJobSchema(db);
const base = {
  jobKey: paperJobKey('relay-primary', 'task-1'), relayScope: 'relay-primary', cloudTaskId: 'task-1', taskId: 'task-1', tenantId: 'tenant-a', ownerUserId: 'owner-a',
  requestHash: 'r'.repeat(64), selectionVersion: 'selection-v1', resourceVersion: 'resource-v1',
  maxAttempts: 2, deadlineAt: '2026-07-13T01:00:00.000Z', tempDir: 'tmp/job-1',
};
assert.strictEqual(createOrGetPaperJob(db, base, { now: '2026-07-13T00:00:00.000Z' }).created, true);
assert.strictEqual(createOrGetPaperJob(db, base, { now: '2026-07-13T00:00:01.000Z' }).created, false);
const secondScopeKey = paperJobKey('relay-secondary', 'task-1');
assert.strictEqual(createOrGetPaperJob(db, { ...base, jobKey: secondScopeKey, relayScope: 'relay-secondary' }, { now: '2026-07-13T00:00:01.000Z' }).created, true, 'the same cloud task id in a different relay scope must not collide');
assert.throws(() => createOrGetPaperJob(db, { ...base, requestHash: 'x'.repeat(64) }), error => error.code === 'PAPER_JOB_KEY_CONFLICT');

const originalQuestions = [{ id: 'q1', stem: 'before', answer: 'A' }, { id: 'q2', stem: 'stable', answer: 'B' }];
const firstClaim = claimPaperJobWithSnapshot(db, base.jobKey, () => originalQuestions, { now: '2026-07-13T00:00:02.000Z' });
assert.strictEqual(firstClaim.job.attempt, 1);
assert.deepStrictEqual(firstClaim.questions, originalQuestions);
const firstHash = firstClaim.job.snapshot_hash;
originalQuestions[0].stem = 'after claim mutation';
markPaperJobRetry(db, base.jobKey, Object.assign(new Error('transient'), { code: 'TEMP' }), {
  now: '2026-07-13T00:00:03.000Z', baseDelayMs: 1000, jitterRatio: 0,
});
assert.throws(() => claimPaperJobWithSnapshot(db, base.jobKey, () => [], { now: '2026-07-13T00:00:03.500Z' }), error => error.code === 'PAPER_JOB_BACKOFF_ACTIVE');
const retryClaim = claimPaperJobWithSnapshot(db, base.jobKey, () => [{ id: 'q1', stem: 'database changed', answer: 'C' }], { now: '2026-07-13T00:00:04.000Z' });
assert.strictEqual(retryClaim.job.snapshot_hash, firstHash, 'retry must reuse the exact claimed snapshot hash');
assert.strictEqual(retryClaim.questions[0].stem, 'before', 'question edits after claim must not change retry content');
assert.strictEqual(retryClaim.job.attempt, 2);

const artifactInput = {
  artifactId: 'artifact-1', taskId: 'task-1', jobKey: base.jobKey, ownerUserId: 'owner-a', tenantId: 'tenant-a',
  snapshotHash: firstHash, format: 'pdf', mimeType: 'application/pdf', sizeBytes: 123, sha256: 'a'.repeat(64),
  pageCount: 2, formulaCount: 3, fallbackCount: 1, effectiveModes: ['latex-vector'], filePath: 'exports/final.pdf',
  expiresAt: '2026-07-20T00:00:00.000Z',
};
assert.strictEqual(recordVerifiedArtifact(db, artifactInput, { now: '2026-07-13T00:00:05.000Z' }).artifact_id, 'artifact-1');
assert.strictEqual(findVerifiedArtifact(db, base.jobKey, firstHash, 'pdf').artifact_id, 'artifact-1');
assert.strictEqual(recordVerifiedArtifact(db, { ...artifactInput, artifactId: 'artifact-duplicate' }).artifact_id, 'artifact-1', 'double execution must reuse one verified artifact');

const txKey = paperJobKey('relay-primary', 'task-tx');
createOrGetPaperJob(db, { ...base, jobKey: txKey, cloudTaskId: 'task-tx', taskId: 'task-tx' });
const txJob = claimPaperJobWithSnapshot(db, txKey, () => [{ id: 'q-tx', stem: 'tx' }], { now: '2026-07-13T00:00:10.000Z' }).job;
stagePaperArtifact(db, { ...artifactInput, artifactId: 'artifact-tx', jobKey: txKey, taskId: 'task-tx', snapshotHash: txJob.snapshot_hash, filePath: 'exports/tx.pdf' });
db.exec(`CREATE TRIGGER fail_job_complete BEFORE UPDATE OF status ON paper_jobs WHEN NEW.job_key='${txKey}' AND NEW.status='completed' BEGIN SELECT RAISE(ABORT,'forced transaction failure'); END;`);
assert.throws(() => recordVerifiedArtifact(db, { ...artifactInput, artifactId: 'artifact-tx', jobKey: txKey, taskId: 'task-tx', snapshotHash: txJob.snapshot_hash, filePath: 'exports/tx.pdf' }), /forced transaction failure/);
assert.strictEqual(db.prepare("SELECT storage_status FROM paper_artifacts WHERE artifact_id='artifact-tx'").get().storage_status, 'staged', 'artifact verification and job completion must roll back together');
db.exec('DROP TRIGGER fail_job_complete');
db.prepare('DELETE FROM paper_artifacts WHERE job_key=?').run(txKey);
db.prepare('DELETE FROM paper_jobs WHERE job_key=?').run(txKey);

const jitterKey = paperJobKey('relay-primary', 'task-jitter');
createOrGetPaperJob(db, { ...base, jobKey: jitterKey, cloudTaskId: 'task-jitter', taskId: 'task-jitter', maxAttempts: 10 });
db.prepare("UPDATE paper_jobs SET status='processing',attempt=3 WHERE job_key=?").run(jitterKey);
const jittered = markPaperJobRetry(db, jitterKey, new Error('retry'), {
  now: '2026-07-13T00:00:00.000Z', baseDelayMs: 1000, maxDelayMs: 2000, jitterRatio: 0.25, random: () => 0,
});
assert.strictEqual(jittered.next_attempt_at, '2026-07-13T00:00:01.500Z', 'retry delay must be capped and use injectable deterministic jitter');

assert.strictEqual(markPaperJobRetry(db, base.jobKey, new Error('last'), { now: '2026-07-13T00:00:06.000Z', baseDelayMs: 1000 }).status, 'failed', 'retry limit must terminate the job');
const cancelled = requestPaperJobCancel(db, base.jobKey, { now: '2026-07-13T00:00:07.000Z' });
assert.ok(cancelled.cancel_requested_at);

const staleKey = paperJobKey('relay-primary', 'task-stale');
createOrGetPaperJob(db, { ...base, jobKey: staleKey, cloudTaskId: 'task-stale', taskId: 'task-stale' }, { now: '2026-07-13T00:00:00.000Z' });
claimPaperJobWithSnapshot(db, staleKey, () => [{ id: 'q3', stem: 'stale' }], { now: '2026-07-13T00:00:01.000Z' });
const recovered = recoverStalePaperJobs(db, { now: '2026-07-13T00:10:00.000Z', staleBefore: '2026-07-13T00:05:00.000Z' });
assert.deepStrictEqual(recovered, [staleKey]);
assert.strictEqual(db.prepare('SELECT status FROM paper_jobs WHERE job_key=?').get(staleKey).status, 'retry_wait');

db.close();
console.log('paper job repository checks passed');
