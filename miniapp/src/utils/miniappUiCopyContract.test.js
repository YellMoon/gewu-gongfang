'use strict';

const assert = require('assert');
const fs = require('fs');

const read = path => fs.readFileSync(path, 'utf8');
const display = source => source.replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
const applicationConfig = display(read('miniapp/src/pages/account-application/index.config.ts'));
const applicationPage = display(read('miniapp/src/pages/account-application/index.tsx'));
const applicationRuntime = display(read('miniapp/src/pages/account-application/applicationRuntime.js'));
const accountBanner = display(read('miniapp/src/components/AccountStatusBanner.tsx'));
const settingsPage = display(read('miniapp/src/pages/settings/index.tsx'));
const questionBankPage = display(read('miniapp/src/pages/question-bank/index.tsx'));
const questionBankStyles = read('miniapp/src/pages/question-bank/index.scss');
const homePage = display(read('miniapp/src/pages/index/index.tsx'));
const forbiddenPage = display(read('miniapp/src/pages/forbidden/index.tsx'));
const scheduleEditConfig = display(read('miniapp/src/pages/schedule/edit/index.config.ts'));
const appConfig = read('miniapp/src/app.config.ts');

const retiredTerms = [
  String.fromCharCode(27491, 24335, 36134, 21495),
  String.fromCharCode(25968, 25454, 20027, 26426),
  String.fromCharCode(26435, 23041, 21629, 20196),
  String.fromCharCode(21629, 20196, 38431, 21015),
  String.fromCharCode(20307, 39564, 36134, 21495),
];
for (const source of [applicationConfig, applicationPage, applicationRuntime, accountBanner, settingsPage]) {
  for (const retiredTerm of retiredTerms) {
    assert.ok(!source.includes(retiredTerm), `miniapp user copy must not expose retired term: ${retiredTerm}`);
  }
}

assert.ok(applicationConfig.includes(String.fromCharCode(30003, 35831, 36523, 20221)), 'the visitor application page must use an accurate title');
assert.ok(applicationRuntime.includes(String.fromCharCode(25945, 24072, 12289, 23398, 29983, 25110, 23478, 24237, 25104, 21592)), 'the visitor action must describe every selectable identity');
assert.ok(applicationPage.includes(String.fromCharCode(25552, 20132, 30003, 35831)), 'the primary visitor action must stay clear and short');
assert.ok(applicationRuntime.includes(String.fromCharCode(25968, 25454, 36127, 36131, 20154)), 'application status must explain the next real human step');

assert.ok(!settingsPage.includes('getApiBaseUrl') && !settingsPage.includes('setApiBaseUrl'), 'end users must not edit the service endpoint');
assert.ok(!settingsPage.includes(String.fromCharCode(65, 80, 73, 32, 26381, 21153, 22120, 22336)) && !settingsPage.includes(String.fromCharCode(26381, 21153, 22120, 32622)), 'settings must not leak implementation configuration');
assert.ok(!settingsPage.includes('getPendingChanges') && !settingsPage.includes('clearPendingChanges'), 'miniapp settings must not expose retired core-business draft controls');
assert.ok(settingsPage.includes(String.fromCharCode(32593, 32476, 24050, 36830, 25509)), 'settings must label device network reachability without claiming cloud health');
assert.ok(settingsPage.includes('__APP_VERSION__'), 'the displayed miniapp version must use the build version');
assert.ok(settingsPage.includes(String.fromCharCode(30003, 35831, 36523, 20221)), 'visitor settings must use the same inclusive role-application entry as the application page');
assert.ok(!settingsPage.includes(String.fromCharCode(30003, 35831, 25945, 24072, 25110, 23398, 29983)), 'visitor settings must not omit household-member applications');
assert.ok(settingsPage.includes("application.profileMode === 'new'"), 'role review must distinguish a new-profile request from an existing-profile binding');
assert.ok(settingsPage.includes(String.fromCharCode(20808, 21019, 24314, 26723, 26696)), 'new-profile review must explain that a profile is created before it is linked');
assert.ok(!questionBankPage.includes(String.fromCharCode(31649, 29702, 21592)), 'question-bank permission guidance must not refer to a retired generic administrator role');
assert.ok(questionBankPage.includes('disabled={Boolean(submitting) || selectedIds.length === 0}'), 'question-bank exports must reject an empty selection before a cloud task is created');
assert.ok(questionBankStyles.includes('.action-button:disabled'), 'question-bank empty-selection actions must have a visible disabled state');

assert.ok(!forbiddenPage.includes('\u8bf7\u8054\u7cfb\u7ba1\u7406\u5458'), 'the access boundary must not imply a retired ordinary-administrator role');
assert.ok(forbiddenPage.includes('\u5f53\u524d\u8d26\u53f7\u6682\u4e0d\u80fd\u4f7f\u7528\u6b64\u529f\u80fd'), 'the access boundary must give the user a neutral, actionable explanation');
assert.ok(!homePage.includes('\u7ef4\u62a4\u5b66\u5458\u4e0e\u8bfe\u7a0b\u5173\u7cfb'), 'read-only miniapp shortcuts must not promise student maintenance');
assert.ok(homePage.includes('\u5b66\u751f\u8d44\u6599') && homePage.includes('\u8bfe\u7a0b\u8d44\u6599'), 'read-only miniapp shortcuts must name the information they show');
assert.ok(scheduleEditConfig.includes('\u6392\u8bfe\u8bf4\u660e'), 'the read-only scheduling boundary must not be titled as schedule creation');

for (const removedRoute of [
  'pages/admin/users/index',
  'pages/cloud-account-admin/index',
  'pages/unsupported-experience/index',
]) {
  assert.ok(!appConfig.includes(removedRoute), `retired role-management surface must not remain routable: ${removedRoute}`);
}

console.log('miniapp UI copy contract checks passed');
