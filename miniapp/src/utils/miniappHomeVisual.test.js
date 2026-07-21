const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf-8');

const homePage = read('src/pages/index/index.tsx');
const homeStyles = read('src/pages/index/index.scss');
const sharedStyles = read('src/components/shared.scss');
const tabbarStyles = read('src/custom-tab-bar/index.scss');
const accountStatusBanner = read('src/components/AccountStatusBanner.tsx')
  .replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
const membershipBadge = read('src/components/MembershipBadge.tsx');

assert.ok(
  homePage.includes('home-hero') &&
    homePage.includes('home-status-panel') &&
    homePage.includes('home-action-list') &&
    homePage.includes('home-module-mark'),
  'miniapp home should use a product-grade hero, status panel, and action list structure'
);

assert.ok(homePage.includes('isUnrecognizedIdentity') && homePage.includes('AccountStatusBanner'), 'home must render a real unrecognized-account shell before formal data loading');
assert.ok(accountStatusBanner.includes('当前为体验账号。提交真实资料并经管理员审核后，可使用相应正式功能。'));
assert.ok(membershipBadge.includes("membership?.status !== 'active'"), 'membership badge must be derived only from the server membership state');
for (const forbiddenMarketingCopy of ['购买', '续费', '套餐', '会员价格', '会员权益']) {
  assert.ok(!membershipBadge.includes(forbiddenMarketingCopy));
}

assert.ok(
  !/[📅📝💰📊👨‍🎓📚📘👥✉️📦]/u.test(homePage),
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
