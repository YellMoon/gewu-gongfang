const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { getMiniappHomeDisplayName, getMiniappHomeRoleLabel } = require('./miniappHomePresentation');

const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf-8');

const homePage = read('src/pages/index/index.tsx');
const homeStyles = read('src/pages/index/index.scss');
const sharedStyles = read('src/components/shared.scss');
const tabbarStyles = read('src/custom-tab-bar/index.scss');
const accountEntry = read('src/pages/settings/index.tsx')
  .replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
const membershipBadge = read('src/components/MembershipBadge.tsx');

assert.ok(
  homePage.includes('home-hero') &&
    homePage.includes('home-status-panel') &&
    homePage.includes('home-action-list') &&
    homePage.includes('home-module-mark'),
  'miniapp home should use a product-grade hero, status panel, and action list structure'
);

assert.ok(
  homePage.includes('isVisitorIdentity') &&
    homePage.includes('if (visitor && user)') &&
    homePage.includes("'/pages/account-application/index'"),
  'home must render the visitor-only preview and role-application shell before formal data loading',
);
for (const retiredHostAuthorityCopy of ['\u7b49\u5f85\u4e3b\u673a\u53d1\u5e03', '\u672c\u5730\u53ef\u7528']) {
  assert.ok(!homePage.includes(retiredHostAuthorityCopy), 'home must not present a retired host or local cache as the publishing authority');
}
assert.ok(homePage.includes("cloudConnection === 'connected'") && homePage.includes("cloudConnection === 'unavailable'"), 'home must distinguish available and unavailable cloud projections');
assert.strictEqual(getMiniappHomeDisplayName({}), '\u5fae\u4fe1\u7528\u6237');
assert.strictEqual(getMiniappHomeDisplayName({ name: '  ', nickname: ' \u5c0f\u683c ' }), '\u5c0f\u683c');
assert.strictEqual(getMiniappHomeDisplayName({ name: '\u683c\u7269\u540c\u5b66', nickname: '\u5907\u7528\u540d' }), '\u683c\u7269\u540c\u5b66');
assert.strictEqual(getMiniappHomeRoleLabel('super_admin'), '\u8d85\u7ea7\u7ba1\u7406\u5458');
assert.strictEqual(getMiniappHomeRoleLabel('teacher'), '\u6559\u5e08');
assert.strictEqual(getMiniappHomeRoleLabel('student'), '\u5b66\u751f');
assert.strictEqual(getMiniappHomeRoleLabel('visitor'), '');
assert.strictEqual(getMiniappHomeRoleLabel({ user_type: 'student', identity_kind: 'family_member', student_relationship: 'guardian' }), '家庭成员');
assert.strictEqual(getMiniappHomeRoleLabel('unknown-role'), 'unknown-role');
assert.ok(!accountEntry.includes('\u8bbf\u5ba2\u8d26\u53f7'), 'My must not persistently label a person as a visitor');
assert.ok(accountEntry.includes('\u7533\u8bf7\u89d2\u8272'), 'My must retain the role-application action');
assert.ok(!accountEntry.includes('AccountStatusBanner'), 'My must not render a duplicate role banner');
assert.ok(homePage.includes('getMiniappHomeDisplayName(user)'), 'home greeting must normalize missing and blank identity names');
assert.ok(homePage.includes('getMiniappHomeRoleLabel(user)'), 'home role pill must use the shared localized role label helper with the family-member relationship');
assert.ok(homePage.includes('name: getMiniappHomeDisplayName(savedUser)') && homePage.includes('name: getMiniappHomeDisplayName(confirmedUser)'), 'home state must never retain an absent identity name');
assert.match(
  homePage,
  /const handleModuleClick[\s\S]*?\}, \[access\.modules\]\);/,
  'home module cards must read the current role permissions when tapped, not the empty permissions captured during first render',
);
assert.ok(
  homePage.includes('await fetchPermissions()') &&
    homePage.includes('getEffectiveMiniappAccess(confirmedUser)'),
  'home and the role tab bar must derive access from the same refreshed cloud authorization state',
);
assert.ok(homePage.includes("isStudent ? '已关联课程' : '今日收入'"), 'student and guardian home metrics must replace financial cards with their own course count');
assert.ok(homePage.includes("!isStudent && <View className=\"home-metric-card tone-indigo\">"), 'student and guardian views must not render monthly revenue');
assert.ok(homePage.includes("!isStudent && <View className=\"home-metric-card tone-amber\">"), 'student and guardian views must not render the institution-wide student total');
assert.ok(membershipBadge.includes("membership?.status !== 'active'"), 'membership badge must be derived only from the server membership state');
for (const forbiddenMarketingCopy of ['\u8d2d\u4e70', '\u7eed\u8d39', '\u5957\u9910', '\u4f1a\u5458\u4ef7\u683c', '\u4f1a\u5458\u6743\u76ca']) {
  assert.ok(!membershipBadge.includes(forbiddenMarketingCopy));
}

assert.ok(
  !/[\u{1F4C5}\u{1F4DD}\u{1F4B0}\u{1F4CA}\u{1F468}\u{200D}\u{1F393}\u{1F4DA}\u{1F4D8}\u{1F465}\u{2709}\u{1F4E6}]/u.test(homePage),
  'miniapp home should not rely on emoji as primary navigation icons'
);

assert.ok(
  homeStyles.includes('#f7f4ee') &&
    homeStyles.includes('home-hero__title') &&
    homeStyles.includes('home-metric-card') &&
    homeStyles.includes('home-action-card'),
  'miniapp home styles should define the refreshed warm neutral dashboard language'
);

assert.ok(
  sharedStyles.includes('st-card::before') &&
    sharedStyles.includes('letter-spacing: 0') &&
    sharedStyles.includes('box-shadow: 0 14rpx 36rpx'),
  'shared miniapp cards should use refined stat card styling with stable typography'
);

assert.ok(
  tabbarStyles.includes('role-tabbar-item::after') &&
    tabbarStyles.includes('backdrop-filter') &&
    tabbarStyles.includes('active .role-tabbar-icon'),
  'role tab bar should have a polished active state and translucent surface'
);

console.log('miniapp home visual checks passed');
