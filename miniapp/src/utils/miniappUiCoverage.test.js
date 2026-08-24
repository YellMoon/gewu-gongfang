const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pageInventory } = require('./miniappUiPageInventory');
const { REQUIRED_COVERAGE_CATEGORIES, runtimeScenarios } = require('./miniappUiRuntimeScenarios');

const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf-8');

const appConfig = read('src/app.config.ts');
const pagesMatch = appConfig.match(/pages:\s*\[([\s\S]*?)\]/);
assert.ok(pagesMatch, 'app.config.ts should define pages');

const configuredPages = Array.from(pagesMatch[1].matchAll(/'([^']+)'/g), (match) => match[1]);
const inventoryRoutes = pageInventory.map((entry) => entry.route);
const duplicates = inventoryRoutes.filter((route, index) => inventoryRoutes.indexOf(route) !== index);
const configuredDuplicates = configuredPages.filter((route, index) => configuredPages.indexOf(route) !== index);

assert.deepStrictEqual(duplicates, [], 'miniapp UI inventory should not contain duplicate routes');
assert.deepStrictEqual(configuredDuplicates, [], 'app.config.ts should not register duplicate routes');

const missingFromInventory = configuredPages.filter((route) => !inventoryRoutes.includes(route));
assert.deepStrictEqual(
  missingFromInventory,
  [],
  'miniapp UI inventory must cover every route registered in app.config.ts'
);
const inventoryNotRegistered = inventoryRoutes.filter((route) => !configuredPages.includes(route));
assert.deepStrictEqual(
  inventoryNotRegistered,
  [],
  'miniapp UI inventory and app.config.ts must contain exactly the same routes'
);

function listSourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listSourceFiles(absolutePath);
    if (!/\.(?:js|ts|tsx)$/.test(entry.name) || /\.test\./.test(entry.name)) return [];
    return [absolutePath];
  });
}

function staticNavigationRoute(expression) {
  const trimmed = expression.trim();
  const quote = trimmed[0];
  if (!['\'', '"', '`'].includes(quote) || trimmed.at(-1) !== quote) return '';
  const value = trimmed.slice(1, -1);
  const routePart = value.split('?')[0];
  if (!routePart.startsWith('/pages/') || routePart.includes('${')) return '';
  return routePart.slice(1);
}

