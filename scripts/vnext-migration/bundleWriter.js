'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  canonicalJson,
  validateLedgerEntry,
  validateManifest,
} = require('../../shared/migrationBundleProtocol');

const PAYLOAD_FILES = Object.freeze([
  'manifest.json',
  'reports/inventory.json',
  'reports/migration-ledger.json',
  'reports/unresolved.json',
]);
const BUNDLE_FILES = Object.freeze([...PAYLOAD_FILES, 'checksums/sha256sums.json']);
const BUNDLE_DIRECTORIES = Object.freeze(['checksums', 'reports']);

function bundleError(code, cause) {
  return Object.assign(new Error(code), { code, cause });
}

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function comparablePath(value) {
  const normalized = path.normalize(path.resolve(value)).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function assertCreatedAtExpectedPath(createdPath, expectedPath) {
  if (comparablePath(fs.realpathSync(createdPath)) !== comparablePath(expectedPath)) {
    throw bundleError('MIGRATION_BUNDLE_PATH_REDIRECTED');
  }
}

function canonicalBuffer(value) {
  return Buffer.from(`${canonicalJson(value)}\n`, 'utf8');
}

function readJson(filePath, invalidCode) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw bundleError(invalidCode, error);
  }
}

function ensureDirectory(value, code) {
  const resolved = path.resolve(String(value || ''));
  if (!value || !fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw bundleError(code);
  }
  return resolved;
}

function listBundleFiles(root, relative = '') {
  const files = [];
  for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!BUNDLE_DIRECTORIES.includes(child)) throw bundleError('MIGRATION_BUNDLE_UNEXPECTED_FILE');
      files.push(...listBundleFiles(root, child));
    }
    else if (entry.isFile()) files.push(child);
    else throw bundleError('MIGRATION_BUNDLE_UNEXPECTED_FILE');
  }
  return files.sort();
}

function validateUnresolvedEntry(input = {}) {
  const fields = Object.keys(input).sort();
  if (canonicalJson(fields) !== canonicalJson(['code', 'kind', 'pathHash', 'sourceId'])) {
    throw bundleError('MIGRATION_BUNDLE_UNRESOLVED_INVALID');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(String(input.sourceId || ''))
    || !/^[a-f0-9]{64}$/.test(String(input.pathHash || ''))
    || input.code !== 'MIGRATION_CONFIGURED_SOURCE_UNAVAILABLE'
    || typeof input.kind !== 'string' || !input.kind) {
    throw bundleError('MIGRATION_BUNDLE_UNRESOLVED_INVALID');
  }
  return { sourceId: input.sourceId, kind: input.kind, pathHash: input.pathHash, code: input.code };
}

function validateSemanticCoverage({ manifest, inventory, ledger, unresolved }) {
  if (!inventory || inventory.schemaVersion !== 1 || !inventory.sources
    || typeof inventory.sources !== 'object' || Array.isArray(inventory.sources)) {
    throw bundleError('MIGRATION_BUNDLE_INVENTORY_INVALID');
  }
  if (!Array.isArray(ledger)) throw bundleError('MIGRATION_BUNDLE_LEDGER_INVALID');
  if (!Array.isArray(unresolved)) throw bundleError('MIGRATION_BUNDLE_UNRESOLVED_INVALID');
  const validatedUnresolved = unresolved.map(validateUnresolvedEntry);
  const manifestIds = manifest.sources.map(source => source.sourceId).sort();
  const inventoryIds = Object.keys(inventory.sources).sort();
  const ledgerIds = ledger.map(entry => entry.sourceId).sort();
  const declaredInventoryIds = [...new Set(manifest.sources
    .filter(source => source.availability === 'available')
    .map(source => source.inventoryId))].sort();
  if (canonicalJson(manifestIds) !== canonicalJson(ledgerIds)
    || canonicalJson(declaredInventoryIds) !== canonicalJson(inventoryIds)) {
    throw bundleError('MIGRATION_BUNDLE_SOURCE_COVERAGE_INVALID');
  }
  for (const source of manifest.sources) {
    const entry = ledger.find(item => item.sourceId === source.sourceId);
    const unresolvedEntry = validatedUnresolved.find(item => item.sourceId === source.sourceId);
    if (!entry || entry.sourceType !== source.kind) {
      throw bundleError('MIGRATION_BUNDLE_SOURCE_COVERAGE_INVALID');
    }
    if (source.availability === 'available') {
      const report = inventory.sources[source.inventoryId];
      if (!report || unresolvedEntry || entry.sourceHash !== report.inventoryHash || entry.status !== 'discovered') {
        throw bundleError('MIGRATION_BUNDLE_SOURCE_COVERAGE_INVALID');
      }
    } else if (!unresolvedEntry || unresolvedEntry.kind !== source.kind
      || unresolvedEntry.pathHash !== source.pathHash || entry.sourceHash !== null
      || entry.status !== 'unavailable'
      || entry.conflictCode !== 'MIGRATION_CONFIGURED_SOURCE_UNAVAILABLE') {
      throw bundleError('MIGRATION_BUNDLE_SOURCE_COVERAGE_INVALID');
    }
  }
  if (validatedUnresolved.length !== manifest.sources.filter(source => source.availability === 'unavailable').length) {
    throw bundleError('MIGRATION_BUNDLE_SOURCE_COVERAGE_INVALID');
  }
  return validatedUnresolved;
}

