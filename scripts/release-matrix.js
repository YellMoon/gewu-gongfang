const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const DEFAULT_TARGETS = Object.freeze(['desktop', 'cloud_business', 'storage_proxy', 'miniapp']);
const DESKTOP_PREREQUISITE_TARGETS = Object.freeze(['cloud_business', 'storage_proxy', 'miniapp']);
const MANIFEST_SCHEMA = 'gewu.release-compatibility.v2';
const COMPATIBILITY_SCHEMA = 'gewu.protocol-data-compatibility.v1';
const MINIAPP_RELEASE_LEVELS = Object.freeze(['development', 'production']);

function compatibilityDeclarationPath(rootDir = path.resolve(__dirname, '..')) {
  return path.join(rootDir, 'config', 'release-compatibility.json');
}

function readCompatibilityDeclaration({ rootDir = path.resolve(__dirname, '..') } = {}) {
  const declarationPath = compatibilityDeclarationPath(rootDir);
  if (!fs.existsSync(declarationPath)) throw new Error(`Release compatibility declaration is required: ${declarationPath}`);
  const declaration = readJson(declarationPath);
  if (declaration?.schema !== COMPATIBILITY_SCHEMA || !declaration.contracts || typeof declaration.contracts !== 'object') {
    throw new Error('Release compatibility declaration is invalid');
  }
  for (const [name, contract] of Object.entries(declaration.contracts)) {
    if (!name || !contract || !/^\d+$/.test(String(contract.version || '')) || !Array.isArray(contract.participants) || contract.participants.length === 0) {
      throw new Error(`Release compatibility contract is invalid: ${name || '<empty>'}`);
    }
  }
  return declaration;
}

function compatibilityFingerprint(declaration) {
  return JSON.stringify(declaration);
}

function matrixReleaseId(componentVersions) {
  return DEFAULT_TARGETS.map(target => `${target.replace('_', '-')}-${componentVersions[target]}`).join('__');
}

function defaultManifestPath(rootDir = path.resolve(__dirname, '..')) {
  const configured = String(process.env.GEWU_RELEASE_MANIFEST_PATH || '').trim();
  if (configured) return path.resolve(rootDir, configured);
  const componentVersions = readSourceVersionMatrix({ rootDir });
  return path.join(rootDir, 'output', `release-matrix-${matrixReleaseId(componentVersions)}`, 'active.json');
}

function historicalManifestPath(manifestPath, manifest) {
  const createdAt = String(manifest.createdAt || 'unknown').replace(/[^0-9A-Za-z]/g, '-');
  const commit = String(manifest.commit || 'unknown').replace(/[^0-9A-Za-z]/g, '').slice(0, 12) || 'unknown';
  return path.join(path.dirname(manifestPath), 'history', `${manifest.version}-${createdAt}-${commit}.json`);
}

function supersededManifestPath(manifestPath, manifest) {
  const base = historicalManifestPath(manifestPath, manifest).replace(/\.json$/u, '');
  return `${base}-superseded.json`;
}

function isVersion(value) {
  return /^\d+\.\d+\.\d+$/.test(String(value || ''));
}

