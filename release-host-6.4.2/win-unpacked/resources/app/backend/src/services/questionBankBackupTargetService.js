const fs = require('fs');
const path = require('path');

function normalizePath(value = '') {
  return String(value || '').trim().replace(/[\\/]+$/, '');
}

function writableProbe(targetPath) {
  const probe = path.join(targetPath, `.gewuprobe-${process.pid}-${Date.now()}`);
  fs.writeFileSync(probe, 'ok', 'utf-8');
  fs.unlinkSync(probe);
}

function inspectBackupTarget(targetPath, options = {}) {
  const label = options.label || 'backup-target';
  const normalized = normalizePath(targetPath);
  if (!normalized) {
    return {
      label,
      path: '',
      available: false,
      status: 'not-configured',
      reason: `${label} path is not configured`,
    };
  }

  try {
    if (!fs.existsSync(normalized)) {
      if (options.create) {
        fs.mkdirSync(normalized, { recursive: true });
      } else {
        throw new Error(`${label} path does not exist`);
      }
    }
    const stat = fs.statSync(normalized);
    if (!stat.isDirectory()) throw new Error(`${label} path is not a directory`);
    writableProbe(normalized);
    return {
      label,
      path: normalized,
      available: true,
      status: 'online',
      reason: '',
    };
  } catch (error) {
    return {
      label,
      path: normalized,
      available: false,
      status: 'offline',
      reason: error.message,
    };
  }
}

function inspectBackupTargets(options = {}) {
  return {
    localCache: inspectBackupTarget(options.localCachePath || process.env.GEWU_LOCAL_CACHE_PATH || '', {
      label: 'local-cache',
      create: true,
    }),
    nasBackup: inspectBackupTarget(options.nasBackupPath || process.env.GEWU_NAS_BACKUP_PATH || '', {
      label: 'nas-backup',
      create: false,
    }),
  };
}

module.exports = {
  inspectBackupTarget,
  inspectBackupTargets,
};
