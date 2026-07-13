const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function inside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function treeHasReparse(target) {
  if (!fs.existsSync(target)) return false;
  const stat = fs.lstatSync(target); if (stat.isSymbolicLink()) return true;
  if (!stat.isDirectory()) return false;
  return fs.readdirSync(target).some(name => treeHasReparse(path.join(target, name)));
}

function pathHasReparse(root, target) {
  const resolvedRoot = path.resolve(root); const resolvedTarget = path.resolve(target);
  if (!inside(resolvedRoot, resolvedTarget)) return true;
  const relative = path.relative(resolvedRoot, resolvedTarget);
  let cursor = resolvedRoot;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    if (!fs.existsSync(cursor)) continue;
    if (fs.lstatSync(cursor).isSymbolicLink()) return true;
  }
  return false;
}

function cleanupPaperStorage(dbLike, authoritativeRoot, options = {}) {
  const db = dbLike.db || dbLike; const now = options.now || new Date().toISOString();
  const root = path.resolve(authoritativeRoot); const tempRoot = path.join(root, 'assets', 'paper-job-temp');
  const exportsRoot = path.join(root, 'assets', 'exports');
  const active = new Set(db.prepare("SELECT temp_dir FROM paper_jobs WHERE status='processing' AND temp_dir IS NOT NULL").all().map(row => path.resolve(row.temp_dir)));
  let removedTempDirs = 0; let expiredArtifacts = 0; let rejectedPaths = 0;
  if (fs.existsSync(tempRoot) && inside(root, tempRoot) && !pathHasReparse(root, tempRoot)) {
    for (const name of fs.readdirSync(tempRoot)) {
      const candidate = path.join(tempRoot, name);
      if (active.has(path.resolve(candidate))) continue;
      if (!inside(tempRoot, candidate) || pathHasReparse(root, candidate) || treeHasReparse(candidate)) { rejectedPaths += 1; continue; }
      fs.rmSync(candidate, { recursive: true, force: true }); removedTempDirs += 1;
    }
  }
  const hasOutbox = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='paper_completion_outbox'").get());
  const expiredSql = `SELECT artifact_id,file_path FROM paper_artifacts a WHERE storage_status IN ('verified','revoked') AND expires_at IS NOT NULL AND expires_at<=?
    ${hasOutbox ? "AND NOT EXISTS (SELECT 1 FROM paper_completion_outbox o WHERE o.artifact_id=a.artifact_id AND o.status IN ('pending','delivering'))" : ''}`;
  const expired = db.prepare(expiredSql).all(now);
  for (const artifact of expired) {
    const file = path.resolve(artifact.file_path);
    if (!inside(exportsRoot, file) || pathHasReparse(root, file) || pathHasReparse(root, `${file}.verified.json`)) { rejectedPaths += 1; continue; }
    if (fs.existsSync(file)) fs.rmSync(file, { force: true });
    if (fs.existsSync(`${file}.verified.json`)) fs.rmSync(`${file}.verified.json`, { force: true });
    db.prepare("UPDATE paper_artifacts SET storage_status='expired' WHERE artifact_id=? AND storage_status IN ('verified','revoked')").run(artifact.artifact_id);
    expiredArtifacts += 1;
  }
  return { removedTempDirs, expiredArtifacts, rejectedPaths };
}

function reconcilePaperArtifacts(dbLike, authoritativeRoot, options = {}) {
  const db = dbLike.db || dbLike; const now = options.now || new Date().toISOString();
  const root = path.resolve(authoritativeRoot); const exportsRoot = path.join(root, 'assets', 'exports');
  let recovered = 0; let abandoned = 0; let missing = 0; let rejectedPaths = 0;
  for (const artifact of db.prepare("SELECT * FROM paper_artifacts WHERE storage_status IN ('staged','verified')").all()) {
    const file = path.resolve(artifact.file_path); const sidecar = `${file}.verified.json`;
    if (!inside(exportsRoot, file) || pathHasReparse(root, file) || pathHasReparse(root, sidecar)) { rejectedPaths += 1; continue; }
    if (artifact.storage_status === 'staged') {
      if (fs.existsSync(file) && fs.existsSync(sidecar)) {
        let evidence;
        try { evidence = JSON.parse(fs.readFileSync(sidecar, 'utf8')); } catch (_error) { evidence = null; }
        const bytes = fs.readFileSync(file); const digest = crypto.createHash('sha256').update(bytes).digest('hex');
        if (evidence?.artifactId === artifact.artifact_id && evidence?.jobKey === artifact.job_key
          && evidence?.snapshotHash === artifact.snapshot_hash && evidence?.sha256 === digest && Number(evidence.sizeBytes) === bytes.length) {
          db.prepare(`UPDATE paper_artifacts SET size_bytes=?,sha256=?,page_count=?,formula_count=?,fallback_count=?,
            effective_modes_json=?,storage_status='verified' WHERE artifact_id=? AND storage_status='staged'`)
            .run(bytes.length, digest, evidence.pageCount ?? null, Number(evidence.formulaCount || 0), Number(evidence.fallbackCount || 0),
              JSON.stringify(evidence.effectiveFormulaModes || []), artifact.artifact_id);
          db.prepare("UPDATE paper_jobs SET artifact_id=?,status='completed',phase='completed',progress=100,completed_at=?,updated_at=? WHERE job_key=?")
            .run(artifact.artifact_id, now, now, artifact.job_key);
          recovered += 1; continue;
        }
      }
      if (fs.existsSync(file)) fs.rmSync(file, { force: true });
      if (fs.existsSync(sidecar)) fs.rmSync(sidecar, { force: true });
      db.prepare("UPDATE paper_artifacts SET storage_status='abandoned' WHERE artifact_id=? AND storage_status='staged'").run(artifact.artifact_id);
      db.prepare("UPDATE paper_jobs SET status='retry_wait',phase='recovered',next_attempt_at=?,updated_at=? WHERE job_key=? AND status!='completed'").run(now, now, artifact.job_key);
      const job = db.prepare('SELECT temp_dir FROM paper_jobs WHERE job_key=?').get(artifact.job_key);
      if (job?.temp_dir && inside(path.join(root, 'assets', 'paper-job-temp'), job.temp_dir) && !pathHasReparse(root, job.temp_dir) && !treeHasReparse(job.temp_dir)) fs.rmSync(job.temp_dir, { recursive: true, force: true });
      abandoned += 1;
    } else if (!fs.existsSync(file)) {
      db.prepare("UPDATE paper_artifacts SET storage_status='missing' WHERE artifact_id=? AND storage_status='verified'").run(artifact.artifact_id);
      db.prepare("UPDATE paper_jobs SET status='failed',phase='artifact_missing',updated_at=? WHERE job_key=?").run(now, artifact.job_key);
      missing += 1;
    } else {
      const job = db.prepare('SELECT status FROM paper_jobs WHERE job_key=?').get(artifact.job_key);
      if (job && job.status !== 'completed') {
        db.prepare("UPDATE paper_jobs SET artifact_id=?,status='completed',phase='completed',progress=100,completed_at=COALESCE(completed_at,?),updated_at=? WHERE job_key=?")
          .run(artifact.artifact_id, now, now, artifact.job_key);
        recovered += 1;
      }
    }
  }
  return { recovered, abandoned, missing, rejectedPaths };
}

module.exports = { cleanupPaperStorage, reconcilePaperArtifacts };
