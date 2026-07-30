const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const DEFAULT_TARGETS = Object.freeze(['desktop', 'local_host', 'backend', 'gateway', 'miniapp']);
const MANIFEST_SCHEMA = 'gewu.unified-release.v1';

function defaultManifestPath(rootDir = path.resolve(__dirname, '..')) {
  return path.join(rootDir, 'output', 'release-matrix', 'active.json');
}

function isVersion(value) {
  return /^\d+\.\d+\.\d+$/.test(String(value || ''));
}

function createReleaseManifest({ version, commit, createdAt = new Date().toISOString(), targets = DEFAULT_TARGETS } = {}) {
  if (!isVersion(version)) throw new Error(`Invalid unified release version: ${version || '<empty>'}`);
  if (!commit || typeof commit !== 'string') throw new Error('A source commit is required for a unified release manifest');
  const targetState = {};
  for (const target of targets) {
    targetState[target] = { status: 'pending' };
  }
  return {
    schema: MANIFEST_SCHEMA,
    version,
    commit,
    createdAt,
    targets: targetState,
  };
}

function validateManifest(manifest) {
  const issues = [];
  if (!manifest || typeof manifest !== 'object') {
    issues.push('release manifest is missing or invalid');
    return { issues };
  }
  if (manifest.schema !== MANIFEST_SCHEMA) issues.push(`release manifest schema must be ${MANIFEST_SCHEMA}`);
  if (!isVersion(manifest.version)) issues.push(`release manifest version is invalid: ${manifest.version || '<empty>'}`);
  if (!manifest.commit || typeof manifest.commit !== 'string') issues.push('release manifest commit is missing');
  if (!manifest.targets || typeof manifest.targets !== 'object') {
    issues.push('release manifest targets are missing');
  } else {
    for (const target of DEFAULT_TARGETS) {
      const state = manifest.targets[target];
      if (!state || !['pending', 'verified'].includes(state.status)) {
        issues.push(`release target ${target} must be pending or verified`);
      }
      if (state?.status === 'verified' && (!state.receipt || state.receipt.version !== manifest.version)) {
        issues.push(`release target ${target} has no exact-version receipt`);
      }
    }
  }
  return { issues };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeManifest(manifestPath, manifest) {
  const validation = validateManifest(manifest);
  if (validation.issues.length) throw new Error(validation.issues.join('; '));
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}

function readManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Unified release manifest is required before publishing: ${manifestPath}`);
  }
  const manifest = readJson(manifestPath);
  const validation = validateManifest(manifest);
  if (validation.issues.length) throw new Error(validation.issues.join('; '));
  return manifest;
}

function readSourceVersionMatrix({ rootDir = path.resolve(__dirname, '..') } = {}) {
  const entries = [
    ['desktop', 'package.json'],
    ['backend', path.join('backend', 'package.json')],
    ['gateway', path.join('gateway', 'package.json')],
    ['miniapp', path.join('miniapp', 'package.json')],
  ];
  return Object.fromEntries(entries.map(([name, relativePath]) => {
    const absolutePath = path.join(rootDir, relativePath);
    if (!fs.existsSync(absolutePath)) throw new Error(`Release source version file missing: ${relativePath}`);
    return [name, readJson(absolutePath).version];
  }));
}

function assertSourceVersionMatrix(matrix, expectedVersion) {
  if (!isVersion(expectedVersion)) throw new Error(`Invalid expected release version: ${expectedVersion || '<empty>'}`);
  const stale = Object.entries(matrix).filter(([, version]) => version !== expectedVersion);
  if (stale.length) {
    throw new Error(`Unified source version mismatch: ${stale.map(([name, version]) => `${name}=${version || '<empty>'}`).join(', ')}; expected ${expectedVersion}`);
  }
  return matrix;
}

function resolveManifestVersion({ manifest, requestedVersion } = {}) {
  if (!manifest) throw new Error('Unified release manifest is required');
  const validation = validateManifest(manifest);
  if (validation.issues.length) throw new Error(validation.issues.join('; '));
  if (requestedVersion && requestedVersion !== manifest.version) {
    throw new Error(`Release version mismatch: requested ${requestedVersion}, manifest requires ${manifest.version}`);
  }
  return manifest.version;
}

function assertReleaseTarget({ rootDir = path.resolve(__dirname, '..'), manifestPath = defaultManifestPath(rootDir), target, requestedVersion } = {}) {
  if (!DEFAULT_TARGETS.includes(target)) throw new Error(`Unknown release target: ${target || '<empty>'}`);
  const manifest = readManifest(manifestPath);
  const version = resolveManifestVersion({ manifest, requestedVersion });
  assertSourceVersionMatrix(readSourceVersionMatrix({ rootDir }), version);
  const targetState = manifest.targets[target];
  if (targetState.status !== 'pending') {
    throw new Error(`Release target ${target} already has a verified receipt for ${version}; use an explicit rollback or a new release`);
  }
  return { manifest, version, manifestPath };
}

function recordReceipt(manifest, { target, version, verifiedAt = new Date().toISOString(), evidence } = {}) {
  if (!DEFAULT_TARGETS.includes(target)) throw new Error(`Unknown release target: ${target || '<empty>'}`);
  const expectedVersion = resolveManifestVersion({ manifest, requestedVersion: version });
  const targetState = manifest.targets[target];
  if (targetState.status === 'verified') {
    throw new Error(`Release target ${target} already has a verified receipt for ${expectedVersion}`);
  }
  if (!evidence || typeof evidence !== 'string') throw new Error(`Release receipt evidence is required for ${target}`);
  targetState.status = 'verified';
  targetState.receipt = { version: expectedVersion, verifiedAt, evidence };
  return manifest;
}

function isReleaseComplete(manifest) {
  const validation = validateManifest(manifest);
  return validation.issues.length === 0 && DEFAULT_TARGETS.every(target => manifest.targets[target].status === 'verified');
}

function gitHead(rootDir) {
  try {
    return childProcess.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: rootDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    throw new Error('Unable to read the source commit for the unified release manifest');
  }
}

function option(argv, name) {
  const prefix = `--${name}=`;
  const inline = argv.find(arg => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[index + 1] : '';
}

function cli() {
  const argv = process.argv.slice(2);
  const command = argv[0];
  const rootDir = path.resolve(__dirname, '..');
  const manifestPath = option(argv, 'manifest') || defaultManifestPath(rootDir);
  if (command === 'prepare') {
    const matrix = readSourceVersionMatrix({ rootDir });
    const version = matrix.desktop;
    assertSourceVersionMatrix(matrix, version);
    if (fs.existsSync(manifestPath)) {
      const existing = readManifest(manifestPath);
      if (existing.version !== version) throw new Error(`Existing manifest is for ${existing.version}; archive or complete it before preparing ${version}`);
      console.log(JSON.stringify({ action: 'reuse', version, manifestPath, targets: existing.targets }, null, 2));
      return;
    }
    const manifest = createReleaseManifest({ version, commit: gitHead(rootDir) });
    writeManifest(manifestPath, manifest);
    console.log(JSON.stringify({ action: 'prepared', version, manifestPath, targets: manifest.targets }, null, 2));
    return;
  }
  if (command === 'assert') {
    const result = assertReleaseTarget({ rootDir, manifestPath, target: option(argv, 'target'), requestedVersion: option(argv, 'version') });
    console.log(JSON.stringify({ action: 'allowed', target: option(argv, 'target'), version: result.version, manifestPath }, null, 2));
    return;
  }
  if (command === 'record') {
    const manifest = readManifest(manifestPath);
    recordReceipt(manifest, {
      target: option(argv, 'target'),
      version: option(argv, 'version'),
      evidence: option(argv, 'evidence'),
    });
    writeManifest(manifestPath, manifest);
    console.log(JSON.stringify({ action: 'recorded', target: option(argv, 'target'), version: manifest.version, manifestPath }, null, 2));
    return;
  }
  if (command === 'status') {
    const manifest = readManifest(manifestPath);
    console.log(JSON.stringify({ ...manifest, complete: isReleaseComplete(manifest), manifestPath }, null, 2));
    return;
  }
  if (command === 'complete') {
    const manifest = readManifest(manifestPath);
    if (!isReleaseComplete(manifest)) throw new Error(`Release ${manifest.version} is partial; every target needs an exact-version receipt`);
    console.log(JSON.stringify({ action: 'complete', version: manifest.version, manifestPath }, null, 2));
    return;
  }
  throw new Error('Usage: release-matrix.js prepare|assert|record|status|complete [--target name] [--version x.y.z] [--evidence text]');
}

if (require.main === module) {
  try {
    cli();
  } catch (error) {
    console.error(error && error.message ? error.message : error);
    process.exit(1);
  }
}

module.exports = {
  DEFAULT_TARGETS,
  MANIFEST_SCHEMA,
  assertReleaseTarget,
  assertSourceVersionMatrix,
  createReleaseManifest,
  defaultManifestPath,
  isReleaseComplete,
  readManifest,
  readSourceVersionMatrix,
  recordReceipt,
  resolveManifestVersion,
  validateManifest,
  writeManifest,
};
