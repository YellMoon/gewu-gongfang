const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pageInventory } = require('./miniappUiPageInventory');

const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf-8');

const appConfig = read('src/app.config.ts');
const pagesMatch = appConfig.match(/pages:\s*\[([\s\S]*?)\]/);
assert.ok(pagesMatch, 'app.config.ts should define pages');

const configuredPages = Array.from(pagesMatch[1].matchAll(/'([^']+)'/g), (match) => match[1]);
const inventoryRoutes = pageInventory.map((entry) => entry.route);
const duplicates = inventoryRoutes.filter((route, index) => inventoryRoutes.indexOf(route) !== index);

assert.deepStrictEqual(duplicates, [], 'miniapp UI inventory should not contain duplicate routes');

const missingFromInventory = configuredPages.filter((route) => !inventoryRoutes.includes(route));
assert.deepStrictEqual(
  missingFromInventory,
  [],
  'miniapp UI inventory must cover every route registered in app.config.ts'
);

const forbidden = pageInventory.find((entry) => entry.route === 'pages/forbidden/index');
assert.ok(forbidden && forbidden.registered === true, 'miniapp UI inventory must include the registered forbidden state page');

for (const route of configuredPages) {
  const entry = pageInventory.find((item) => item.route === route);
  assert.ok(entry.registered, `${route} should be marked as a registered page`);
}

for (const entry of pageInventory) {
  assert.ok(Array.isArray(entry.roleViews) && entry.roleViews.length > 0, `${entry.route} needs role coverage`);
  assert.ok(entry.visualStatus === 'optimized', `${entry.route} must be marked optimized before completion`);
  assert.ok(entry.screenshotRequired === true, `${entry.route} must require screenshot evidence`);
  assert.ok(Array.isArray(entry.verificationStates) && entry.verificationStates.length > 0, `${entry.route} needs verification states`);
  assert.ok(Array.isArray(entry.realFeatureBasis) && entry.realFeatureBasis.length > 0, `${entry.route} needs traceable real feature basis`);
  assert.ok(Array.isArray(entry.files) && entry.files.length >= 2, `${entry.route} needs source and style files`);
  entry.files.forEach((file) => {
    assert.ok(fs.existsSync(path.join(root, file)), `${entry.route} references missing file ${file}`);
  });
}

const coveredRoles = new Set(pageInventory.flatMap((entry) => entry.roleViews));
assert.ok(coveredRoles.has('admin'), 'miniapp UI inventory must cover admin UI');
assert.ok(coveredRoles.has('student'), 'miniapp UI inventory must cover student UI');
assert.ok(coveredRoles.has('guest'), 'miniapp UI inventory must cover login/guest UI');

const uiFilesToScan = [
  'src/app.tsx',
  ...pageInventory.flatMap((entry) => entry.files).filter((file) => file.endsWith('.tsx')),
  'src/components/shared.tsx',
  'src/custom-tab-bar/index.tsx',
];
const emojiPattern = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const filesWithEmoji = uiFilesToScan.filter((file) => emojiPattern.test(read(file)));
assert.deepStrictEqual(filesWithEmoji, [], 'miniapp UI source should not use emoji as visible UI assets');

console.log('miniapp full-page UI coverage checks passed');
