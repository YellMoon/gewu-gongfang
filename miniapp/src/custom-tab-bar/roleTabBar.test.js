const assert = require('assert');
const fs = require('fs');

const appConfig = fs.readFileSync('miniapp/src/app.config.ts', 'utf-8');
const tabBar = fs.readFileSync('miniapp/src/custom-tab-bar/index.tsx', 'utf-8');
const tabBarStyle = fs.readFileSync('miniapp/src/custom-tab-bar/index.scss', 'utf-8');
const packageJson = fs.readFileSync('package.json', 'utf-8');

assert.ok(appConfig.includes('custom: true'), 'miniapp should enable custom tabBar');
assert.ok(tabBar.includes('ADMIN_TABS'), 'custom tabBar should define admin tabs');
assert.ok(tabBar.includes('STUDENT_TABS'), 'custom tabBar should define student tabs');
assert.ok(tabBar.includes('pages/assets/index'), 'admin tabBar should include real assets page');
assert.ok(tabBar.includes('pages/students/index'), 'admin tabBar should include real students page');
assert.ok(tabBar.includes('pages/settings/index'), 'role tabBar should include real settings page');
assert.ok(tabBar.includes('selectedIconPath'), 'custom tabBar should use real tab icon assets');
assert.ok(tabBar.includes("userType === 'student'"), 'custom tabBar should switch by student role');
assert.ok(tabBar.includes('switchTab'), 'custom tabBar should navigate with switchTab');
assert.ok(tabBarStyle.includes('safe-area-inset-bottom'), 'custom tabBar should support bottom safe area');
assert.ok(tabBarStyle.includes('role-tabbar'), 'custom tabBar should have scoped styles');
assert.ok(packageJson.includes('miniapp/src/custom-tab-bar/roleTabBar.test.js'), 'custom tabBar test should run in npm test');

const forbiddenCopy = ['学籍', '分班', '档案', '只读', '主机处理', '提交任务', '模拟训练', '错题巩固'];
for (const copy of forbiddenCopy) {
  assert.ok(!tabBar.includes(copy), `custom tabBar should not include unsupported or explanatory copy: ${copy}`);
}

console.log('role tabBar checks passed');
