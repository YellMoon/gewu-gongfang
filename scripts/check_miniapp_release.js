const fs = require('fs');
const path = require('path');

const EXPECTED_APPID = 'wx3d570539bbe6ba1b';
const DEFAULT_API_BASE_URL = 'https://physicsedu.xyz/scheduling';
const DEFAULT_REVIEW_API_BASE_URL = 'https://physicsedu.xyz';

const rootDir = process.cwd();
const miniappDir = path.join(rootDir, 'miniapp');
const projectConfigPath = path.join(miniappDir, 'project.config.json');
const distAppConfigPath = path.join(miniappDir, 'dist', 'app.json');
const apiPath = path.join(miniappDir, 'src', 'utils', 'api.ts');
const prodConfigPath = path.join(miniappDir, 'config', 'prod.ts');

function fail(message) {
  throw new Error(`[miniapp-release] ${message}`);
}

function readJson(filePath, label) {
  if (!fs.existsSync(filePath)) {
    fail(`${label} missing: ${path.relative(rootDir, filePath)}`);
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (error) {
    fail(`${label} is not valid JSON: ${error.message}`);
  }
}

function readText(filePath, label) {
  if (!fs.existsSync(filePath)) {
    fail(`${label} missing: ${path.relative(rootDir, filePath)}`);
  }
  return fs.readFileSync(filePath, 'utf-8');
}

function assertHttpsEndpoint(value, label) {
  if (!value || typeof value !== 'string' || !value.startsWith('https://')) {
    fail(`${label} must use https:// endpoint`);
  }
}

function extractDefineFallback(source, constantName) {
  const escapedName = constantName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(source || '').match(new RegExp(
    `${escapedName}\\s*:\\s*JSON\\.stringify\\(process\\.env\\.[A-Z0-9_]+\\s*\\|\\|\\s*(['"])([^'"]+)\\1\\)`,
  ));
  if (!match) fail(`miniapp prod config should define ${constantName} with an explicit fallback`);
  return match[2];
}

function parseProdApiBases(prodSource) {
  const apiBaseUrl = extractDefineFallback(prodSource, '__API_BASE_URL__');
  const reviewApiBaseUrl = extractDefineFallback(prodSource, '__REVIEW_API_BASE_URL__');
  assertHttpsEndpoint(apiBaseUrl, 'production miniapp API');
  assertHttpsEndpoint(reviewApiBaseUrl, 'production miniapp review API');
  if (apiBaseUrl !== DEFAULT_API_BASE_URL) fail(`production miniapp API should be ${DEFAULT_API_BASE_URL}`);
  if (reviewApiBaseUrl !== DEFAULT_REVIEW_API_BASE_URL) fail(`production miniapp review API should be ${DEFAULT_REVIEW_API_BASE_URL}`);
  if (apiBaseUrl === reviewApiBaseUrl) fail('normal and review API bases must remain independently configured');
  return { apiBaseUrl, reviewApiBaseUrl };
}

function checkProjectConfig() {
  const projectConfig = readJson(projectConfigPath, 'miniapp/project.config.json');

  if (projectConfig.appid !== EXPECTED_APPID) {
    fail(`project.config.json appid should be ${EXPECTED_APPID}`);
  }

  if (projectConfig.setting?.urlCheck !== true) {
    fail('project.config.json setting.urlCheck must be true before release');
  }

  if (projectConfig.setting?.uploadWithSourceMap !== false) {
    fail('project.config.json setting.uploadWithSourceMap must be false before release');
  }
}

function checkBuiltDist() {
  const distAppConfig = readJson(distAppConfigPath, 'miniapp/dist/app.json');
  const pages = Array.isArray(distAppConfig.pages) ? distAppConfig.pages : [];

  if (!pages.includes('pages/index/index')) {
    fail('miniapp/dist/app.json should include pages/index/index');
  }

  const distAppPath = path.join(miniappDir, 'dist', 'app.js');
  if (!fs.existsSync(distAppPath)) {
    fail('miniapp/dist/app.js missing; run npm run build:weapp in miniapp first');
  }
  const distCommon = readText(path.join(miniappDir, 'dist', 'common.js'), 'miniapp/dist/common.js');
  for (const [value, label] of [
    [DEFAULT_API_BASE_URL, 'normal Backend'],
    [DEFAULT_REVIEW_API_BASE_URL, 'review Gateway'],
  ]) {
    if (!distCommon.includes(JSON.stringify(value))) {
      fail(`miniapp/dist/common.js should contain the exact ${label} base string`);
    }
  }
}

function checkApiConfig() {
  const apiSource = readText(apiPath, 'miniapp/src/utils/api.ts');
  const prodSource = readText(prodConfigPath, 'miniapp/config/prod.ts');
  parseProdApiBases(prodSource);

  assertHttpsEndpoint(DEFAULT_API_BASE_URL, 'default miniapp API');
  assertHttpsEndpoint(DEFAULT_REVIEW_API_BASE_URL, 'default miniapp review API');

  if (!apiSource.includes(DEFAULT_API_BASE_URL)) {
    fail(`miniapp API default should include ${DEFAULT_API_BASE_URL}`);
  }

  if (!apiSource.includes('__REVIEW_API_BASE_URL__')) {
    fail(`miniapp review API default should include ${DEFAULT_REVIEW_API_BASE_URL}`);
  }

  if (apiSource.includes('http://39.106.172.132')) {
    fail('miniapp API must not default to bare HTTP IP');
  }
}

function main() {
  checkProjectConfig();
  checkBuiltDist();
  checkApiConfig();
  console.log('miniapp release smoke checks passed');
}

if (require.main === module) {
  main();
}

module.exports = {
  checkProjectConfig,
  checkBuiltDist,
  checkApiConfig,
  parseProdApiBases,
};
