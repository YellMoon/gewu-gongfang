const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const crypto = require('crypto');

const DEFAULT_TARGETS = Object.freeze(['desktop', 'cloud_business', 'storage_proxy', 'miniapp']);
const DESKTOP_PREREQUISITE_TARGETS = Object.freeze(['cloud_business', 'storage_proxy', 'miniapp']);
const MANIFEST_SCHEMA = 'gewu.release-compatibility.v2';
const COMPATIBILITY_SCHEMA = 'gewu.protocol-data-compatibility.v1';
const MINIAPP_RELEASE_LEVELS = Object.freeze(['development', 'production']);

function compatibilityDeclarationPath(rootDir = path.resolve(__dirname, '..')) {
  return path.join(rootDir, 'config', 'release-compatibility.json');
}

function normalizedStringRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (entries.some(([key, item]) => !key || typeof item !== 'string' || !item)) return null;
  return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)));
}

function sameStringRecord(left, right) {
  const normalizedLeft = normalizedStringRecord(left);
  const normalizedRight = normalizedStringRecord(right);
  return normalizedLeft !== null && normalizedRight !== null
    && JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight);
}

function normalizedRuntimeContractRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (entries.some(([key, item]) => !key
    || !((typeof item === 'string' && /^\d+$/u.test(item)) || (Number.isSafeInteger(item) && item > 0)))) return null;
  return Object.fromEntries(entries
    .map(([key, item]) => [key, String(item)])
    .sort(([left], [right]) => left.localeCompare(right)));
}

