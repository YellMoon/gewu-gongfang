'use strict';

const assert = require('assert');
const { buildApplicationMenu, desktopWindowChrome } = require('./electronShellPolicy');
const { updateFeedForFlavor } = require('./desktopBuildFlavor');

assert.strictEqual(buildApplicationMenu({ isPackaged: true }), null);
const developmentMenu = buildApplicationMenu({ isPackaged: false });
assert.strictEqual(developmentMenu.debugOnly, true);
assert.ok(Array.isArray(developmentMenu.template) && developmentMenu.template.length > 0);
assert.deepStrictEqual(desktopWindowChrome(), {
  autoHideMenuBar: true,
  menuBarVisible: false,
});
assert.strictEqual(updateFeedForFlavor('unified-desktop', {}),
  'https://gewu-staging-edu.oss-cn-beijing.aliyuncs.com/desktop/');
assert.strictEqual(updateFeedForFlavor('primary-host', {}),
  'https://gewu-staging-edu.oss-cn-beijing.aliyuncs.com/desktop/');

console.log('electron shell policy checks passed');
