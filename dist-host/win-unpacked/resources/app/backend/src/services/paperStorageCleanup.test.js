const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { ensurePaperJobSchema } = require('./paperJobRepository');
const { cleanupPaperStorage } = require('./paperStorageCleanup');

const db = new Database(':memory:'); ensurePaperJobSchema(db);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-paper-cleanup-'));
try {
  const tempRoot = path.join(root, 'assets', 'paper-job-temp'); const exportRoot = path.join(root, 'assets', 'exports');
  const active = path.join(tempRoot, 'active'); const stale = path.join(tempRoot, 'stale');
  fs.mkdirSync(active, { recursive: true }); fs.mkdirSync(stale, { recursive: true });
  fs.writeFileSync(path.join(active, 'keep.tmp'), 'active'); fs.writeFileSync(path.join(stale, 'delete.tmp'), 'stale');
  db.prepare(`INSERT INTO paper_jobs(job_key,relay_scope,cloud_task_id,task_id,tenant_id,owner_user_id,request_hash,status,phase,progress,attempt,max_attempts,temp_dir,created_at,updated_at)
    VALUES('active-job','r','t','t','tenant','owner','hash','processing','rendering',10,1,3,?,'2026-07-13T00:00:00.000Z','2026-07-13T00:00:00.000Z')`).run(active);
  fs.mkdirSync(exportRoot, { recursive: true });
  const expired = path.join(exportRoot, 'expired.pdf'); const current = path.join(exportRoot, 'current.pdf'); const pending = path.join(exportRoot, 'pending.pdf');
  fs.writeFileSync(expired, 'expired'); fs.writeFileSync(current, 'current');
  fs.writeFileSync(`${expired}.verified.json`, '{}'); fs.writeFileSync(pending, 'pending'); fs.writeFileSync(`${pending}.verified.json`, '{}');
  const artifactSql = `INSERT INTO paper_artifacts(artifact_id,task_id,job_key,owner_user_id,tenant_id,snapshot_hash,format,mime_type,size_bytes,sha256,page_count,formula_count,fallback_count,effective_modes_json,file_path,created_at,expires_at,storage_status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'verified')`;
  db.prepare(artifactSql).run('expired','t1','j1','owner','tenant','s1','pdf','application/pdf',7,'a',1,0,0,'[]',expired,'2026-07-01T00:00:00.000Z','2026-07-12T00:00:00.000Z');
  db.prepare(artifactSql).run('current','t2','j2','owner','tenant','s2','pdf','application/pdf',7,'b',1,0,0,'[]',current,'2026-07-01T00:00:00.000Z','2026-07-20T00:00:00.000Z');
  db.prepare(artifactSql).run('pending','t3','j3','owner','tenant','s3','pdf','application/pdf',7,'c',1,0,0,'[]',pending,'2026-07-01T00:00:00.000Z','2026-07-12T00:00:00.000Z');
  const revoked = path.join(exportRoot, 'revoked.pdf'); fs.writeFileSync(revoked, 'revoked'); fs.writeFileSync(`${revoked}.verified.json`, '{}');
  db.prepare(artifactSql).run('revoked','t5','j5','owner','tenant','s5','pdf','application/pdf',7,'e',1,0,0,'[]',revoked,'2026-07-01T00:00:00.000Z','2026-07-12T00:00:00.000Z');
  db.prepare("UPDATE paper_artifacts SET storage_status='revoked' WHERE artifact_id='revoked'").run();
  db.exec("CREATE TABLE paper_completion_outbox(artifact_id TEXT,status TEXT); INSERT INTO paper_completion_outbox VALUES('pending','pending')");
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-paper-cleanup-outside-')); const outsideFile = path.join(outside, 'outside.pdf'); fs.writeFileSync(outsideFile, 'outside');
  const linkedParent = path.join(exportRoot, 'linked-parent'); fs.symlinkSync(outside, linkedParent, process.platform === 'win32' ? 'junction' : 'dir');
  db.prepare(artifactSql).run('junction','t4','j4','owner','tenant','s4','pdf','application/pdf',7,'d',1,0,0,'[]',path.join(linkedParent, 'outside.pdf'),'2026-07-01T00:00:00.000Z','2026-07-12T00:00:00.000Z');
  const result = cleanupPaperStorage(db, root, { now: '2026-07-13T00:00:00.000Z' });
  assert.ok(fs.existsSync(active)); assert.strictEqual(fs.existsSync(stale), false);
  assert.strictEqual(fs.existsSync(expired), false); assert.strictEqual(fs.existsSync(`${expired}.verified.json`), false); assert.ok(fs.existsSync(current));
  assert.ok(fs.existsSync(pending), 'pending completion outbox must protect an expired artifact'); assert.ok(fs.existsSync(`${pending}.verified.json`));
  assert.strictEqual(fs.existsSync(revoked), false, 'expired revoked artifacts must be physically cleaned'); assert.strictEqual(fs.existsSync(`${revoked}.verified.json`), false);
  assert.ok(fs.existsSync(outsideFile), 'cleanup must reject a path whose parent chain contains a junction/reparse point');
  assert.strictEqual(db.prepare("SELECT storage_status FROM paper_artifacts WHERE artifact_id='expired'").get().storage_status, 'expired');
  assert.deepStrictEqual(result, { removedTempDirs: 1, expiredArtifacts: 2, rejectedPaths: 1 });
  fs.rmSync(outside, { recursive: true, force: true });
} finally { db.close(); fs.rmSync(root, { recursive: true, force: true }); }
console.log('paper storage cleanup checks passed');
