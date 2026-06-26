const fs = require('fs');
const path = require('path');

const REQUIRED_ENV = [
  'DEPLOY_HOST',
  'DEPLOY_PASSWORD',
  'BACKEND_JWT_SECRET',
];

const OPTIONAL_ENV = [
  'DEPLOY_USER',
  'DEPLOY_PORT',
  'DEPLOY_REMOTE_DIR',
  'GEWU_NODE_ROLE',
  'GEWU_DEVICE_ID',
  'GEWU_HOST_BASE_URL',
  'GEWU_CLOUD_BASE_URL',
  'QUESTION_BANK_VOLUME',
];

const EXPECTED_API_BASE = 'https://physicsedu.xyz/scheduling';
const PROJECT_CONFIG_PATH = 'miniapp/project.config.json';
const PROD_CONFIG_PATH = 'miniapp/config/prod.ts';

function readText(relativePath) {
  const filePath = path.join(process.cwd(), relativePath);
  if (!fs.existsSync(filePath)) {
    throw new Error(`missing required file: ${relativePath}`);
  }
  return fs.readFileSync(filePath, 'utf-8');
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function envStatus(name) {
  return process.env[name] ? 'set' : 'missing';
}

function checkRequiredEnv() {
  return REQUIRED_ENV.map(name => ({ name, status: envStatus(name), required: true }));
}

function checkOptionalEnv() {
  return OPTIONAL_ENV.map(name => ({ name, status: envStatus(name), required: false }));
}

function checkMiniappReleaseConfig() {
  const projectConfig = readJson(PROJECT_CONFIG_PATH);
  const prodConfig = readText(PROD_CONFIG_PATH);
  const issues = [];

  if (!projectConfig.appid) issues.push('miniapp appid is missing');
  if (projectConfig.setting?.urlCheck !== true) issues.push('miniapp urlCheck should be true');
  if (projectConfig.setting?.uploadWithSourceMap !== false) issues.push('miniapp uploadWithSourceMap should be false');
  if (!prodConfig.includes(EXPECTED_API_BASE)) issues.push(`miniapp prod API should include ${EXPECTED_API_BASE}`);

  return {
    appid: projectConfig.appid || '',
    apiBase: EXPECTED_API_BASE,
    issues,
  };
}

function main() {
  const required = checkRequiredEnv();
  const optional = checkOptionalEnv();
  const miniapp = checkMiniappReleaseConfig();
  const missingRequired = required.filter(item => item.status === 'missing').map(item => item.name);

  console.log('Deploy readiness');
  console.log('Required env:');
  required.forEach(item => console.log(`- ${item.name}: ${item.status}`));
  console.log('Optional env:');
  optional.forEach(item => console.log(`- ${item.name}: ${item.status}`));
  console.log(`Miniapp appid: ${miniapp.appid || 'missing'}`);
  console.log(`Miniapp API: ${miniapp.apiBase}`);

  if (miniapp.issues.length > 0) {
    console.log('Miniapp config issues:');
    miniapp.issues.forEach(issue => console.log(`- ${issue}`));
  }

  console.log('Before miniapp upload, run: npm run miniapp:release-check');
  console.log('Before backend deploy, run: node scripts/check_deploy_readiness.js');

  if (missingRequired.length > 0 || miniapp.issues.length > 0) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  checkRequiredEnv,
  checkOptionalEnv,
  checkMiniappReleaseConfig,
};
