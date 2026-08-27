const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

// 版本号规则：Major.Minor.Patch
// Major: 破坏性/不兼容变更
// Minor: 新功能、向后兼容的数据结构/接口/页面能力
// Patch: Bug 修复、样式、文档、测试、小调整

const VALID_BUMP_LEVELS = new Set(['major', 'minor', 'patch']);
const COMPONENTS = Object.freeze({
  desktop: {
    packagePath: path.join(__dirname, '..', 'package.json'),
    lockPath: path.join(__dirname, '..', 'package-lock.json'),
    generatesDesktopVersion: true,
  },
  cloud_business: {
    packagePath: path.join(__dirname, '..', 'cloud-business-api', 'package.json'),
  },
  storage_proxy: {
    packagePath: path.join(__dirname, '..', 'storage-agent', 'package.json'),
  },
  miniapp: {
    packagePath: path.join(__dirname, '..', 'miniapp', 'package.json'),
    lockPath: path.join(__dirname, '..', 'miniapp', 'package-lock.json'),
  },
});
const RELEASE_ARTIFACT_PATH_PATTERNS = [
  /^(?:dist|dist-host|output)\//,
  /^tmp[-_]/,
  /^src\/generated\/version\.ts$/,
];

function filterReleaseArtifactPaths(paths = []) {
  return paths.filter(file => !RELEASE_ARTIFACT_PATH_PATTERNS.some(pattern => pattern.test(String(file).replace(/\\/g, '/'))));
}