function verifyInventoryBundle({ bundlePath } = {}) {
  const root = ensureDirectory(bundlePath, 'MIGRATION_BUNDLE_MISSING');
  if (canonicalJson(listBundleFiles(root)) !== canonicalJson([...BUNDLE_FILES].sort())) {
    throw bundleError('MIGRATION_BUNDLE_UNEXPECTED_FILE');
  }
  const manifest = validateManifest(readJson(path.join(root, 'manifest.json'), 'MIGRATION_BUNDLE_MANIFEST_INVALID'));
  const checksumPath = path.join(root, 'checksums', 'sha256sums.json');
  const checksumDocument = readJson(checksumPath, 'MIGRATION_BUNDLE_CHECKSUMS_INVALID');
  if (!checksumDocument || checksumDocument.algorithm !== 'sha256'
    || !checksumDocument.files || typeof checksumDocument.files !== 'object') {
    throw bundleError('MIGRATION_BUNDLE_CHECKSUMS_INVALID');
  }
  const names = Object.keys(checksumDocument.files).sort();
  if (canonicalJson(names) !== canonicalJson([...PAYLOAD_FILES].sort())) {
    throw bundleError('MIGRATION_BUNDLE_CHECKSUMS_INVALID');
  }

  const verifiedFiles = {};
  for (const relativePath of PAYLOAD_FILES) {
    const absolutePath = path.join(root, ...relativePath.split('/'));
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
      throw bundleError('MIGRATION_BUNDLE_FILE_MISSING');
    }
    const buffer = fs.readFileSync(absolutePath);
    const actual = sha256Buffer(buffer);
    if (actual !== checksumDocument.files[relativePath]) {
      throw bundleError('MIGRATION_BUNDLE_CHECKSUM_MISMATCH');
    }
    verifiedFiles[relativePath] = actual;
  }
  const bundleHash = sha256Buffer(canonicalBuffer({ files: verifiedFiles }));
  if (checksumDocument.bundleHash !== bundleHash) {
    throw bundleError('MIGRATION_BUNDLE_CHECKSUM_MISMATCH');
  }
  const inventory = readJson(path.join(root, 'reports', 'inventory.json'), 'MIGRATION_BUNDLE_INVENTORY_INVALID');
  const ledger = readJson(path.join(root, 'reports', 'migration-ledger.json'), 'MIGRATION_BUNDLE_LEDGER_INVALID')
    .map(validateLedgerEntry);
  const unresolved = readJson(path.join(root, 'reports', 'unresolved.json'), 'MIGRATION_BUNDLE_UNRESOLVED_INVALID');
  validateSemanticCoverage({ manifest, inventory, ledger, unresolved });
  return Object.freeze({
    bundleId: manifest.bundleId,
    bundleHash,
    fileCount: PAYLOAD_FILES.length,
  });
}

