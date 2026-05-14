#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const { createBackupJob } = require(path.join(root, 'backend', 'src', 'routes', 'export'));
const { getInstance } = require(path.join(root, 'backend', 'src', 'database'));

function arg(name, fallback = null) {
  const prefix = `--${name}=`;
  const match = process.argv.find(item => item.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyToDataLake(job) {
  const dataLakeDir = process.env.DATA_LAKE_DIR || arg('data-lake-dir');
  if (!dataLakeDir || !job.artifactPath) return null;
  const date = new Date(job.createdAt || Date.now()).toISOString().slice(0, 10);
  const targetDir = path.join(dataLakeDir, 'scheduling-system', date);
  ensureDir(targetDir);
  const target = path.join(targetDir, path.basename(job.artifactPath));
  fs.copyFileSync(job.artifactPath, target);
  return target;
}

function pruneBackups(dir, retentionDays) {
  if (!dir || !fs.existsSync(dir) || !Number.isFinite(retentionDays) || retentionDays <= 0) {
    return { deleted: 0 };
  }
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let deleted = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const file = path.join(dir, entry.name);
    if (fs.statSync(file).mtimeMs < cutoff) {
      fs.unlinkSync(file);
      deleted += 1;
    }
  }
  return { deleted };
}

function main() {
  const retentionDays = Number(arg('retention-days', process.env.BACKUP_RETENTION_DAYS || 30));
  const scheduleCron = arg('schedule-cron', process.env.BACKUP_SCHEDULE_CRON || 'manual');
  const tenantId = arg('tenant-id', process.env.DEFAULT_TENANT_ID || 'default');

  const job = createBackupJob({ tenantId, scheduleCron, retentionDays });
  const dataLakePath = copyToDataLake(job);
  const backupDir = process.env.BACKUP_DIR || path.join(root, 'backend', 'data', 'backups');
  const pruned = pruneBackups(backupDir, retentionDays);

  const service = getInstance();
  service.db.prepare(
    `UPDATE data_archive_jobs SET oss_key = COALESCE(oss_key, ?), oss_url = COALESCE(oss_url, ?), updated_at = ?
     WHERE id = ?`
  ).run(dataLakePath, dataLakePath, new Date().toISOString(), job.id);

  process.stdout.write(JSON.stringify({
    success: true,
    jobId: job.id,
    status: job.status,
    artifactPath: job.artifactPath,
    dataLakePath,
    pruned,
  }, null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(JSON.stringify({ success: false, error: err.message }, null, 2));
    process.exit(1);
  }
}
