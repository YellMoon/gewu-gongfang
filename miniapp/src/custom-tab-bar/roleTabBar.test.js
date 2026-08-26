const assert = require('assert');
const fs = require('fs');
const { resolveTabBarState } = require('./roleTabBarRuntime');

const appConfig = fs.readFileSync('miniapp/src/app.config.ts', 'utf-8');
const tabBar = fs.readFileSync('miniapp/src/custom-tab-bar/index.tsx', 'utf-8');
const tabBarStyle = fs.readFileSync('miniapp/src/custom-tab-bar/index.scss', 'utf-8');
const packageJson = fs.readFileSync('package.json', 'utf-8');

assert.ok(appConfig.includes('custom: true'), 'miniapp should enable custom tabBar');
assert.ok(tabBar.includes('STAFF_TABS'), 'custom tabBar should define admin tabs');
assert.ok(tabBar.includes('STUDENT_TABS'), 'custom tabBar should define student tabs');
assert.ok(tabBar.includes('VISITOR_TABS'), 'custom tabBar should define the signed visitor shell');
assert.ok(
  /PRIMARY_TABS[\s\S]*pages\/index\/index[\s\S]*pages\/schedule\/index[\s\S]*pages\/question-bank\/index[\s\S]*pages\/settings\/index/.test(tabBar),
  'all signed navigation shells should expose home, schedule, question bank, and account settings',
);
assert.ok(tabBar.includes('pages/question-bank/index'), 'visitor tabBar should expose the limited question-preview surface');
assert.ok(tabBar.includes('pages/schedule/index'), 'role tabBar should include the real schedule page');
assert.ok(tabBar.includes('pages/settings/index'), 'role tabBar should include real settings page');
assert.ok(tabBar.includes('iconText'), 'custom tabBar should use CSS/text icons');
const iconPaths = Array.from(appConfig.matchAll(/(?:selectedIconPath|iconPath): '([^']+)'/g), (match) => match[1]);
assert.strictEqual(iconPaths.length, 6, 'static H5 tabBar should reference normal and selected icons where native fallbacks require them');
for (const iconPath of iconPaths) {
  assert.ok(fs.existsSync(`miniapp/src/${iconPath}`), `tabBar icon asset should exist: ${iconPath}`);
}
assert.ok(tabBar.includes('STAFF_TABS'), 'custom tabBar should retain a formal navigation shell');
assert.ok(!tabBar.includes('usesLimitedQuestionProjection'), 'read-only question browsing must not downgrade a student into the visitor tab shell');
assert.ok(tabBar.includes("navigationMode === 'visitor'"), 'custom tabBar should select the visitor shell without formal permission fetch');
assert.ok(tabBar.includes('switchTab'), 'custom tabBar should navigate every primary tab with switchTab');
assert.ok(tabBar.includes('isTabPage'), 'custom tabBar should render only on real tab pages');
assert.ok(tabBar.includes('window.location.hash'), 'custom tabBar should use H5 hash route for visual QA');
assert.ok(tabBarStyle.includes('safe-area-inset-bottom'), 'custom tabBar should support bottom safe area');
assert.ok(tabBarStyle.includes('role-tabbar'), 'custom tabBar should have scoped styles');
assert.ok(packageJson.includes('miniapp/src/custom-tab-bar/roleTabBar.test.js'), 'custom tabBar test should run in npm test');

assert.deepStrictEqual(
  resolveTabBarState({ role: 'visitor', modules: ['question-bank'] }),
  { userType: 'visitor', navigationMode: 'visitor' },
  'a signed visitor must never render the staff navigation shell while the tab bar initializes',
);
assert.deepStrictEqual(
  resolveTabBarState({ role: 'teacher', modules: ['scheduling'] }),
  { userType: 'teacher', navigationMode: 'formal' },
  'a formal teacher must retain the formal navigation shell',
);
assert.deepStrictEqual(
  resolveTabBarState({ role: 'visitor', modules: [] }),
  { userType: 'visitor', navigationMode: 'visitor' },
  'an unavailable or empty access state must fail closed to the visitor navigation shell',
);

const forbiddenCopy = ['学籍', '分班', '档案', '只读', '主机处理', '提交任务', '模拟训练', '错题巩固'];
for (const copy of forbiddenCopy) {
  assert.ok(!tabBar.includes(copy), `custom tabBar should not include unsupported or explanatory copy: ${copy}`);
}

console.log('role tabBar checks passed');