function createReleaseManifest({ version, componentVersions, compatibility, commit, createdAt = new Date().toISOString(), targets = DEFAULT_TARGETS } = {}) {
  const versions = componentVersions || Object.fromEntries(targets.map(target => [target, version]));
  for (const target of targets) {
    if (!isVersion(versions?.[target])) throw new Error(`Invalid ${target} release version: ${versions?.[target] || '<empty>'}`);
  }
  if (!commit || typeof commit !== 'string') throw new Error('A source commit is required for a unified release manifest');
  const targetState = {};
  for (const target of targets) {
    targetState[target] = { status: 'pending' };
  }
  return {
    schema: MANIFEST_SCHEMA,
    // `version` remains the desktop version for legacy status readers. New gates
    // must use componentVersions[target], never infer cross-component equality.
    version: versions.desktop,
    componentVersions: Object.fromEntries(targets.map(target => [target, versions[target]])),
    compatibility: compatibility || readCompatibilityDeclaration(),
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
  if (!isVersion(manifest.version)) issues.push(`release manifest desktop version is invalid: ${manifest.version || '<empty>'}`);
  if (!manifest.componentVersions || typeof manifest.componentVersions !== 'object') {
    issues.push('release manifest component versions are missing');
  } else {
    for (const target of DEFAULT_TARGETS) {
      if (!isVersion(manifest.componentVersions[target])) issues.push(`release target ${target} version is invalid`);
    }
    if (manifest.componentVersions.desktop !== manifest.version) issues.push('release manifest desktop version does not match componentVersions.desktop');
  }
  try {
    const expectedCompatibility = readCompatibilityDeclaration();
    if (compatibilityFingerprint(manifest.compatibility) !== compatibilityFingerprint(expectedCompatibility)) {
      issues.push('release manifest compatibility declaration does not match the reviewed protocol/data contract');
    }
  } catch (error) {
    issues.push(error.message);
  }
  if (!manifest.commit || typeof manifest.commit !== 'string') issues.push('release manifest commit is missing');
  if (!manifest.targets || typeof manifest.targets !== 'object') {
    issues.push('release manifest targets are missing');
  } else {
    for (const target of DEFAULT_TARGETS) {
      const state = manifest.targets[target];
      if (!state || !['pending', 'verified'].includes(state.status)) {
        issues.push(`release target ${target} must be pending or verified`);
      }
      if (state?.status === 'verified' && (!state.receipt || state.receipt.version !== manifest.componentVersions?.[target])) {
        issues.push(`release target ${target} has no component-version receipt`);
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

function isCompletedHistoricalManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || !isVersion(manifest.version) || !manifest.commit) return false;
  const targets = manifest.targets;
  if (!targets || typeof targets !== 'object' || Object.keys(targets).length === 0) return false;
  return Object.entries(targets).every(([target, state]) => (
    state?.status === 'verified'
    && state.receipt?.version === manifest.componentVersions?.[target]
    && typeof state.receipt.evidence === 'string'
    && state.receipt.evidence.length > 0
  )) && targets.miniapp?.receipt?.releaseLevel === 'production';
}

function archiveCompletedHistoricalManifest({ manifestPath, manifest } = {}) {
  if (!manifestPath || !isCompletedHistoricalManifest(manifest)) {
    throw new Error('Only a completed historical release manifest may be archived automatically');
  }
  const archivePath = historicalManifestPath(manifestPath, manifest);
  if (fs.existsSync(archivePath)) throw new Error(`Historical release manifest already exists: ${archivePath}`);
  fs.mkdirSync(path.dirname(archivePath), { recursive: true });
  fs.renameSync(manifestPath, archivePath);
  return archivePath;
}

function isUntouchedPendingManifest(manifest) {
  const validation = validateManifest(manifest);
  return validation.issues.length === 0 && DEFAULT_TARGETS.every(target => {
    const state = manifest.targets[target];
    return state?.status === 'pending' && !state.receipt;
  });
}

function archiveUntouchedPendingManifest({ manifestPath, manifest } = {}) {
  if (!manifestPath || !isUntouchedPendingManifest(manifest)) {
    throw new Error('Only an untouched pending release manifest may be superseded automatically');
  }
  const archivePath = supersededManifestPath(manifestPath, manifest);
  if (fs.existsSync(archivePath)) throw new Error(`Superseded release manifest already exists: ${archivePath}`);
  fs.mkdirSync(path.dirname(archivePath), { recursive: true });
  fs.renameSync(manifestPath, archivePath);
  return archivePath;
}

function isPartiallyVerifiedManifest(manifest) {
  const validation = validateManifest(manifest);
  if (validation.issues.length > 0) return false;
  const states = DEFAULT_TARGETS.map(target => manifest.targets[target]);
  return states.some(state => state.status === 'verified')
    && states.some(state => state.status === 'pending');
}

function isRecoverableIncompleteManifest(manifest) {
  const validation = validateManifest(manifest);
  if (validation.issues.length > 0 || isReleaseComplete(manifest)) return false;
  return DEFAULT_TARGETS.some(target => manifest.targets[target].status === 'verified');
}

function archivePartiallyVerifiedManifest({ manifestPath, manifest, reason, recoveredAt = new Date().toISOString(), supersededByCommit } = {}) {
  if (!manifestPath || !isRecoverableIncompleteManifest(manifest)) {
    throw new Error('Only an incomplete release manifest may be recovered explicitly');
  }
  if (!reason || typeof reason !== 'string') throw new Error('A recovery reason is required for a partially verified release manifest');
  const archivePath = `${historicalManifestPath(manifestPath, manifest).replace(/\.json$/u, '')}-recovered.json`;
  if (fs.existsSync(archivePath)) throw new Error(`Recovered release manifest already exists: ${archivePath}`);
  const recoveryManifest = {
    ...manifest,
    recovery: { reason, recoveredAt, supersededByCommit },
  };
  fs.mkdirSync(path.dirname(archivePath), { recursive: true });
  fs.writeFileSync(archivePath, `${JSON.stringify(recoveryManifest, null, 2)}\n`, 'utf8');
  fs.unlinkSync(manifestPath);
  return archivePath;
}

function readSourceVersionMatrix({ rootDir = path.resolve(__dirname, '..') } = {}) {
  const entries = [
    ['desktop', 'package.json'],
    ['cloud_business', path.join('cloud-business-api', 'package.json')],
    ['storage_proxy', path.join('storage-agent', 'package.json')],
    ['miniapp', path.join('miniapp', 'package.json')],
  ];
  return Object.fromEntries(entries.map(([name, relativePath]) => {
    const absolutePath = path.join(rootDir, relativePath);
    if (!fs.existsSync(absolutePath)) throw new Error(`Release source version file missing: ${relativePath}`);
    return [name, readJson(absolutePath).version];
  }));
}

function assertSourceVersionMatrix(matrix) {
  const invalid = DEFAULT_TARGETS.filter(target => !isVersion(matrix?.[target]));
  if (invalid.length) {
    throw new Error(`Release source component version is invalid: ${invalid.map(target => `${target}=${matrix?.[target] || '<empty>'}`).join(', ')}`);
  }
  return matrix;
}

function resolveManifestVersion({ manifest, requestedVersion } = {}) {
  if (!manifest) throw new Error('Unified release manifest is required');
  const validation = validateManifest(manifest);
  if (validation.issues.length) throw new Error(validation.issues.join('; '));
  if (requestedVersion && requestedVersion !== manifest.version) {
    throw new Error(`Desktop release version mismatch: requested ${requestedVersion}, manifest requires ${manifest.version}`);
  }
  return manifest.version;
}

function resolveTargetVersion({ manifest, target, requestedVersion } = {}) {
  if (!DEFAULT_TARGETS.includes(target)) throw new Error(`Unknown release target: ${target || '<empty>'}`);
  const validation = validateManifest(manifest);
  if (validation.issues.length) throw new Error(validation.issues.join('; '));
  const expectedVersion = manifest.componentVersions[target];
  if (requestedVersion && requestedVersion !== expectedVersion) {
    throw new Error(`${target} release version mismatch: requested ${requestedVersion}, manifest requires ${expectedVersion}`);
  }
  return expectedVersion;
}

function assertReleaseTarget({ rootDir = path.resolve(__dirname, '..'), manifestPath = defaultManifestPath(rootDir), target, requestedVersion } = {}) {
  if (!DEFAULT_TARGETS.includes(target)) throw new Error(`Unknown release target: ${target || '<empty>'}`);
  const manifest = readManifest(manifestPath);
  const version = resolveTargetVersion({ manifest, target, requestedVersion });
  const sourceVersions = assertSourceVersionMatrix(readSourceVersionMatrix({ rootDir }));
  if (sourceVersions[target] !== version) {
    throw new Error(`Release target ${target} source version mismatch: ${sourceVersions[target]} != ${version}`);
  }
  const targetState = manifest.targets[target];
  if (targetState.status !== 'pending') {
    throw new Error(`Release target ${target} already has a verified receipt for ${version}; use an explicit rollback or a new release`);
  }
  return { manifest, version, manifestPath };
}

function assertDesktopReleasePrerequisites({
  rootDir = path.resolve(__dirname, '..'),
  manifestPath = defaultManifestPath(rootDir),
  manifest: suppliedManifest,
  requestedVersion,
} = {}) {
  const manifest = suppliedManifest || readManifest(manifestPath);
  const version = resolveTargetVersion({ manifest, target: 'desktop', requestedVersion });
  const sourceVersions = assertSourceVersionMatrix(readSourceVersionMatrix({ rootDir }));
  if (sourceVersions.desktop !== version) throw new Error(`Release target desktop source version mismatch: ${sourceVersions.desktop} != ${version}`);
  for (const target of DESKTOP_PREREQUISITE_TARGETS) {
    const state = manifest.targets[target];
    if (state?.status !== 'verified' || state.receipt?.version !== manifest.componentVersions[target]) {
      throw new Error(`Desktop ${version} cannot publish OSS updates until ${target} has a verified compatible component receipt`);
    }
  }
  return { manifest, version, manifestPath };
}

function recordReceipt(manifest, { target, version, verifiedAt = new Date().toISOString(), evidence, releaseLevel } = {}) {
  if (!DEFAULT_TARGETS.includes(target)) throw new Error(`Unknown release target: ${target || '<empty>'}`);
  const expectedVersion = resolveTargetVersion({ manifest, target, requestedVersion: version });
  const targetState = manifest.targets[target];
  const resolvedReleaseLevel = target === 'miniapp' && releaseLevel === undefined ? 'development' : releaseLevel;
  const isMiniappProductionUpgrade = target === 'miniapp'
    && targetState.status === 'verified'
    && targetState.receipt?.releaseLevel === 'development'
    && resolvedReleaseLevel === 'production';
  if (targetState.status === 'verified' && !isMiniappProductionUpgrade) {
    throw new Error(`Release target ${target} already has a verified receipt for ${expectedVersion}`);
  }
  if (!evidence || typeof evidence !== 'string') throw new Error(`Release receipt evidence is required for ${target}`);
  if (target === 'miniapp' && !MINIAPP_RELEASE_LEVELS.includes(resolvedReleaseLevel)) {
    throw new Error('Miniapp release receipt must declare development or production');
  }
  targetState.status = 'verified';
  targetState.receipt = target === 'miniapp'
    ? { version: expectedVersion, verifiedAt, evidence, releaseLevel: resolvedReleaseLevel, compatibility: manifest.compatibility.schema }
    : { version: expectedVersion, verifiedAt, evidence, compatibility: manifest.compatibility.schema };
  return manifest;
}

function isReleaseComplete(manifest) {
  const validation = validateManifest(manifest);
  return validation.issues.length === 0
    && DEFAULT_TARGETS.every(target => manifest.targets[target].status === 'verified')
    && manifest.targets.miniapp?.receipt?.releaseLevel === 'production';
}

function gitHead(rootDir) {
  try {
    return childProcess.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: rootDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    throw new Error('Unable to read the source commit for the unified release manifest');
  }
}

function prepareReleaseManifest({
  rootDir = path.resolve(__dirname, '..'),
  manifestPath = defaultManifestPath(rootDir),
  commit = gitHead(rootDir),
} = {}) {
  const matrix = readSourceVersionMatrix({ rootDir });
  const version = matrix.desktop;
  assertSourceVersionMatrix(matrix);
  const compatibility = readCompatibilityDeclaration({ rootDir });
  if (fs.existsSync(manifestPath)) {
    const existingRaw = readJson(manifestPath);
    if (existingRaw.version === version && existingRaw.commit === commit) {
      const existing = readManifest(manifestPath);
      return { action: 'reuse', version, manifestPath, manifest: existing, archivedManifestPath: null };
    }
    if (isUntouchedPendingManifest(existingRaw)) {
      const archivedManifestPath = archiveUntouchedPendingManifest({ manifestPath, manifest: existingRaw });
      const manifest = createReleaseManifest({ componentVersions: matrix, compatibility, commit });
      writeManifest(manifestPath, manifest);
      return { action: 'superseded-and-prepared', version, manifestPath, manifest, archivedManifestPath };
    }
    const archivedManifestPath = archiveCompletedHistoricalManifest({ manifestPath, manifest: existingRaw });
    const manifest = createReleaseManifest({ componentVersions: matrix, compatibility, commit });
    writeManifest(manifestPath, manifest);
    return { action: 'archived-and-prepared', version, manifestPath, manifest, archivedManifestPath };
  }
  const manifest = createReleaseManifest({ componentVersions: matrix, compatibility, commit });
  writeManifest(manifestPath, manifest);
  return { action: 'prepared', version, manifestPath, manifest, archivedManifestPath: null };
}

function recoverPartiallyPublishedManifest({
  rootDir = path.resolve(__dirname, '..'),
  manifestPath = defaultManifestPath(rootDir),
  commit = gitHead(rootDir),
  reason,
} = {}) {
  const matrix = readSourceVersionMatrix({ rootDir });
  const version = matrix.desktop;
  assertSourceVersionMatrix(matrix);
  const existing = readManifest(manifestPath);
  const archivedManifestPath = archivePartiallyVerifiedManifest({
    manifestPath,
    manifest: existing,
    reason,
    supersededByCommit: commit,
  });
  const manifest = createReleaseManifest({ componentVersions: matrix, compatibility: readCompatibilityDeclaration({ rootDir }), commit });
  writeManifest(manifestPath, manifest);
  return { action: 'recovered-and-prepared', version, manifestPath, manifest, archivedManifestPath };
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
    const result = prepareReleaseManifest({ rootDir, manifestPath });
    console.log(JSON.stringify({
      action: result.action,
      version: result.version,
      componentVersions: result.manifest.componentVersions,
      manifestPath,
      targets: result.manifest.targets,
      archivedManifestPath: result.archivedManifestPath,
    }, null, 2));
    return;
  }
  if (command === 'recover') {
    const result = recoverPartiallyPublishedManifest({ rootDir, manifestPath, reason: option(argv, 'reason') });
    console.log(JSON.stringify({
      action: result.action,
      version: result.version,
      manifestPath,
      targets: result.manifest.targets,
      archivedManifestPath: result.archivedManifestPath,
    }, null, 2));
    return;
  }
  if (command === 'assert') {
    const result = assertReleaseTarget({ rootDir, manifestPath, target: option(argv, 'target'), requestedVersion: option(argv, 'version') });
    console.log(JSON.stringify({ action: 'allowed', target: option(argv, 'target'), version: result.version, componentVersions: result.manifest.componentVersions, manifestPath }, null, 2));
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
    console.log(JSON.stringify({ action: 'recorded', target: option(argv, 'target'), version: manifest.componentVersions[option(argv, 'target')], componentVersions: manifest.componentVersions, manifestPath }, null, 2));
    return;
  }
  if (command === 'status') {
    const manifest = readManifest(manifestPath);
    console.log(JSON.stringify({ ...manifest, complete: isReleaseComplete(manifest), manifestPath }, null, 2));
    return;
  }
  if (command === 'complete') {
    const manifest = readManifest(manifestPath);
    if (!isReleaseComplete(manifest)) throw new Error(`Release matrix is partial; every target needs a compatible component-version receipt`);
    console.log(JSON.stringify({ action: 'complete', version: manifest.version, componentVersions: manifest.componentVersions, manifestPath }, null, 2));
    return;
  }
  throw new Error('Usage: release-matrix.js prepare|recover|assert|record|status|complete [--target name] [--version x.y.z] [--evidence text] [--reason text]');
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
  DESKTOP_PREREQUISITE_TARGETS,
  MANIFEST_SCHEMA,
  MINIAPP_RELEASE_LEVELS,
  COMPATIBILITY_SCHEMA,
  assertDesktopReleasePrerequisites,
  assertReleaseTarget,
  assertSourceVersionMatrix,
  createReleaseManifest,
  defaultManifestPath,
  historicalManifestPath,
  supersededManifestPath,
  isCompletedHistoricalManifest,
  isUntouchedPendingManifest,
  isPartiallyVerifiedManifest,
  isReleaseComplete,
  recoverPartiallyPublishedManifest,
  prepareReleaseManifest,
  readManifest,
  readSourceVersionMatrix,
  recordReceipt,
  resolveManifestVersion,
  resolveTargetVersion,
  readCompatibilityDeclaration,
  validateManifest,
  writeManifest,
};
