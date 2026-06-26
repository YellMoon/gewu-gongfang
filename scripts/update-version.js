const fs = require('fs');
const path = require('path');
const pkg = require('../package.json');

// 版本号规则：Major.Minor.Patch (语义化版本)
// Major: 架构大改、不兼容的 API 变更
// Minor: 新功能、向后兼容的改进
// Patch: Bug 修复、小调整
// 示例：2.3.0 → 新功能 → 2.4.0；2.3.0 → 修bug → 2.3.1

const outDir = path.join(__dirname, '..', 'src', 'generated');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

// 获取当前日期用于构建标识
const now = new Date();
const buildTag = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;

fs.writeFileSync(
  path.join(outDir, 'version.ts'),
  `// Auto-generated - do not edit\n// Updated: ${now.toISOString()}\n// Build: ${buildTag}\nexport const APP_VERSION = "${pkg.version}";\nexport const BUILD_TAG = "${buildTag}";\n`
);
console.log(`Generated version.ts: ${pkg.version} (build ${buildTag})`);

// 如果命令行传了 --bump 参数，则自动递增版本号
const args = process.argv.slice(2);
const VALID_BUMP_LEVELS = new Set(['major', 'minor', 'patch']);

function resolveBumpLevel(argv, env = process.env) {
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
  const level = explicitLevel || flagLevel || envLevel || 'patch';
  if (!VALID_BUMP_LEVELS.has(level)) {
    throw new Error(`Invalid version bump level: ${level}. Use --bump=major, --bump=minor, --bump=patch, or VERSION_BUMP_LEVEL=major|minor|patch.`);
  }
  return level;
}

if (args.includes('--bump') || args.some(arg => arg.startsWith('--bump='))) {
  const bumpLevel = resolveBumpLevel(args);
  const [major, minor, patch] = pkg.version.split('.').map(Number);
  let newVersion;
  if (bumpLevel === 'major') {
    newVersion = `${major + 1}.0.0`;
  } else if (bumpLevel === 'minor') {
    newVersion = `${major}.${minor + 1}.0`;
  } else {
    newVersion = `${major}.${minor}.${patch + 1}`;
  }
  const pkgPath = path.join(__dirname, '..', 'package.json');
  const pkgContent = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  pkgContent.version = newVersion;
  fs.writeFileSync(pkgPath, JSON.stringify(pkgContent, null, 2) + '\n');
  console.log(`Version bumped: ${pkg.version} → ${newVersion}`);
}
