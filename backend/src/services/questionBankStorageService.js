const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function now() {
  return new Date().toISOString();
}

function storeId() {
  return `qb_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function manifestPath(root) {
  return path.join(root, 'manifest.json');
}

function requiredDirs(root) {
  return [
    path.join(root, 'assets'),
    path.join(root, 'assets', 'images'),
    path.join(root, 'assets', 'word-imports'),
    path.join(root, 'assets', 'exports'),
    path.join(root, 'backups'),
  ];
}

function initQuestionBankStore(root, options = {}) {
  if (!root) throw new Error('question bank root is required');
  ensureDir(root);
  requiredDirs(root).forEach(ensureDir);

  const file = manifestPath(root);
  let manifest;
  if (fs.existsSync(file)) {
    manifest = JSON.parse(fs.readFileSync(file, 'utf-8'));
  } else {
    manifest = {
      storeId: storeId(),
      schemaVersion: 1,
      createdAt: now(),
      lastMountedByDeviceId: options.deviceId || '',
      lastVerifiedAt: now(),
    };
  }

  manifest.schemaVersion = Number(manifest.schemaVersion || 1);
  manifest.lastMountedByDeviceId = options.deviceId || manifest.lastMountedByDeviceId || '';
  manifest.lastVerifiedAt = now();
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2), 'utf-8');
  return manifest;
}

function inspectQuestionBankStore(root) {
  if (!root || !fs.existsSync(root)) throw new Error('question bank store is not available');
  const file = manifestPath(root);
  if (!fs.existsSync(file)) throw new Error('question bank manifest is missing');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf-8'));
  const missingDirs = requiredDirs(root).filter(dir => !fs.existsSync(dir));
  return { available: missingDirs.length === 0, root, manifest, missingDirs };
}

function offlineStore(root, error) {
  return {
    available: false,
    status: 'offline',
    root,
    manifest: null,
    missingDirs: [],
    reason: error?.message || 'question bank store is offline',
  };
}

function scanQuestionBankStores(candidateRoots = []) {
  return Array.from(new Set(candidateRoots.filter(Boolean))).map(root => {
    try {
      const inspected = inspectQuestionBankStore(root);
      return {
        ...inspected,
        status: inspected.available ? 'online' : 'incomplete',
        reason: inspected.available ? '' : 'question bank store is incomplete',
      };
    } catch (error) {
      return offlineStore(root, error);
    }
  });
}

function findQuestionBankStore(candidateRoots = [], options = {}) {
  const scanned = scanQuestionBankStores(candidateRoots);
  const online = scanned.filter(item => item.available);
  const matched = options.storeId
    ? online.find(item => item.manifest?.storeId === options.storeId)
    : online[0];

  if (matched) return matched;

  return {
    available: false,
    status: 'offline',
    root: '',
    manifest: null,
    missingDirs: [],
    candidates: scanned,
    reason: options.storeId
      ? `question bank store ${options.storeId} is not connected`
      : 'no question bank store is connected',
  };
}

function assertQuestionBankWritable(root, options = {}) {
  const inspected = inspectQuestionBankStore(root);
  if (!inspected.available) throw new Error('question bank store is incomplete');
  if (options.nodeRole !== 'primary-host') {
    throw new Error('Only primary-host can write to question bank removable storage');
  }
  return inspected;
}

function resolveQuestionAssetPath(root, category, fileName) {
  const safeName = path.basename(fileName);
  const folder = category === 'word-imports' || category === 'exports' ? category : 'images';
  return path.join(root, 'assets', folder, safeName);
}

module.exports = {
  initQuestionBankStore,
  inspectQuestionBankStore,
  assertQuestionBankWritable,
  scanQuestionBankStores,
  findQuestionBankStore,
  resolveQuestionAssetPath,
};
