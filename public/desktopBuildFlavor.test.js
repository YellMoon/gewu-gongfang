'use strict';

const assert = require('assert');
const fs = require('fs');
const {
  DESKTOP_CLIENT_FLAVOR,
  PRIMARY_HOST_FLAVOR,
  resolveDesktopBuildFlavor,
  updateFeedForFlavor,
} = require('./desktopBuildFlavor');

assert.strictEqual(resolveDesktopBuildFlavor({ isPackaged: true, metadata: {} }), DESKTOP_CLIENT_FLAVOR);
assert.strictEqual(resolveDesktopBuildFlavor({
  isPackaged: true,
  metadata: { desktopBuildFlavor: DESKTOP_CLIENT_FLAVOR },
  env: { GEWU_DESKTOP_BUILD_FLAVOR: PRIMARY_HOST_FLAVOR },
}), DESKTOP_CLIENT_FLAVOR, 'a packaged ordinary build must not be promoted by environment variables');
assert.strictEqual(resolveDesktopBuildFlavor({
  isPackaged: true,
  metadata: { desktopBuildFlavor: PRIMARY_HOST_FLAVOR },
}), PRIMARY_HOST_FLAVOR);
assert.strictEqual(resolveDesktopBuildFlavor({
  isPackaged: false,
  metadata: { desktopBuildFlavor: DESKTOP_CLIENT_FLAVOR },
  env: { GEWU_DESKTOP_BUILD_FLAVOR: PRIMARY_HOST_FLAVOR },
}), PRIMARY_HOST_FLAVOR, 'development may explicitly exercise the host-only runtime');
assert.strictEqual(
  updateFeedForFlavor(DESKTOP_CLIENT_FLAVOR),
  'https://gewu-staging-edu.oss-cn-beijing.aliyuncs.com/desktop/',
);
assert.strictEqual(
  updateFeedForFlavor(PRIMARY_HOST_FLAVOR),
  'https://gewu-staging-edu.oss-cn-beijing.aliyuncs.com/desktop/host/',
);
assert.strictEqual(
  updateFeedForFlavor(PRIMARY_HOST_FLAVOR, { UPDATE_FEED_URL: 'https://updates.example/custom' }),
  'https://updates.example/custom/',
);

const packageJson = require('../package.json');
const hostBuild = require('../electron-builder.host.config.cjs');
const electronSource = fs.readFileSync('public/electron.js', 'utf8');
const preloadSource = fs.readFileSync('public/preload.js', 'utf8');
assert.strictEqual(packageJson.desktopBuildFlavor, DESKTOP_CLIENT_FLAVOR);
assert.strictEqual(hostBuild.extraMetadata.desktopBuildFlavor, PRIMARY_HOST_FLAVOR);
assert.strictEqual(hostBuild.directories.output, 'dist-host');
assert.ok(hostBuild.publish.some(entry => entry.url.endsWith('/desktop/host/')));
assert.ok(electronSource.includes('if (PRIMARY_HOST_CAPABLE)'));
assert.ok(electronSource.includes("config.nodeRole !== 'desktop-client'"));
assert.ok(preloadSource.includes("if (desktopBuildFlavor === 'primary-host')"));
assert.ok(packageJson.build.files.includes('public/desktopBuildFlavor.js'));
for (const hostOnlyFile of [
  'public/primaryHostCredentialStore.js',
  'public/primaryHostOperationValidation.js',
  'public/primaryHostRuntimeManager.js',
]) {
  assert.ok(!packageJson.build.files.includes(hostOnlyFile), `ordinary package must exclude ${hostOnlyFile}`);
  assert.ok(hostBuild.files.includes(hostOnlyFile), `host package must include ${hostOnlyFile}`);
}
assert.ok(packageJson.scripts['publish:desktop-host-update']);

console.log('desktop build flavor checks passed');
