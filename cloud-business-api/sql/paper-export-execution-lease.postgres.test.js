'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createDisposablePg17Runtime, withVNextPg17SyntheticQuery: withQuery } = require('../../shared/vnext-pg17/disposableRuntime');
const { createPaperExportTaskRepository } = require('../src/paperExportTaskRepository');
const { createPaperExportArtifactRepository } = require('../src/paperExportArtifactRepository');

module.exports = (async () => {
  const migration = fs.readFileSync(path.join(__dirname, '20260913-paper-export-execution-lease.sql'), 'utf8');
  const runtime = createDisposablePg17Runtime();
  await runtime.start(); const handle = await runtime.createIsolatedHandle();
  try {
    await withQuery(handle, 'fixture-provisioner', async db => {
      await db.query("CREATE SCHEMA business; CREATE ROLE gewu_cloud_schedule_reader; CREATE TABLE business.tenants(id text PRIMARY KEY); INSERT INTO business.tenants VALUES ('tenant')");
      await db.query('CREATE TABLE business.storage_object_tasks(task_id text PRIMARY KEY,object_id text,object_version integer,expected_sha256 text,expected_bytes bigint,media_type text,state text)');
      for (const file of ['20260823-cloud-paper-export-tasks.sql','20260823-paper-export-artifact-storage.sql','20260823-paper-export-task-results.sql']) {
        await db.query(fs.readFileSync(path.join(__dirname, file), 'utf8'));
      }
      await db.query(migration); await db.query(migration);
      const query = db.query.bind(db);
      const repo = createPaperExportTaskRepository({ query });
      const put = async (id, status = 'queued', phase = 'queued') => db.query(
        "INSERT INTO business.paper_export_tasks(task_id,tenant_id,account_id,idempotency_key,task_type,request_json,request_hash,question_snapshot_json,status,phase) VALUES($1,'tenant','account',$1,'paper-export-word','{}',$2,'[]',$3,$4)",
        [id, 'a'.repeat(64), status, phase]);
      const read = async id => (await db.query('SELECT * FROM business.paper_export_tasks WHERE task_id=$1', [id])).rows[0];
      const expire = async id => db.query("UPDATE business.paper_export_tasks SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE task_id=$1", [id]);
      await put('paper_task_legacy', 'processing', 'rendering');
      await put('paper_task_live');
      const task = await repo.claimNext();
      assert.equal(task.taskId, 'paper_task_live'); assert.match(task.claimToken, /^[0-9a-f-]{36}$/);
      assert.equal(await repo.claimNext(), null, 'another worker cannot claim an active render');
      await repo.renew({ taskId: task.taskId, claimToken: task.claimToken });
      const wrong = { taskId: task.taskId, claimToken: crypto.randomUUID() };
      for (const fn of [() => repo.renew(wrong), () => repo.defer(wrong), () => repo.fail({ ...wrong, code: 'BAD' }), () => repo.complete({ ...wrong, artifact: { artifactId: 'paper_artifact_fake0000' } })]) {
        await assert.rejects(fn, /CLOUD_PAPER_EXPORT_CLAIM_LOST/);
      }
      const keys = crypto.generateKeyPairSync('x25519');
      const archive = createPaperExportArtifactRepository({ query, agentPublicKey: keys.publicKey.export({type:'spki',format:'der'}).toString('base64url') });
      const input = { taskId: task.taskId, claimToken: task.claimToken, tenantId:'tenant',accountId:'account',format:'word',fileName:'paper.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',bytes:Buffer.from('fixture') };
      await assert.rejects(() => archive.archive({ ...input, claimToken: wrong.claimToken }), /CLOUD_PAPER_EXPORT_CLAIM_LOST/);
      assert.equal((await db.query('SELECT count(*)::int n FROM business.storage_object_tasks')).rows[0].n, 0, 'lost owners create no storage jobs');
      await repo.defer({ taskId: task.taskId, claimToken: task.claimToken });
      await assert.rejects(() => repo.renew({ taskId: task.taskId, claimToken: task.claimToken }), /CLOUD_PAPER_EXPORT_CLAIM_LOST/);
      await db.query("UPDATE business.paper_export_tasks SET updated_at=clock_timestamp()-interval '6 seconds' WHERE task_id=$1", [task.taskId]);
      const retry = await repo.claimNext(); assert.notEqual(retry.claimToken, task.claimToken);
      await assert.rejects(() => archive.archive(input), /CLOUD_PAPER_EXPORT_CLAIM_LOST/);
      await expire(retry.taskId);
      await assert.rejects(() => repo.renew({ taskId: retry.taskId, claimToken: retry.claimToken }), /CLOUD_PAPER_EXPORT_CLAIM_LOST/);
      assert.equal(await repo.claimNext(), null, 'expired work is failed, never silently rerendered');
      const failed = await read(retry.taskId);
      assert.equal(failed.status, 'failed'); assert.equal(failed.error_code, 'CLOUD_PAPER_EXPORT_INTERRUPTED');
      assert.equal((await read('paper_task_legacy')).status, 'processing', 'legacy work without an owner requires explicit reviewed recovery');
      await assert.rejects(() => archive.archive({ ...input, claimToken: retry.claimToken }), /CLOUD_PAPER_EXPORT_CLAIM_LOST/);
      await put('paper_task_archive'); const active = await repo.claimNext();
      const artifact = await archive.archive({ ...input, taskId: active.taskId, claimToken: active.claimToken });
      assert.equal((await read(active.taskId)).phase, 'storage_pending', 'artifact and task attachment must commit atomically');
      await expire(active.taskId); await repo.claimNext();
      assert.equal((await read(active.taskId)).phase, 'storage_pending', 'lease recovery cannot fail an already archived task');
      await repo.complete({ taskId: active.taskId, claimToken: active.claimToken, artifact });
      await assert.rejects(() => repo.fail({ taskId: active.taskId, claimToken: active.claimToken, code:'NETWORK' }), /CLOUD_PAPER_EXPORT_CLAIM_LOST/);
      assert.equal((await db.query('SELECT count(*)::int n FROM business.storage_object_tasks')).rows[0].n, 1);
      await put('paper_task_race');
      const claims = await Promise.all([0,1].map(() => withQuery(handle, 'fixture-provisioner', async other =>
        createPaperExportTaskRepository({ query: other.query.bind(other) }).claimNext())));
      assert.equal(claims.filter(Boolean).length, 1, 'independent database connections cannot both claim one task');
      assert.equal(claims.find(Boolean).taskId, 'paper_task_race');
      await assert.rejects(() => repo.renew({taskId:'paper_task_race'}), /CLOUD_PAPER_EXPORT_INPUT_INVALID/);
    });
    console.log('paper export real PostgreSQL lease, stale owner, and atomic archive checks passed');
  } finally { await runtime.disposeHandle(handle); await runtime.stop(); }
})();
if (require.main === module) module.exports.catch(error => { console.error(error); process.exitCode = 1; });