function runGit(args) {
  try {
    return childProcess.execFileSync('git', args, {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function readChangeContext() {
  const releasePathspec = [
    '.',
    ':(exclude)dist/**',
    ':(exclude)dist-host/**',
    ':(exclude)output/**',
    ':(exclude)tmp-*/**',
    ':(exclude)tmp_*/**',
    ':(exclude)src/generated/version.ts',
  ];
  const diffNameOnly = runGit(['diff', '--name-only', 'HEAD', '--', ...releasePathspec]);
  const diffNameStatus = runGit(['diff', '--name-status', 'HEAD', '--', ...releasePathspec]);
  const diff = runGit(['diff', 'HEAD', '--', ...releasePathspec]);
  const files = diffNameOnly
    ? filterReleaseArtifactPaths(diffNameOnly.split(/\r?\n/).map(line => line.trim()).filter(Boolean))
    : [];
  const deletedFiles = diffNameStatus
    ? diffNameStatus
      .split(/\r?\n/)
      .map(line => line.split(/\t+/))
      .filter(parts => parts[0]?.includes('D') && parts[1])
      .map(parts => parts[1].trim())
    : [];

  if (files.length > 0 || diff) return { files, deletedFiles, diff };

  const lastCommitFiles = runGit(['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD']);
  const lastCommitMessage = runGit(['log', '-1', '--pretty=%B']);
  return {
    files: lastCommitFiles ? filterReleaseArtifactPaths(lastCommitFiles.split(/\r?\n/).map(line => line.trim()).filter(Boolean)) : [],
    deletedFiles: [],
    diff: lastCommitMessage,
  };
}

function hasAny(text, patterns) {
  return patterns.some(pattern => pattern.test(text));
}

function sourceAddedChangeText(diff = '') {
  if (!/(?:^|\n)diff --git /.test(diff)) return diff;
  const added = [];
  let include = false;
  for (const line of diff.split(/\r?\n/)) {
    const header = line.match(/^diff --git a\/.+ b\/(.+)$/);
    if (header) {
      const file = header[1].replace(/\\/g, '/');
      include = !(
        /(?:^|\/)task\.md$/i.test(file)
        || /\.md$/i.test(file)
        || file === 'scripts/update-version.js'
        || /(?:^|\/)(?:test|tests|__tests__)(?:\/|$)/i.test(file)
        || /\.test\.[^.]+$/i.test(file)
        || RELEASE_ARTIFACT_PATH_PATTERNS.some(pattern => pattern.test(file))
      );
      continue;
    }
    if (include && line.startsWith('+') && !line.startsWith('+++')) added.push(line.slice(1));
  }
  return added.join('\n');
}

function analyzeVersionBump(context = readChangeContext()) {
  const files = context.files || [];
  const deletedFiles = context.deletedFiles || [];
  const diff = context.diff || '';
  const corpus = `${files.join('\n')}\n${diff}`;
  const addedChangeText = sourceAddedChangeText(diff);

  const majorSignals = [
    /BREAKING[\s_-]?CHANGE/i,
    /(?:^|\n)\s*(major|feat!)\s*:/i,
    /不兼容|破坏性|删除旧字段|删除表|重命名表|迁移必需|不可回滚/,
    /^\s*-\s*CREATE TABLE/im,
    /^\s*-\s*ALTER TABLE/im,
    /DROP\s+(TABLE|COLUMN|INDEX)/i,
  ];
  const executablePublicApiPaths = [
    /^backend\/src\/routes\/(?!.*\.test\.js$).+\.js$/,
    /^gateway\/src\/routes\/(?!.*\.test\.js$).+\.js$/,
    /^src\/services\/(?!.*\.test\.js$).+\.(?:mjs|js|ts)$/,
    /^public\/(?!.*\.test\.js$).+\.js$/,
  ];
  if (deletedFiles.some(file => executablePublicApiPaths.some(pattern => pattern.test(file)))) return 'major';
  if (hasAny(corpus, majorSignals)) return 'major';

  const patchSignals = [
    /fix|fixed|bug|bugfix|hotfix|repair/i,
    /修复|修正|乱码|错误|失败|异常|不生效|恢复|错位|崩溃|回归/,
  ];

  const minorPathSignals = [
    /^backend\/src\/routes\/.+\.js$/,
    /^backend\/src\/services\/.+\.js$/,
    /^miniapp\/src\/pages\/.+\/index\.(tsx|ts|jsx|js)$/,
    /^src\/pages\/.+\.(tsx|ts|jsx|js)$/,
    /^modules\/.+/,
  ];
  const minorContentSignals = [
    /新增|增加|支持|新功能|\bfeature\b|\b(?:add(?:ed)?|create(?:d)?)\s+(?:support|route|endpoint|page|module|service|feature|capability)\b|router\.(get|post|put|delete|patch)/i,
    /^\+\s*CREATE TABLE/im,
    /^\+\s*ALTER TABLE/im,
    /^\+\s*app\.use\('/m,
  ];
  if (hasAny(corpus, patchSignals) && !hasAny(corpus, minorContentSignals)) return 'patch';
  if (files.some(file => minorPathSignals.some(pattern => pattern.test(file))) && hasAny(addedChangeText, minorContentSignals)) return 'minor';
  if (hasAny(addedChangeText, minorContentSignals)) return 'minor';

  return 'patch';
}

function resolveBumpLevel(argv, env = process.env, context = readChangeContext()) {
  const explicitBump = argv.find(arg => arg.startsWith('--bump='));
  const explicitLevel = explicitBump ? explicitBump.split('=')[1] : null;
  const flagLevel = argv.includes('--major')
    ? 'major'
    : argv.includes('--minor')
      ? 'minor'
      : argv.includes('--patch')
        ? 'patch'
        : null;
  const envLevel = env.VERSION_BUMP_LEVEL || env.VERSION_BUMP || env.RELEASE_BUMP;
  const level = explicitLevel || flagLevel || envLevel || analyzeVersionBump(context);
  if (!VALID_BUMP_LEVELS.has(level)) {
    throw new Error(`Invalid version bump level: ${level}. Use --bump=major, --bump=minor, --bump=patch, or VERSION_BUMP_LEVEL=major|minor|patch.`);
  }
  return level;
}

function nextVersion(currentVersion, bumpLevel) {
  const [major, minor, patch] = currentVersion.split('.').map(Number);
  if (bumpLevel === 'major') return `${major + 1}.0.0`;
  if (bumpLevel === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function writePackageVersion(pkgPath, version) {
  const pkgContent = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  if (pkgContent.version === version) return pkgContent;
  pkgContent.version = version;
  fs.writeFileSync(pkgPath, JSON.stringify(pkgContent, null, 2) + '\n');
  return pkgContent;
}

function syncBackendPackageVersion(version) {
  const backendPkgPath = path.join(__dirname, '..', 'backend', 'package.json');
  if (!fs.existsSync(backendPkgPath)) return null;
  return writePackageVersion(backendPkgPath, version);
}

function syncGatewayPackageVersion(version) {
  const gatewayRoot = path.join(__dirname, '..', 'gateway');
  const gatewayPkgPath = path.join(gatewayRoot, 'package.json');
  if (!fs.existsSync(gatewayPkgPath)) return null;
  const result = writePackageVersion(gatewayPkgPath, version);
  syncPackageLockVersion(path.join(gatewayRoot, 'package-lock.json'), version);
  return result;
}

function syncCloudBusinessApiPackageVersion(version) {
  const packagePath = path.join(__dirname, '..', 'cloud-business-api', 'package.json');
  if (!fs.existsSync(packagePath)) return null;
  return writePackageVersion(packagePath, version);
}

function syncStorageAgentPackageVersion(version) {
  const packagePath = path.join(__dirname, '..', 'storage-agent', 'package.json');
  if (!fs.existsSync(packagePath)) return null;
  return writePackageVersion(packagePath, version);
}

function syncMiniappPackageVersion(version, { packagePath } = {}) {
  const miniappPkgPath = packagePath || path.join(__dirname, '..', 'miniapp', 'package.json');
  if (!fs.existsSync(miniappPkgPath)) return null;
  const result = writePackageVersion(miniappPkgPath, version);
  syncPackageLockVersion(path.join(path.dirname(miniappPkgPath), 'package-lock.json'), version);
  return result;
}

function resolveComponent(args = []) {
  const inline = args.find(arg => arg.startsWith('--component='));
  const named = inline ? inline.slice('--component='.length) : (() => {
    const index = args.indexOf('--component');
    return index >= 0 ? args[index + 1] : '';
  })();
  const component = String(named || 'desktop').trim().replace(/-/g, '_');
  if (!COMPONENTS[component]) {
    throw new Error(`Invalid release component: ${component || '<empty>'}. Use desktop, cloud_business, storage_proxy, or miniapp.`);
  }
  return component;
}

function updateComponentVersion(component, version, { now } = {}) {
  const config = COMPONENTS[component];
  if (!config) throw new Error(`Invalid release component: ${component || '<empty>'}`);
  const pkg = writePackageVersion(config.packagePath, version);
  if (config.lockPath) syncPackageLockVersion(config.lockPath, version);
  if (config.generatesDesktopVersion) writeGeneratedVersion(pkg, now);
  return pkg;
}

function syncPackageLockVersion(lockPath, version) {
  if (!fs.existsSync(lockPath)) return null;
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
  if (lock.version === version && (!lock.packages || !lock.packages[''] || lock.packages[''].version === version)) {
    return lock;
  }
  lock.version = version;
  if (lock.packages && lock.packages['']) lock.packages[''].version = version;
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
  return lock;
}

function sleepSync(delayMs) {
  if (delayMs <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
}

function writeFileUtf8WithRetry(targetPath, contents, {
  retries = 4,
  retryDelayMs = 120,
  writeFileSync = fs.writeFileSync,
  sleep = sleepSync,
} = {}) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return writeFileSync(targetPath, contents, 'utf8');
    } catch (error) {
      const transient = ['UNKNOWN', 'EBUSY', 'EPERM'].includes(String(error?.code || ''));
      if (!transient || attempt === retries) throw error;
      sleep(retryDelayMs * (attempt + 1));
    }
  }
}

function writeGeneratedVersion(pkg, now = new Date()) {
  const outDir = path.join(__dirname, '..', 'src', 'generated');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const buildTag = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  writeFileUtf8WithRetry(
    path.join(outDir, 'version.ts'),
    `// Auto-generated - do not edit\n// Updated: ${now.toISOString()}\n// Build: ${buildTag}\nexport const APP_VERSION = "${pkg.version}";\nexport const BUILD_TAG = "${buildTag}";\n`,
  );
  console.log(`Generated version.ts: ${pkg.version} (build ${buildTag})`);
}

function main() {
  const args = process.argv.slice(2);
  const component = resolveComponent(args);
  const config = COMPONENTS[component];
  const pkg = JSON.parse(fs.readFileSync(config.packagePath, 'utf8'));

  if (args.includes('--bump') || args.some(arg => arg.startsWith('--bump='))) {
    const bumpLevel = resolveBumpLevel(args);
    const newVersion = nextVersion(pkg.version, bumpLevel);
    updateComponentVersion(component, newVersion);
    console.log(`${component} version bumped (${bumpLevel}): ${pkg.version} → ${newVersion}`);
  } else {
    updateComponentVersion(component, pkg.version);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  analyzeVersionBump,
  COMPONENTS,
  filterReleaseArtifactPaths,
  nextVersion,
  readChangeContext,
  resolveBumpLevel,
  resolveComponent,
  syncBackendPackageVersion,
  syncGatewayPackageVersion,
  syncMiniappPackageVersion,
  syncPackageLockVersion,
  updateComponentVersion,
  writeFileUtf8WithRetry,
};
