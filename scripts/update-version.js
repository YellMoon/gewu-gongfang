const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

// 版本号规则：Major.Minor.Patch
// Major: 破坏性/不兼容变更
// Minor: 新功能、向后兼容的数据结构/接口/页面能力
// Patch: Bug 修复、样式、文档、测试、小调整

const VALID_BUMP_LEVELS = new Set(['major', 'minor', 'patch']);

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
  const diffNameOnly = runGit(['diff', '--name-only', 'HEAD']);
  const diff = runGit(['diff', 'HEAD']);
  const files = diffNameOnly
    ? diffNameOnly.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    : [];

  if (files.length > 0 || diff) return { files, diff };

  const lastCommitFiles = runGit(['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD']);
  const lastCommitMessage = runGit(['log', '-1', '--pretty=%B']);
  return {
    files: lastCommitFiles ? lastCommitFiles.split(/\r?\n/).map(line => line.trim()).filter(Boolean) : [],
    diff: lastCommitMessage,
  };
}

function hasAny(text, patterns) {
  return patterns.some(pattern => pattern.test(text));
}

function analyzeVersionBump(context = readChangeContext()) {
  const files = context.files || [];
  const diff = context.diff || '';
  const corpus = `${files.join('\n')}\n${diff}`;

  const majorSignals = [
    /BREAKING[\s_-]?CHANGE/i,
    /(?:^|\n)\s*(major|feat!)\s*:/i,
    /不兼容|破坏性|删除旧字段|删除表|重命名表|迁移必需|不可回滚/,
    /^\s*-\s*CREATE TABLE/im,
    /^\s*-\s*ALTER TABLE/im,
    /DROP\s+(TABLE|COLUMN|INDEX)/i,
  ];
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
    /新增|增加|支持|新功能|feature|add(ed)?|create(d)?|router\.(get|post|put|delete|patch)/i,
    /^\+\s*CREATE TABLE/im,
    /^\+\s*ALTER TABLE/im,
    /^\+\s*app\.use\('/m,
  ];
  if (hasAny(corpus, patchSignals) && !hasAny(corpus, minorContentSignals)) return 'patch';
  if (files.some(file => minorPathSignals.some(pattern => pattern.test(file))) && hasAny(corpus, minorContentSignals)) return 'minor';
  if (hasAny(corpus, minorContentSignals)) return 'minor';

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
  pkgContent.version = version;
  fs.writeFileSync(pkgPath, JSON.stringify(pkgContent, null, 2) + '\n');
  return pkgContent;
}

function syncBackendPackageVersion(version) {
  const backendPkgPath = path.join(__dirname, '..', 'backend', 'package.json');
  if (!fs.existsSync(backendPkgPath)) return null;
  return writePackageVersion(backendPkgPath, version);
}

function writeGeneratedVersion(pkg, now = new Date()) {
  const outDir = path.join(__dirname, '..', 'src', 'generated');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const buildTag = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  fs.writeFileSync(
    path.join(outDir, 'version.ts'),
    `// Auto-generated - do not edit\n// Updated: ${now.toISOString()}\n// Build: ${buildTag}\nexport const APP_VERSION = "${pkg.version}";\nexport const BUILD_TAG = "${buildTag}";\n`
  );
  console.log(`Generated version.ts: ${pkg.version} (build ${buildTag})`);
}

function main() {
  const pkgPath = path.join(__dirname, '..', 'package.json');
  const pkg = require(pkgPath);
  const args = process.argv.slice(2);

  if (args.includes('--bump') || args.some(arg => arg.startsWith('--bump='))) {
    const bumpLevel = resolveBumpLevel(args);
    const newVersion = nextVersion(pkg.version, bumpLevel);
    const pkgContent = writePackageVersion(pkgPath, newVersion);
    syncBackendPackageVersion(newVersion);
    writeGeneratedVersion(pkgContent);
    console.log(`Version bumped (${bumpLevel}): ${pkg.version} → ${newVersion}`);
  } else {
    syncBackendPackageVersion(pkg.version);
    writeGeneratedVersion(pkg);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  analyzeVersionBump,
  nextVersion,
  readChangeContext,
  resolveBumpLevel,
  syncBackendPackageVersion,
};