function writeInventoryBundle({ bundlePath, manifest, inventory, ledger, unresolved, testHooks = {} } = {}) {
  const finalPath = path.resolve(String(bundlePath || ''));
  if (!bundlePath) throw bundleError('MIGRATION_BUNDLE_PATH_REQUIRED');
  const partialPath = `${finalPath}.partial`;
  if (fs.existsSync(finalPath)) throw bundleError('MIGRATION_BUNDLE_ALREADY_EXISTS');
  if (fs.existsSync(partialPath)) throw bundleError('MIGRATION_BUNDLE_PARTIAL_EXISTS');
  const parent = path.dirname(finalPath);
  if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) {
    throw bundleError('MIGRATION_BUNDLE_PARENT_MISSING');
  }

  const validatedManifest = validateManifest(manifest);
  if (!Array.isArray(ledger)) throw bundleError('MIGRATION_BUNDLE_LEDGER_INVALID');
  const validatedLedger = ledger.map(validateLedgerEntry);
  if (!Array.isArray(unresolved)) throw bundleError('MIGRATION_BUNDLE_UNRESOLVED_INVALID');
  const payloads = {
    'manifest.json': validatedManifest,
    'reports/inventory.json': inventory || {},
    'reports/migration-ledger.json': validatedLedger,
    'reports/unresolved.json': unresolved,
  };
  const validatedUnresolved = validateSemanticCoverage({
    manifest: validatedManifest,
    inventory: payloads['reports/inventory.json'],
    ledger: validatedLedger,
    unresolved,
  });
  payloads['reports/unresolved.json'] = validatedUnresolved;

  let renamed = false;
  let safePartial = false;
  try {
    if (typeof testHooks.beforePartialCreate === 'function') testHooks.beforePartialCreate();
    if (comparablePath(path.dirname(finalPath)) !== comparablePath(fs.realpathSync(path.dirname(finalPath)))) {
      throw bundleError('MIGRATION_BUNDLE_PATH_REDIRECTED');
    }
    fs.mkdirSync(path.join(partialPath, 'reports'), { recursive: true });
    assertCreatedAtExpectedPath(partialPath, partialPath);
    safePartial = true;
    fs.mkdirSync(path.join(partialPath, 'checksums'));
    const hashes = {};
    for (const relativePath of PAYLOAD_FILES) {
      const buffer = canonicalBuffer(payloads[relativePath]);
      const absolutePath = path.join(partialPath, ...relativePath.split('/'));
      fs.writeFileSync(absolutePath, buffer, { flag: 'wx' });
      const readBack = fs.readFileSync(absolutePath);
      if (!readBack.equals(buffer)) throw bundleError('MIGRATION_BUNDLE_READBACK_FAILED');
      hashes[relativePath] = sha256Buffer(readBack);
    }
    const bundleHash = sha256Buffer(canonicalBuffer({ files: hashes }));
    const checksums = { schemaVersion: 1, algorithm: 'sha256', files: hashes, bundleHash };
    fs.writeFileSync(
      path.join(partialPath, 'checksums', 'sha256sums.json'),
      canonicalBuffer(checksums),
      { flag: 'wx' },
    );
    verifyInventoryBundle({ bundlePath: partialPath });
    fs.renameSync(partialPath, finalPath);
    renamed = true;
    return verifyInventoryBundle({ bundlePath: finalPath });
  } catch (error) {
    if (error && String(error.code || '').startsWith('MIGRATION_')) throw error;
    throw bundleError('MIGRATION_BUNDLE_WRITE_FAILED', error);
  } finally {
    if (!renamed && safePartial && fs.existsSync(partialPath)) {
      try {
        fs.writeFileSync(path.join(partialPath, 'FAILED'), 'incomplete\n', { encoding: 'utf8', flag: 'wx' });
      } catch (_) {
        // Preserve the partial directory as evidence; never overwrite it.
      }
    }
  }
}

module.exports = { verifyInventoryBundle, writeInventoryBundle };