const navigationCalls = [];
let navigationInvocationCount = 0;
for (const absolutePath of listSourceFiles(path.join(root, 'src'))) {
  const source = fs.readFileSync(absolutePath, 'utf8');
  navigationInvocationCount += Array.from(
    source.matchAll(/Taro\.(navigateTo|redirectTo|reLaunch|switchTab)\s*\(/g),
  ).length;
  const navigationPattern = /Taro\.(navigateTo|redirectTo|reLaunch|switchTab)\s*\(\s*\{\s*url:\s*([\s\S]*?)\s*\}\s*\)/g;
  for (const match of source.matchAll(navigationPattern)) {
    navigationCalls.push({
      file: path.relative(root, absolutePath).replace(/\\/g, '/'),
      method: match[1],
      expression: match[2].trim(),
      route: staticNavigationRoute(match[2]),
      source,
    });
  }
}
assert.strictEqual(
  navigationCalls.length,
  navigationInvocationCount,
  'every navigation invocation must use an object with an inspectable url field'
);

const dynamicNavigationPatterns = [
  {
    file: 'src/pages/index/index.tsx',
    expression: 'config.pages',
    declarationPattern: /\bpages:\s*(['"])(\/pages\/[^'"]+)\1/g,
    normalize: (value) => value.slice(1).split('?')[0],
  },
  {
    file: 'src/pages/index/index.tsx',
    expression: 'item.url',
    declarationPattern: /\burl:\s*(['"])(\/pages\/[^'"]+)\1/g,
    normalize: (value) => value.slice(1).split('?')[0],
  },
  {
    file: 'src/custom-tab-bar/index.tsx',
    expression: '`/${item.pagePath}`',
    declarationPattern: /\bpagePath:\s*(['"])(pages\/[^'"]+)\1/g,
    normalize: (value) => value.split('?')[0],
  },
  {
    file: 'src/pages/login/index.tsx',
    expression: 'homeForIdentity(user)',
    declarationPattern: /\b(?:FORMAL_HOME|UNRECOGNIZED_HOME)\s*=\s*(['"])(\/pages\/[^'"]+)\1/g,
    normalize: (value) => value.slice(1).split('?')[0],
  },
  {
    file: 'src/pages/login/index.tsx',
    expression: 'homeForIdentity(session.identity)',
    declarationPattern: /\b(?:FORMAL_HOME|UNRECOGNIZED_HOME)\s*=\s*(['"])(\/pages\/[^'"]+)\1/g,
    normalize: (value) => value.slice(1).split('?')[0],
  },
];

for (const call of navigationCalls) {
  call.routes = call.route ? [call.route] : [];
  if (call.routes.length > 0) continue;
  const resolver = dynamicNavigationPatterns.find((candidate) => (
    candidate.file === call.file && candidate.expression === call.expression
  ));
  if (!resolver) continue;
  call.routes = Array.from(
    call.source.matchAll(resolver.declarationPattern),
    (match) => resolver.normalize(match[2]),
  );
}
const unresolvedNavigationCalls = navigationCalls
  .filter((call) => call.routes.length === 0)
  .map((call) => `${call.file}: ${call.method}(${call.expression})`);
assert.deepStrictEqual(
  unresolvedNavigationCalls,
  [],
  'dynamic miniapp navigation must be resolved through an explicit, testable route declaration pattern'
);

const unregisteredNavigationTargets = navigationCalls
  .flatMap((call) => call.routes)
  .filter((route) => !configuredPages.includes(route) || !inventoryRoutes.includes(route));
assert.deepStrictEqual(
  unregisteredNavigationTargets,
  [],
  'every navigateTo/redirectTo/reLaunch/switchTab target must be registered and inventoried'
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
  assert.ok(Array.isArray(entry.runtimeScenarioIds) && entry.runtimeScenarioIds.length > 0, `${entry.route} needs runtime screenshot scenarios`);
  entry.files.forEach((file) => {
    assert.ok(fs.existsSync(path.join(root, file)), `${entry.route} references missing file ${file}`);
  });
}

const scenarioIds = runtimeScenarios.map(item => item.id);
assert.strictEqual(new Set(scenarioIds).size, scenarioIds.length, 'runtime scenario ids must be unique');
for (const scenario of runtimeScenarios) {
  const entry = pageInventory.find(item => item.route === scenario.route);
  assert.ok(entry, `${scenario.id} references an unregistered page`);
  assert.ok(entry.roleViews.includes(scenario.roleView), `${scenario.id} uses an undeclared role view`);
  assert.ok(entry.verificationStates.includes(scenario.state), `${scenario.id} uses an undeclared verification state`);
  assert.ok(typeof scenario.expectedText === 'string' && scenario.expectedText.trim(), `${scenario.id} needs visible text evidence`);
  assert.ok(Array.isArray(scenario.categories) && scenario.categories.length > 0, `${scenario.id} needs coverage categories`);
  assert.ok(entry.runtimeScenarioIds.includes(scenario.id), `${scenario.id} must be linked from the page inventory`);
}
for (const entry of pageInventory) {
  assert.deepStrictEqual(
    entry.runtimeScenarioIds.slice().sort(),
    runtimeScenarios.filter(item => item.route === entry.route).map(item => item.id).sort(),
    `${entry.route} runtime scenario links must be exact`,
  );
}
const runtimeCategories = new Set(runtimeScenarios.flatMap(item => item.categories));
for (const category of REQUIRED_COVERAGE_CATEGORIES) {
  assert.ok(runtimeCategories.has(category), `runtime screenshot matrix missing category ${category}`);
}
for (const [route, roles] of Object.entries({
  'pages/index/index': ['super_admin', 'student', 'visitor', 'unrecognized-student'],
  'pages/schedule/index': ['admin', 'student', 'unrecognized-student'],
  'pages/schedule/detail/index': ['admin', 'student'],
  'pages/schedule/edit/index': ['admin', 'student'],
  'pages/student-detail/index': ['admin', 'student'],
  'pages/question-bank/index': ['super_admin', 'student', 'unrecognized-student'],
  'pages/settings/index': ['admin', 'student', 'unrecognized-student'],
  'pages/admin/users/index': ['super_admin', 'admin'],
})) {
  const covered = new Set(runtimeScenarios.filter(item => item.route === route).map(item => item.roleView));
  roles.forEach(role => assert.ok(covered.has(role), `${route} runtime matrix missing ${role}`));
}
assert.ok(runtimeScenarios.some(item => item.state === 'preview-offline'), 'runtime matrix must capture an offline state');
assert.ok(runtimeScenarios.some(item => item.state === 'preview-forbidden'), 'runtime matrix must capture a permission-denied state');
assert.ok(runtimeScenarios.some(item => item.state === 'miniapp-readonly-boundary'), 'runtime matrix must capture the limited-write boundary');
assert.ok(pageInventory.every(entry => !entry.roleViews.includes('parent')), 'guardian access is a student relationship, not a parent role');
assert.ok(pageInventory.every(entry => !entry.roleViews.includes('super-admin')), 'role spelling must use super_admin');

const coveredRoles = new Set(pageInventory.flatMap((entry) => entry.roleViews));
assert.ok(coveredRoles.has('admin'), 'miniapp UI inventory must cover admin UI');
assert.ok(coveredRoles.has('student'), 'miniapp UI inventory must cover student UI');
assert.ok(coveredRoles.has('guest'), 'miniapp UI inventory must cover login/guest UI');

const desktopRegistrationEntry = pageInventory.find(entry => entry.route === 'pages/desktop-online-registration/index');
assert.ok(desktopRegistrationEntry?.roleViews.includes('guest'), 'online desktop registration must be a public guest entry');
assert.ok(desktopRegistrationEntry?.verificationStates.includes('cloud-confirmed'), 'online desktop registration must cover cloud confirmation');
assert.strictEqual(
  pageInventory.some(entry => entry.route === 'pages/desktop-authorization/index'),
  false,
  'retired manual desktop authorization must not remain in the UI inventory',
);

const uiFilesToScan = [
  'src/app.tsx',
  ...pageInventory.flatMap((entry) => entry.files).filter((file) => file.endsWith('.tsx')),
  'src/components/shared.tsx',
  'src/custom-tab-bar/index.tsx',
];
const emojiPattern = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const filesWithEmoji = uiFilesToScan.filter((file) => emojiPattern.test(read(file)));
assert.deepStrictEqual(filesWithEmoji, [], 'miniapp UI source should not use emoji as visible UI assets');

const storageSource = read('src/utils/storage.ts');
assert.ok(
  storageSource.includes("'assetRecords'") && storageSource.includes("'assetCategories'"),
  'review exit business-cache cleanup must include finance asset records and categories'
);

assert.ok(fs.existsSync(path.join(root, 'src/components/AccountStatusBanner.tsx')));
assert.ok(fs.existsSync(path.join(root, 'src/components/MembershipBadge.tsx')));
assert.ok(!fs.existsSync(path.join(root, 'src/components/ReviewDemoBanner.tsx')));
assert.ok(!fs.existsSync(path.join(root, 'src/utils/reviewExperience.js')));

const accountExperienceRoutes = [
  'pages/index/index',
  'pages/schedule/index',
  'pages/question-bank/index',
  'pages/settings/index',
  'pages/unrecognized-experience/index',
];
for (const route of accountExperienceRoutes) {
  const entry = pageInventory.find(item => item.route === route);
  assert.ok(entry?.roleViews.includes('unrecognized-student'), `${route} must cover the real unrecognized identity`);
}
for (const entry of pageInventory) {
  assert.ok(!entry.roleViews.some(role => role.startsWith('review-')), `${entry.route} must not retain synthetic review roles`);
  assert.ok(!entry.verificationStates.some(state => state.startsWith('review-')), `${entry.route} must not retain removed review states`);
}

const applicationEntry = pageInventory.find(item => item.route === 'pages/account-application/index');
assert.ok(applicationEntry?.roleViews.includes('visitor'), 'role application belongs to the signed visitor identity');
for (const state of [
  'loading', 'not-submitted', 'invalid', 'submitting', 'submitted', 'rejected', 'approved',
  'offline', 'network-error',
]) {
  assert.ok(applicationEntry?.verificationStates.includes(state), `account application inventory missing ${state}`);
}

const legacyClientSources = listSourceFiles(path.join(root, 'src'))
  .filter(file => !/accountExperience\.js$/.test(file) && !/miniappApiSessionRuntime\.js$/.test(file))
  .filter(file => /ReviewDemoBanner|reviewDemoApi|reviewExperience/.test(fs.readFileSync(file, 'utf8')))
  .map(file => path.relative(root, file).replace(/\\/g, '/'));
assert.deepStrictEqual(legacyClientSources, [], 'miniapp UI and client flow must not retain the removed review-demo implementation');

console.log('miniapp full-page UI coverage checks passed');
