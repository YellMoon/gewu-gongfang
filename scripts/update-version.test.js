const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const version = require('./update-version');

const source = fs.readFileSync('scripts/update-version.js', 'utf-8');
const packageJson = fs.readFileSync('package.json', 'utf-8');
const desktopDistCommand = JSON.parse(packageJson).scripts['dist:win'];

assert.ok(desktopDistCommand, 'desktop packaging command must exist');
assert.strictEqual(
  (desktopDistCommand.match(/scripts\/update-version\.js/g) || []).length,
  0,
  'desktop packaging must consume the prepared release version and never bump it again',
);
assert.ok(desktopDistCommand.includes('scripts/release-matrix.js assert --target desktop'),
  'desktop packaging must require the prepared unified release manifest');
assert.ok(!desktopDistCommand.includes('npm run build'),
  'desktop packaging must not call the build script that regenerates the version file a second time');

assert.ok(source.includes('resolveBumpLevel'), 'update-version should resolve an explicit bump level');
assert.strictEqual(
  version.analyzeVersionBump({ files: ['src/App.tsx'], diff: 'fix: 修复按钮错位' }),
  'patch',
  'bug/style fixes should auto bump patch'
);
assert.deepStrictEqual(
  version.filterReleaseArtifactPaths([
    'dist-host/win-unpacked/resources/app/backend/src/routes/sync.js',
    'tmp-e2e-host-connectivity-20260730c/win-unpacked/resources/app/package.json',
    'output/task14-release/cloud-backup-latest.json',
    'src/pages/SystemSettings.tsx',
  ]),
  ['src/pages/SystemSettings.tsx'],
  'generated packages, disposable E2E roots, and release evidence must not affect automatic version classification'
);
assert.strictEqual(
  version.analyzeVersionBump({ files: ['src/pages/ScheduleCalendar.tsx'], diff: '修复批量删除确认弹窗乱码，并确保删除后课程不再恢复' }),
  'patch',
  'page-level bug fixes should auto bump patch instead of minor'
);
assert.strictEqual(
  version.analyzeVersionBump({
    files: ['backend/src/routes/cloudRelayHost.js'],
    diff: [
      'diff --git a/backend/src/routes/cloudRelayHost.js b/backend/src/routes/cloudRelayHost.js',
      '@@ -613,7 +619,9 @@ router' + '.post(\'/tasks/process\', async (req, res, next) => {',
      ' router' + '.post(\'/tasks/process\', async (req, res, next) => {',
      '+  const relayAssertionSecret = process.env.GEWU_CLOUD_RELAY_HOST_TOKEN || \'\';',
      '+  if (!relayAssertionSecret) throw new Error(\'RELAY_ASSERTION_SECRET_REQUIRED\');',
    ].join('\n'),
  }),
  'patch',
  'context lines from an existing route must not make a relay bug fix look like a new public API'
);
assert.strictEqual(
  version.analyzeVersionBump({
    files: ['src/services/desktopIdentityClient.mjs'],
    diff: '+  const retryablePairingClient = createDesktopIdentityClient({',
  }),
  'patch',
  'existing identifiers containing create must not be treated as feature declarations'
);
assert.strictEqual(
  version.analyzeVersionBump({
    files: ['scripts/update-version.test.js'],
    diff: "assert.ok(source.includes('--bump=major'), 'update-version should document --bump=major');\n修复自动版本分类误判",
  }),
  'patch',
  'mentioning --bump=major in tests/docs should not force a major release'
);
assert.strictEqual(
  version.analyzeVersionBump({ files: ['backend/src/routes/permissions.js'], diff: '新增权限接口 router.get' }),
  'minor',
  'new routes/features should auto bump minor'
);
assert.strictEqual(
  version.analyzeVersionBump({ files: ['backend/src/schema.sql'], diff: 'BREAKING CHANGE: 删除旧字段' }),
  'major',
  'breaking changes should auto bump major'
);

assert.strictEqual(
  version.analyzeVersionBump({
    files: ['src/services/syncApi.ts'],
    deletedFiles: ['src/services/syncApi.ts'],
    diff: '',
  }),
  'major',
  'deleting an executable public API path should auto bump major'
);
assert.strictEqual(
  version.resolveBumpLevel(['--bump'], {}, { files: ['miniapp/src/pages/new-page/index.tsx'], diff: '新增页面' }),
  'minor',
  'plain --bump should auto-detect bump level'
);
assert.ok(source.includes('--bump=major'), 'update-version should document --bump=major');
assert.ok(source.includes('--bump=minor'), 'update-version should document --bump=minor');
assert.ok(source.includes('--bump=patch'), 'update-version should document --bump=patch');
assert.ok(source.includes('VERSION_BUMP_LEVEL'), 'update-version should support env-driven bump level');
assert.ok(source.includes('syncBackendPackageVersion'), 'update-version should sync backend/package.json with the root package version');
assert.ok(source.includes('syncGatewayPackageVersion'), 'update-version should sync gateway/package.json with the unified root release version');
const lockFixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-version-lock-'));
const lockFixturePath = path.join(lockFixtureDir, 'package-lock.json');
fs.writeFileSync(lockFixturePath, JSON.stringify({ version: '1.2.3', packages: { '': { version: '1.2.3' } } }, null, 2));
version.syncPackageLockVersion(lockFixturePath, '2.0.0');
const syncedLock = JSON.parse(fs.readFileSync(lockFixturePath, 'utf8'));
assert.strictEqual(syncedLock.version, '2.0.0', 'version bump should sync package-lock top-level version');
assert.strictEqual(syncedLock.packages[''].version, '2.0.0', 'version bump should sync package-lock root package version');
const originalWriteFileSync = fs.writeFileSync;
let redundantLockWrites = 0;
fs.writeFileSync = (targetPath, ...args) => {
  if (targetPath === lockFixturePath) redundantLockWrites += 1;
  return originalWriteFileSync(targetPath, ...args);
};
try {
  version.syncPackageLockVersion(lockFixturePath, '2.0.0');
} finally {
  fs.writeFileSync = originalWriteFileSync;
}
assert.strictEqual(redundantLockWrites, 0, 'version sync must not rewrite an already-current lockfile');
let generatedWriteAttempts = 0;
const generatedVersionPath = path.join(lockFixtureDir, 'generated-version.ts');
version.writeFileUtf8WithRetry(generatedVersionPath, 'export const APP_VERSION = "9.9.9";\n', {
  retries: 1,
  retryDelayMs: 0,
  sleep: () => {},
  writeFileSync: (...args) => {
    generatedWriteAttempts += 1;
    if (generatedWriteAttempts === 1) {
      const error = new Error('transient Windows file open failure');
      error.code = 'UNKNOWN';
      throw error;
    }
    return originalWriteFileSync(...args);
  },
});
assert.strictEqual(generatedWriteAttempts, 2, 'generated version writes should retry a transient Windows open failure once');
assert.match(fs.readFileSync(generatedVersionPath, 'utf8'), /9\.9\.9/, 'retry should preserve the generated version content');
assert.ok(packageJson.includes('version:bump:major'), 'package scripts should expose major version bump');
assert.ok(packageJson.includes('version:bump:minor'), 'package scripts should expose minor version bump');
assert.ok(packageJson.includes('version:bump:patch'), 'package scripts should expose patch version bump');
assert.ok(packageJson.includes('scripts/update-version.test.js'), 'version bump rule test should run in npm test');

console.log('update-version checks passed');
