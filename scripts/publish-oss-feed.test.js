const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const yaml = require('js-yaml');

const packageJson = require('../package.json');
const publishScript = fs.readFileSync(path.join(__dirname, 'publish-oss-feed.js'), 'utf8');
const electronMain = fs.readFileSync(path.join(__dirname, '..', 'public', 'electron.js'), 'utf8');
const quarkUpload = fs.readFileSync(path.join(__dirname, 'upload-quark-clean.js'), 'utf8');
const beijingUpdateBaseUrl = 'https://gewu-staging-edu.oss-cn-beijing.aliyuncs.com/desktop';

assert.ok(
  packageJson.scripts['publish:desktop-rollback'],
  'package scripts should expose an OSS desktop rollback command'
);
assert.ok(
  packageJson.build.publish.some(item => item.url === `${beijingUpdateBaseUrl}/`),
  'electron-builder publish URL should point to the Beijing OSS desktop update bucket'
);
assert.ok(
  electronMain.includes(`${beijingUpdateBaseUrl}/`),
  'desktop auto-updater should default to the Beijing OSS update feed'
);
assert.ok(
  publishScript.includes(beijingUpdateBaseUrl),
  'OSS publish script should default to the Beijing OSS desktop update bucket'
);
assert.ok(
  quarkUpload.includes(beijingUpdateBaseUrl),
  'Quark upload metadata should reference the Beijing OSS desktop update bucket'
);
assert.ok(
  quarkUpload.includes("process.env.QUARK_BROWSER_MODE || 'fast'") &&
  quarkUpload.includes('Launching Edge in fast cookie mode') &&
  quarkUpload.includes("browserMode === 'persistent'") &&
  quarkUpload.includes('launchPersistentContext(PROFILE_DIR'),
  'Quark upload should default to fast cookie mode and keep persistent Edge profile only as a fallback'
);

function runPublish(args, env) {
  const result = spawnSync(process.execPath, ['scripts/publish-oss-feed.js', ...args], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      ...env,
      OSS_CDN_BASE_URL: 'https://example.oss-cn-hangzhou.aliyuncs.com/desktop',
      OSS_OBJECT_PREFIX: 'desktop',
    },
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(`publish script failed:\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }

  return JSON.parse(result.stdout);
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-oss-publish-'));
try {
  const distDir = path.join(tempRoot, 'dist');
  fs.mkdirSync(distDir, { recursive: true });
  const installerName = `格物工坊 Setup ${packageJson.version}.exe`;
  fs.writeFileSync(path.join(distDir, installerName), Buffer.from('fake installer'));

  const publish = runPublish(['--dry-run', '--write-feed'], { DIST_DIR: distDir });
  assert.strictEqual(publish.version, packageJson.version, 'publish output should use package version');
  assert.strictEqual(publish.mode, 'publish', 'normal invocation should publish');
  assert.strictEqual(
    publish.release_archive.latest_yml.oss_key,
    `desktop/releases/${packageJson.version}/latest.yml`,
    'publish should archive each release feed for rollback'
  );
  assert.strictEqual(
    publish.release_archive.installer.oss_key,
    `desktop/releases/${packageJson.version}/${installerName}`,
    'publish should archive each installer beside its release feed'
  );
  assert.deepStrictEqual(
    publish.planned_upload.map(item => item.key),
    [
      `desktop/${installerName}`,
      `desktop/releases/${packageJson.version}/${installerName}`,
      `desktop/releases/${packageJson.version}/latest.yml`,
      'desktop/latest.yml',
    ],
    'publish should upload immutable artifacts before flipping latest.yml'
  );
  assert.deepStrictEqual(
    yaml.load(publish.latest_yml.content),
    {
      version: packageJson.version,
      files: [{
        url: installerName,
        sha512: publish.installer.sha512,
        size: publish.installer.size,
      }],
      path: installerName,
      sha512: publish.installer.sha512,
      releaseDate: yaml.load(publish.latest_yml.content).releaseDate,
    },
    'published latest.yml should be valid YAML and keep Chinese installer names parseable'
  );

  const archivedFeedPath = path.join(distDir, 'releases', packageJson.version, 'latest.yml');
  assert.ok(fs.existsSync(archivedFeedPath), 'publish should write a local archived latest.yml');
  assert.strictEqual(
    fs.readFileSync(archivedFeedPath, 'utf8'),
    fs.readFileSync(path.join(distDir, 'latest.yml'), 'utf8'),
    'current and archived feed files should match for the same release'
  );

  const rollbackFeed = path.join(tempRoot, '5.0.38-latest.yml');
  fs.writeFileSync(
    rollbackFeed,
    [
      'version: 5.0.38',
      'files:',
      '  - url: old.exe',
      '    sha512: fake',
      '    size: 123',
      'path: old.exe',
      'sha512: fake',
      "releaseDate: '2026-06-29T00:00:00.000Z'",
      '',
    ].join('\n'),
    'utf8'
  );

  const rollback = runPublish(['--rollback=5.0.38', '--dry-run', '--write-feed'], {
    DIST_DIR: distDir,
    ROLLBACK_FEED_PATH: rollbackFeed,
  });
  assert.strictEqual(rollback.mode, 'rollback', 'rollback invocation should not publish a new installer');
  assert.strictEqual(rollback.rollback.version, '5.0.38', 'rollback should target the requested version');
  assert.strictEqual(
    rollback.rollback.source.oss_key,
    'desktop/releases/5.0.38/latest.yml',
    'rollback should read the archived release feed'
  );
  assert.deepStrictEqual(
    rollback.planned_upload.map(item => item.key),
    ['desktop/latest.yml'],
    'rollback should only move latest.yml back to the archived release feed'
  );
  assert.ok(
    fs.readFileSync(path.join(distDir, 'latest.yml'), 'utf8').includes('version: 5.0.38'),
    'rollback should write the target feed to the local latest.yml'
  );
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log('publish oss feed checks passed');
