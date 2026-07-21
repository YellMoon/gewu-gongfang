'use strict';

const fs = require('fs');
const path = require('path');

const EXPECTED_APPID = 'wx3d570539bbe6ba1b';
const DEFAULT_API_BASE_URL = 'https://physicsedu.xyz/scheduling';
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
  const apiBaseUrl = extractDefineFallback(prodSource, '__API_BASE_URL__');
  assertHttpsEndpoint(apiBaseUrl, 'production miniapp API');
  if (apiBaseUrl !== DEFAULT_API_BASE_URL) fail(`production miniapp API should be ${DEFAULT_API_BASE_URL}`);
  if (String(prodSource).includes('__REVIEW_API_BASE_URL__')) fail('removed review Gateway base must stay absent');
  return { apiBaseUrl };
}
function containsRemovedReviewClientFlow(source) {
  return /reviewDemoApi|\/api\/auth\/review-demo|REVIEW_API_BASE_URL/.test(String(source || ''));
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
  if (!fs.existsSync(path.join(miniappDir, 'dist', 'app.js'))) fail('miniapp/dist/app.js missing; build the miniapp first');
  const common = readText(path.join(miniappDir, 'dist', 'common.js'), 'miniapp/dist/common.js');
  if (!common.includes(JSON.stringify(DEFAULT_API_BASE_URL))) fail('miniapp/dist/common.js should contain the Backend base');
  if (containsRemovedReviewClientFlow(common)) fail('built miniapp must not contain the removed review-demo client flow');
}
function checkApiConfig() {
  const apiSource = readText(path.join(miniappDir, 'src', 'utils', 'api.ts'), 'miniapp/src/utils/api.ts');
  const prodSource = readText(path.join(miniappDir, 'config', 'prod.ts'), 'miniapp/config/prod.ts');
  parseProdApiBase(prodSource);
  if (!apiSource.includes(DEFAULT_API_BASE_URL)) fail(`miniapp API default should include ${DEFAULT_API_BASE_URL}`);
  if (/__REVIEW_API_BASE_URL__|reviewDemoApi|\/api\/auth\/review-demo/.test(apiSource)) fail('miniapp API must use only the Backend account flow');
  if (apiSource.includes('http://39.106.172.132')) fail('miniapp API must not default to a bare HTTP IP');
}
function main() {
  checkProjectConfig();
  checkBuiltDist();
  checkApiConfig();
  console.log('miniapp release smoke checks passed');
}
if (require.main === module) main();
module.exports = { checkApiConfig, checkBuiltDist, checkProjectConfig, containsRemovedReviewClientFlow, parseProdApiBase };