function normalizedRuntimeReceiptIdentity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== 6
    || !['receiptId', 'agentId', 'agentVersion', 'contracts', 'parserSha256', 'observedAt'].every(key => Object.hasOwn(value, key))
    || typeof value.receiptId !== 'string' || !/^storage_runtime_receipt_[A-Za-z0-9_-]{8,128}$/u.test(value.receiptId)
    || typeof value.agentId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/u.test(value.agentId)
    || !isVersion(value.agentVersion)
    || !normalizedRuntimeContractRecord(value.contracts)
    || typeof value.parserSha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(value.parserSha256)
    || !isIsoTimestamp(value.observedAt)) return null;
  return {
    receiptId: value.receiptId,
    agentId: value.agentId,
    agentVersion: value.agentVersion,
    contracts: Object.fromEntries(Object.entries(value.contracts).sort(([left], [right]) => left.localeCompare(right))),
    parserSha256: value.parserSha256,
    observedAt: value.observedAt,
  };
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
  if (declaration.runtimeReceipts !== undefined) {
    if (!declaration.runtimeReceipts || typeof declaration.runtimeReceipts !== 'object' || Array.isArray(declaration.runtimeReceipts)) {
      throw new Error('Release runtime receipt declaration is invalid');
    }
    for (const [target, policy] of Object.entries(declaration.runtimeReceipts)) {
      if (!DEFAULT_TARGETS.includes(target) || !policy || typeof policy !== 'object' || Array.isArray(policy)
        || !Array.isArray(policy.approvedRuntimeVersions) || policy.approvedRuntimeVersions.length === 0
        || policy.approvedRuntimeVersions.some(version => !isVersion(version))) {
        throw new Error(`Release runtime receipt declaration is invalid: ${target || '<empty>'}`);
      }
      const runtimeContracts = normalizedStringRecord(policy.contracts);
      if (!runtimeContracts || Object.keys(runtimeContracts).length === 0) {
        throw new Error(`Release runtime receipt declaration is invalid: ${target}`);
      }
      for (const [contractName, contractVersion] of Object.entries(runtimeContracts)) {
        const contract = declaration.contracts[contractName];
        if (!contract || contract.version !== contractVersion || !contract.participants.includes(target)) {
          throw new Error(`Release runtime receipt declaration is invalid: ${target}`);
        }
      }
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

function isIsoTimestamp(value) {
  if (typeof value !== 'string' || value !== value.trim()) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth && Number.isFinite(Date.parse(value));
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

function validateReceipt({ manifest, target, receipt } = {}) {
  const issues = [];
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    issues.push(`release target ${target} has no component-version receipt`);
    return { issues, runtimeReceipt: null };
  }
  if (receipt.version !== manifest?.componentVersions?.[target]) {
    issues.push(`release target ${target} has no component-version receipt`);
  }
  if (typeof receipt.evidence !== 'string' || receipt.evidence.trim().length === 0) {
    issues.push(`release receipt evidence is required for ${target}`);
  }
  if (!isIsoTimestamp(receipt.verifiedAt)) {
    issues.push(`release receipt verifiedAt must be a valid ISO timestamp for ${target}`);
  }
  if (receipt.compatibility !== manifest?.compatibility?.schema) {
    issues.push(`release receipt compatibility must match the manifest compatibility schema for ${target}`);
  }
  if (target === 'miniapp' && !MINIAPP_RELEASE_LEVELS.includes(receipt.releaseLevel)) {
    issues.push('Miniapp release receipt must declare development or production');
  }
  let runtimeReceipt = null;
  try {
    runtimeReceipt = assertRuntimeReceiptCompatibility({
      manifest,
      target,
      runtimeVersion: receipt.runtimeVersion,
      runtimeContracts: receipt.runtimeContracts,
      parserSha256: receipt.parserSha256,
      runtimeReceipt: receipt.runtimeReceipt,
    });
  } catch (error) {
    issues.push(error.message);
  }
  return { issues, runtimeReceipt };
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
      if (state?.status === 'verified') {
        issues.push(...validateReceipt({ manifest, target, receipt: state.receipt }).issues);
      }
    }
  }
  return { issues };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeFileAtomically(filePath, contents) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`,
  );
  try {
    fs.writeFileSync(temporaryPath, contents, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(temporaryPath, filePath);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
}

function writeManifest(manifestPath, manifest) {
  const validation = validateManifest(manifest);
  if (validation.issues.length) throw new Error(validation.issues.join('; '));
  writeFileAtomically(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
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
  return isReleaseComplete(manifest);
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
  writeFileAtomically(archivePath, `${JSON.stringify(recoveryManifest, null, 2)}\n`);
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

function assertRuntimeReceiptCompatibility({ manifest, target, runtimeVersion, runtimeContracts, parserSha256, runtimeReceipt } = {}) {
  const policy = manifest?.compatibility?.runtimeReceipts?.[target];
  const runtimeReceiptRequired = policy !== undefined;
  if (runtimeVersion === undefined || runtimeVersion === null || runtimeVersion === '') {
    if (runtimeReceiptRequired) throw new Error(`Release target ${target} runtime version is required`);
    return null;
  }
  if (!isVersion(runtimeVersion)) throw new Error(`Release target ${target} runtime version is invalid`);
  if (!DEFAULT_TARGETS.includes(target) || !isVersion(manifest?.componentVersions?.[target])) {
    throw new Error(`Release target ${target || '<empty>'} runtime receipt cannot be validated`);
  }
  if (runtimeReceiptRequired) {
    if (!Array.isArray(policy?.approvedRuntimeVersions) || !policy.approvedRuntimeVersions.includes(runtimeVersion)) {
      throw new Error(`Release target ${target} runtime version is not approved: ${runtimeVersion}`);
    }
    if (!sameStringRecord(runtimeContracts, policy.contracts)) {
      throw new Error(`Release target ${target} runtime contract receipt is incompatible`);
    }
    if (Object.hasOwn(policy.contracts, 'questionImportParserProof') && (typeof parserSha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(parserSha256))) {
      throw new Error(`Release target ${target} runtime parser SHA-256 is invalid`);
    }
    const identity = normalizedRuntimeReceiptIdentity(runtimeReceipt);
    if (!identity) throw new Error(`Release target ${target} runtime receipt identity is invalid`);
    if (identity.agentVersion !== runtimeVersion
      || JSON.stringify(normalizedRuntimeContractRecord(identity.contracts)) !== JSON.stringify(normalizedRuntimeContractRecord(runtimeContracts))
      || identity.parserSha256 !== parserSha256) {
      throw new Error(`Release target ${target} runtime receipt does not match its declared runtime evidence`);
    }
    return {
      runtimeVersion,
      runtimeContracts: normalizedStringRecord(runtimeContracts),
      ...(parserSha256 === undefined ? {} : { parserSha256 }),
      runtimeReceipt: identity,
    };
  }
  const expectedVersion = manifest.componentVersions[target];
  if (runtimeVersion !== expectedVersion) {
    throw new Error(`Release target ${target} runtime version is not approved: ${runtimeVersion}`);
  }
  if (runtimeContracts !== undefined && normalizedStringRecord(runtimeContracts) === null) {
    throw new Error(`Release target ${target} runtime contract receipt is incompatible`);
  }
  if (parserSha256 !== undefined && (typeof parserSha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(parserSha256))) {
    throw new Error(`Release target ${target} runtime parser SHA-256 is invalid`);
  }
  const identity = runtimeReceipt === undefined ? undefined : normalizedRuntimeReceiptIdentity(runtimeReceipt);
  if (runtimeReceipt !== undefined && !identity) throw new Error(`Release target ${target} runtime receipt identity is invalid`);
  return {
    runtimeVersion,
    runtimeContracts: runtimeContracts === undefined ? undefined : normalizedStringRecord(runtimeContracts),
    ...(parserSha256 === undefined ? {} : { parserSha256 }),
    ...(identity === undefined ? {} : { runtimeReceipt: identity }),
  };
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

function recordReceipt(manifest, {
  target, version, verifiedAt = new Date().toISOString(), evidence, releaseLevel, runtimeVersion, runtimeContracts, parserSha256, runtimeReceipt,
} = {}) {
  if (!DEFAULT_TARGETS.includes(target)) throw new Error(`Unknown release target: ${target || '<empty>'}`);
  const targetState = manifest?.targets?.[target];
  const resolvedReleaseLevel = target === 'miniapp' && releaseLevel === undefined ? 'development' : releaseLevel;
  const isMiniappProductionUpgrade = target === 'miniapp'
    && targetState?.status === 'verified'
    && targetState.receipt?.releaseLevel === 'development'
    && resolvedReleaseLevel === 'production';
  if (targetState?.status === 'verified' && !isMiniappProductionUpgrade) {
    throw new Error(`Release target ${target} already has a verified receipt for ${manifest?.componentVersions?.[target] || version || '<empty>'}`);
  }
  const expectedVersion = resolveTargetVersion({ manifest, target, requestedVersion: version });
  const baseReceipt = { version: expectedVersion, verifiedAt, evidence, compatibility: manifest.compatibility.schema };
  if (runtimeVersion !== undefined) baseReceipt.runtimeVersion = runtimeVersion;
  if (runtimeContracts !== undefined) baseReceipt.runtimeContracts = runtimeContracts;
  if (parserSha256 !== undefined) baseReceipt.parserSha256 = parserSha256;
  if (runtimeReceipt !== undefined) baseReceipt.runtimeReceipt = runtimeReceipt;
  const receipt = target === 'miniapp'
    ? { ...baseReceipt, releaseLevel: resolvedReleaseLevel }
    : baseReceipt;
  const receiptValidation = validateReceipt({ manifest, target, receipt });
  if (receiptValidation.issues.length) throw new Error(receiptValidation.issues.join('; '));
  if (receiptValidation.runtimeReceipt) Object.assign(receipt, receiptValidation.runtimeReceipt);
  targetState.status = 'verified';
  targetState.receipt = receipt;
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

function jsonOption(argv, name) {
  const value = option(argv, name);
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch (_) {
    throw new Error(`Invalid JSON option: --${name}`);
  }
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
      runtimeVersion: option(argv, 'runtime-version') || undefined,
      runtimeContracts: jsonOption(argv, 'runtime-contracts'),
      parserSha256: option(argv, 'parser-sha256') || undefined,
      runtimeReceipt: jsonOption(argv, 'runtime-receipt'),
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
  throw new Error('Usage: release-matrix.js prepare|recover|assert|record|status|complete [--target name] [--version x.y.z] [--runtime-version x.y.z] [--runtime-contracts json] [--parser-sha256 hex] [--runtime-receipt json] [--evidence text] [--reason text]');
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
  validateReceipt,
  validateManifest,
  writeManifest,
};
