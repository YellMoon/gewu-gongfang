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

const storageSource = read('src/utils/storage.ts');
assert.ok(
  storageSource.includes("'assetRecords'") && storageSource.includes("'assetCategories'"),
  'review exit business-cache cleanup must include finance asset records and categories'
);

const reviewBannerFile = 'src/components/ReviewDemoBanner.tsx';
const reviewEntryFiles = [
  'src/pages/index/index.tsx',
  'src/pages/question-bank/index.tsx',
  'src/pages/settings/index.tsx',
  'src/pages/admin/users/index.tsx',
  'src/pages/assets/index.tsx',
  'src/pages/schedule/edit/index.tsx',
];
const missingReviewUiContracts = [];
if (!fs.existsSync(path.join(root, reviewBannerFile))) {
  missingReviewUiContracts.push('shared ReviewDemoBanner component');
} else {
  let bannerSource = read(reviewBannerFile);
  bannerSource = bannerSource.replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
  if (!bannerSource.includes('isReviewExperienceIdentity')) missingReviewUiContracts.push('strict review identity check in shared banner');
  if (!bannerSource.includes('脱敏示例数据') || !bannerSource.includes('只读')) missingReviewUiContracts.push('sanitized read-only review banner copy');
}
for (const file of reviewEntryFiles) {
  if (!read(file).includes('ReviewDemoBanner')) missingReviewUiContracts.push(`ReviewDemoBanner rendered by ${file}`);
}
for (const route of ['pages/index/index', 'pages/question-bank/index', 'pages/settings/index', 'pages/assets/index']) {
  const entry = pageInventory.find((item) => item.route === route);
  if (!entry?.roleViews.includes('review-admin') && !entry?.roleViews.includes('review-student')) {
    missingReviewUiContracts.push(`review role coverage for ${route}`);
  }
  if (!entry?.verificationStates.includes('review-read-only')) {
    missingReviewUiContracts.push(`review read-only verification state for ${route}`);
  }
}
assert.deepStrictEqual(missingReviewUiContracts, [], 'review experience entry pages must expose the shared read-only banner and inventory coverage');

const { REVIEW_ADMIN_MODULES, REVIEW_STUDENT_MODULES } = require('./miniappAuthorizationRuntime');
const reviewModuleRoutes = {
  scheduling: ['pages/schedule/index', 'pages/schedule/detail/index', 'pages/schedule/edit/index', 'pages/student-detail/index'],
  'question-bank': ['pages/question-bank/index'],
  assets: ['pages/assets/index'],
  students: ['pages/students/index', 'pages/student-detail/index'],
  courses: ['pages/courses/index'],
  teachers: ['pages/teachers/index'],
  payments: ['pages/payments/index'],
  stats: ['pages/stats/index'],
};
const expectedReviewRoles = new Map();
const addExpectedReviewRole = (route, role) => {
  const roles = expectedReviewRoles.get(route) || [];
  if (!roles.includes(role)) roles.push(role);
  expectedReviewRoles.set(route, roles.sort());
};
for (const route of ['pages/index/index', 'pages/settings/index', 'pages/forbidden/index']) {
  addExpectedReviewRole(route, 'review-admin');
  addExpectedReviewRole(route, 'review-student');
}
for (const moduleId of REVIEW_ADMIN_MODULES) {
  for (const route of reviewModuleRoutes[moduleId] || []) addExpectedReviewRole(route, 'review-admin');
}
for (const moduleId of REVIEW_STUDENT_MODULES) {
  for (const route of reviewModuleRoutes[moduleId] || []) addExpectedReviewRole(route, 'review-student');
}
addExpectedReviewRole('pages/admin/users/index', 'review-admin');

const reviewCoverageFailures = [];
for (const entry of pageInventory) {
  const expectedRoles = expectedReviewRoles.get(entry.route) || [];
  const actualRoles = entry.roleViews.filter(role => role.startsWith('review-')).sort();
  if (JSON.stringify(actualRoles) !== JSON.stringify(expectedRoles)) {
    reviewCoverageFailures.push(`${entry.route} review roles: expected ${expectedRoles.join(',') || 'none'}, got ${actualRoles.join(',') || 'none'}`);
  }
  if (expectedRoles.length === 0) continue;
  if (!entry.verificationStates.includes('review-read-only')) reviewCoverageFailures.push(`${entry.route} missing review-read-only state`);
  const pageSource = read(entry.files.find(file => file.endsWith('.tsx')));
  if (!pageSource.includes('ReviewDemoBanner')) reviewCoverageFailures.push(`${entry.route} missing ReviewDemoBanner`);
}
assert.deepStrictEqual(
  reviewCoverageFailures,
  [],
  'every registered route reachable by review authorization must declare exact review roles, read-only verification, and the shared banner'
);

console.log('miniapp full-page UI coverage checks passed');
