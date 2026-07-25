const fs = require('fs');
const path = require('path');
const { inspectBackupTarget } = require('./questionBankBackupTargetService');

function emptyStatus(label, targetPath = '', status = 'not-configured', reason = `${label} path is not configured`) {
  return {
    label,
    path: targetPath,
    available: false,
    status,
    reason,
  };
}

function archiveFileToTarget(artifactPath, targetPath, options = {}) {
  const label = options.label || 'archive-target';
  const create = Boolean(options.create);
  if (!targetPath) return emptyStatus(label);

  const targetStatus = inspectBackupTarget(targetPath, { label, create });
  if (!targetStatus.available) return targetStatus;

  const now = options.now instanceof Date ? options.now : new Date();
  const monthFolder = now.toISOString().slice(0, 7);
  const archiveDir = path.join(targetStatus.path, monthFolder);
  fs.mkdirSync(archiveDir, { recursive: true });
  const artifactName = options.fileName || path.basename(artifactPath);
  const archivePath = path.join(archiveDir, artifactName);
  fs.copyFileSync(artifactPath, archivePath);
  return {
    ...targetStatus,
    status: 'archived',
    artifactPath: archivePath,
  };
}

function archiveBackupArtifact(artifactPath, options = {}) {
  if (!artifactPath || !fs.existsSync(artifactPath)) {
    throw new Error('backup artifact path does not exist');
  }
  const now = options.now instanceof Date ? options.now : new Date();
  const fileName = options.fileName || path.basename(artifactPath);
  return {
    localCache: archiveFileToTarget(artifactPath, options.localCachePath || '', {
      label: 'local-cache',
      create: true,
      now,
      fileName,
    }),
    nasBackup: archiveFileToTarget(artifactPath, options.nasBackupPath || '', {
      label: 'nas-backup',
      create: false,
      now,
      fileName,
    }),
  };
}

module.exports = {
  archiveBackupArtifact,
};
