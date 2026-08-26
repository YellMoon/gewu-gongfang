'use strict';

const fs = require('fs');
const path = require('path');

const EXPECTED_APPID = 'wx3d570539bbe6ba1b';
const DEFAULT_CLOUD_BUSINESS_API_BASE_URL = 'https://physicsedu.xyz/cloud-business';
const rootDir = process.cwd();
const miniappDir = path.join(rootDir, 'miniapp');

function fail(message) { throw new Error(`[miniapp-release] ${message}`); }
function readText(filePath, label) {
  if (!fs.existsSync(filePath)) fail(`${label} missing: ${path.relative(rootDir, filePath)}`);
  return fs.readFileSync(filePath, 'utf8');
}
function readJson(filePath, label) {
  try { return JSON.parse(readText(filePath, label)); }
  catch (error) { fail(`${label} is not valid JSON: ${error.message}`); }
}
function assertHttpsEndpoint(value, label) {
  if (!value || typeof value !== 'string' || !value.startsWith('https://')) fail(`${label} must use https:// endpoint`);
}
function extractDefineFallback(source, constantName) {
  const escapedName = constantName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(source || '').match(new RegExp(
    `${escapedName}\\s*:\\s*JSON\\.stringify\\(process\\.env\\.[A-Z0-9_]+\\s*\\|\\|\\s*(['"])([^'"]+)\\1\\)`,
  ));
  if (!match) fail(`miniapp prod config should define ${constantName} with an explicit fallback`);
  return match[2];
}
function parseProdApiBase(prodSource) {
  const cloudBusinessApiBaseUrl = extractDefineFallback(prodSource, '__CLOUD_BUSINESS_API_BASE_URL__');
  assertHttpsEndpoint(cloudBusinessApiBaseUrl, 'production cloud business API');
  if (cloudBusinessApiBaseUrl !== DEFAULT_CLOUD_BUSINESS_API_BASE_URL) fail(`production cloud business API should be ${DEFAULT_CLOUD_BUSINESS_API_BASE_URL}`);
  if (String(prodSource).includes('__API_BASE_URL__') || String(prodSource).includes('MINIAPP_API_BASE_URL')) fail('retired scheduling API base must stay absent');
  if (String(prodSource).includes('__REVIEW_API_BASE_URL__')) fail('removed review Gateway base must stay absent');
  return { cloudBusinessApiBaseUrl };
}
function containsRemovedReviewClientFlow(source) {
  return /reviewDemoApi|\/api\/auth\/review-demo|REVIEW_API_BASE_URL/.test(String(source || ''));
}
function containsRetiredBindingReviewLoginFlow(source) {
  return /WECHAT_BINDING_REVIEW_REQUIRED|pending-binding|pendingBinding|binding-review-notice/.test(String(source || ''));
}
function containsRetiredWechatBindingReviewUi(source) {
  return /wechatBindingApi|binding-review-section|wechat-binding-review|wechat-binding-read-only/.test(String(source || ''));
}
function checkProjectConfig() {
  const config = readJson(path.join(miniappDir, 'project.config.json'), 'miniapp/project.config.json');
  if (config.appid !== EXPECTED_APPID) fail(`project.config.json appid should be ${EXPECTED_APPID}`);
  if (config.setting?.urlCheck !== true) fail('project.config.json setting.urlCheck must be true before release');
  if (config.setting?.uploadWithSourceMap !== false) fail('project.config.json setting.uploadWithSourceMap must be false before release');
}
function checkBuiltDist() {
  const appConfig = readJson(path.join(miniappDir, 'dist', 'app.json'), 'miniapp/dist/app.json');
  if (!Array.isArray(appConfig.pages) || !appConfig.pages.includes('pages/account-application/index')) {
    fail('miniapp/dist/app.json should include pages/account-application/index');
  }
  if (appConfig.pages.includes('pages/admin/users/index')) fail('retired ordinary-administrator page must stay absent from the built miniapp');
  if (!fs.existsSync(path.join(miniappDir, 'dist', 'app.js'))) fail('miniapp/dist/app.js missing; build the miniapp first');
  const common = readText(path.join(miniappDir, 'dist', 'common.js'), 'miniapp/dist/common.js');
  const loginPage = readText(path.join(miniappDir, 'dist', 'pages', 'login', 'index.js'), 'miniapp/dist/pages/login/index.js');
  const loginStyles = readText(path.join(miniappDir, 'dist', 'pages', 'login', 'index.wxss'), 'miniapp/dist/pages/login/index.wxss');
  if (fs.existsSync(path.join(miniappDir, 'dist', 'pages', 'admin', 'users', 'index.js'))) fail('retired ordinary-administrator page must not be emitted into miniapp/dist');
  if (!common.includes(JSON.stringify(DEFAULT_CLOUD_BUSINESS_API_BASE_URL))) fail('miniapp/dist/common.js should contain the cloud business authority base');
  if (containsRemovedReviewClientFlow(common)) fail('built miniapp must not contain the removed review-demo client flow');
  if (containsRetiredBindingReviewLoginFlow(`${common}\n${loginPage}\n${loginStyles}`)) {
    fail('built miniapp must not contain the retired binding-review login flow');
  }
  if (containsRetiredWechatBindingReviewUi(common)) {
    fail('built miniapp must not contain the retired administrator binding-review UI');
  }
}
function checkLoginContract() {
  const loginSource = readText(path.join(miniappDir, 'src', 'pages', 'login', 'index.tsx'), 'miniapp login page');
  const runtimeSource = readText(path.join(miniappDir, 'src', 'pages', 'login', 'manualPhoneLoginRuntime.js'), 'miniapp login runtime');
  const backendAuthSource = readText(path.join(rootDir, 'backend', 'src', 'routes', 'auth.js'), 'backend auth route');
  if (containsRetiredBindingReviewLoginFlow(`${loginSource}\n${runtimeSource}\n${backendAuthSource}`)) {
    fail('manual-phone login must not contain the retired binding-review outcome');
  }
}
function checkRetiredBindingReviewUi() {
  const apiSource = readText(path.join(miniappDir, 'src', 'utils', 'api.ts'), 'miniapp API client');
  const inventorySource = readText(path.join(miniappDir, 'src', 'utils', 'miniappUiPageInventory.js'), 'miniapp UI inventory');
  if (fs.existsSync(path.join(miniappDir, 'src', 'pages', 'admin', 'users', 'index.tsx'))) fail('retired ordinary-administrator page must stay deleted');
  if (containsRetiredWechatBindingReviewUi(`${apiSource}\n${inventorySource}`)) {
    fail('miniapp source must not contain the retired administrator binding-review UI');
  }
}
function checkApiConfig() {
  const apiSource = readText(path.join(miniappDir, 'src', 'utils', 'api.ts'), 'miniapp/src/utils/api.ts');
  const prodSource = readText(path.join(miniappDir, 'config', 'prod.ts'), 'miniapp/config/prod.ts');
  parseProdApiBase(prodSource);
  if (!apiSource.includes(DEFAULT_CLOUD_BUSINESS_API_BASE_URL)) fail(`miniapp API default should include ${DEFAULT_CLOUD_BUSINESS_API_BASE_URL}`);
  if (apiSource.includes('__API_BASE_URL__')) fail('miniapp API must not retain the retired local-backend API base');
  if (/__REVIEW_API_BASE_URL__|reviewDemoApi|\/api\/auth\/review-demo/.test(apiSource)) fail('miniapp API must use only the cloud business account flow');
  if (apiSource.includes('http://39.106.172.132')) fail('miniapp API must not default to a bare HTTP IP');
}
function main() {
  checkProjectConfig();
  checkLoginContract();
  checkRetiredBindingReviewUi();
  checkBuiltDist();
  checkApiConfig();
  console.log('miniapp release smoke checks passed');
}
if (require.main === module) main();
module.exports = {
  checkApiConfig,
  checkBuiltDist,
  checkLoginContract,
  checkRetiredBindingReviewUi,
  checkProjectConfig,
  containsRemovedReviewClientFlow,
  containsRetiredBindingReviewLoginFlow,
  containsRetiredWechatBindingReviewUi,
  parseProdApiBase,
};
