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
  resolveQuestionAssetPath,
};
