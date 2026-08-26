const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

for (const envFile of [
  process.env.DOTENV_CONFIG_PATH,
  path.join(__dirname, '..', '.env.local'),
  path.join(__dirname, '..', '.env'),
].filter(Boolean)) {
  if (fs.existsSync(envFile)) {
    dotenv.config({ path: envFile, override: false });
  }
}

const REQUIRED_ENV = [
  'DEPLOY_HOST',
  'BACKEND_JWT_SECRET',
  'WECHAT_APPID',
  'WECHAT_APPSECRET',
];

const OPTIONAL_ENV = [
  'DEPLOY_USER',
  'DEPLOY_PORT',
  'DEPLOY_PASSWORD',
  'DEPLOY_KEY_PATH',
  'DEPLOY_REMOTE_DIR',
  'GEWU_NODE_ROLE',
  'GEWU_DEVICE_ID',
  'GEWU_HOST_BASE_URL',
  'GEWU_CLOUD_BASE_URL',
  'GEWU_DESKTOP_SYNC_TOKEN',
  'GEWU_CLOUD_RELAY_HOST_TOKEN',
  'QUESTION_BANK_VOLUME',
];

const EXPECTED_API_BASE = 'https://physicsedu.xyz/cloud-business';
const PROJECT_CONFIG_PATH = 'miniapp/project.config.json';
const PROD_CONFIG_PATH = 'miniapp/config/prod.ts';
const IDENTITY_EVIDENCE_CHECKS = Object.freeze([
  Object.freeze({
    key: 'cloudUnifiedDesktopRegistration',
    files: Object.freeze([
      Object.freeze({ path: 'cloud-business-api/src/desktopRegistrationService.js', markers: Object.freeze([
        "audience: 'unified-desktop'",
        'offlineLease(',
        'async register(input)',
      ]) }),
    ]),
  }),
  Object.freeze({
    key: 'desktopOfflineDraftConfirmation',
    files: Object.freeze([
      Object.freeze({ path: 'src/services/desktopCommandOutbox.mjs', markers: Object.freeze([
        "status: 'awaiting_confirmation'",
        'async function confirm(id)',
        'AUTHORITY_DRAFT_NOT_CONFIRMED',
      ]) }),
    ]),
  }),
  Object.freeze({
    key: 'userRoleGrantMigration',
    files: Object.freeze([
      Object.freeze({ path: 'backend/src/schema.sql', markers: Object.freeze([
        'CREATE TABLE IF NOT EXISTS user_role_grants',
      ]) }),
      Object.freeze({ path: 'backend/src/database.js', markers: Object.freeze([
        'ensureCompatibilityRoleGrants',
        '_ensureRoleGrantPersistence()',
      ]) }),
    ]),
  }),
  Object.freeze({
    key: 'unifiedDesktopIdentityVault',
    files: Object.freeze([
      Object.freeze({ path: 'public/desktopIdentityVault.js', markers: Object.freeze([
        'beginUnifiedOnlineRegistration',
        'normalizeOfflineLease',
      ]) }),
    ]),
  }),
  Object.freeze({
    key: 'desktopIdentityGate',
    files: Object.freeze([
      Object.freeze({ path: 'src/index.tsx', markers: Object.freeze([
        "import DesktopIdentityGate from './components/DesktopIdentityGate'",
        '<DesktopIdentityGate',
      ]) }),
      Object.freeze({ path: 'src/services/desktopIdentityClient.mjs', markers: Object.freeze([
        "gateState?.kind === 'online-unlocked'",
        "gateState?.kind === 'offline-unlocked'",
      ]) }),
    ]),
  }),
  Object.freeze({
    key: 'identityRuntimeGate',
    files: Object.freeze([
      Object.freeze({ path: 'src/components/DesktopIdentityGate.tsx', markers: Object.freeze([
        'onClick={beginRegistration} block',
        'returnToPasswordLogin',
        'onClick={returnToPasswordLogin}',
      ]) }),
    ]),
  }),
]);

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
  const required = REQUIRED_ENV.map(name => ({ name, status: envStatus(name), required: true }));
  required.push({
    name: 'DEPLOY_PASSWORD or DEPLOY_KEY_PATH',
    status: process.env.DEPLOY_PASSWORD || process.env.DEPLOY_KEY_PATH ? 'set' : 'missing',
    required: true,
  });
  return required;
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

function checkIdentityArchitecture() {
  const evidence = [];
  const issues = [];
  for (const requirement of IDENTITY_EVIDENCE_CHECKS) {
    const missing = [];
    for (const file of requirement.files) {
      let source = '';
      try {
        source = readText(file.path);
      } catch (_error) {
        missing.push(`${file.path}:missing`);
        continue;
      }
      for (const marker of file.markers) {
        if (!source.includes(marker)) missing.push(`${file.path}:${marker}`);
      }
    }
    const status = missing.length === 0 ? 'pass' : 'fail';
    evidence.push(Object.freeze({ key: requirement.key, status, missing: Object.freeze(missing) }));
    if (missing.length > 0) issues.push(`${requirement.key}: ${missing.join(', ')}`);
  }
  return Object.freeze({ evidence: Object.freeze(evidence), issues: Object.freeze(issues) });
}

function checkUnifiedDesktopRegistration() {
  const issues = [];
  const required = [
    ['cloud-business-api/src/desktopRegistrationService.js', "audience: 'unified-desktop'"],
    ['cloud-business-api/src/desktopRegistrationService.js', 'offlineLease('],
    ['public/desktopIdentityVault.js', 'beginUnifiedOnlineRegistration'],
    ['src/services/desktopCommandOutbox.mjs', "status: 'awaiting_confirmation'"],
    ['src/services/desktopCommandOutbox.mjs', 'AUTHORITY_DRAFT_NOT_CONFIRMED'],
    ['public/electron.js', "desktop-authority:confirm-and-submit"],
  ];
  const evidence = required.map(([file, marker]) => {
    let found = false;
    try {
      found = readText(file).includes(marker);
    } catch (_error) { /* reported as a missing boundary below */ }
    if (!found) issues.push(`${file} missing ${marker}`);
    return Object.freeze({
      key: `${file}:${marker}`,
      status: found ? 'present' : 'missing',
    });
  });
  return Object.freeze({ evidence: Object.freeze(evidence), issues: Object.freeze(issues) });
}

function checkIdentitySourceSafety() {
  const issues = [];
  const deviceCenter = readText('src/pages/IdentityDeviceCenter.tsx');
  const settings = readText('src/pages/SystemSettings.tsx');
  const identityClient = readText('src/services/desktopIdentityClient.mjs');
  const sourceFiles = [
    'public/electron.js',
    'public/desktopIdentityVault.js',
    'backend/src/routes/desktopIdentity.js',
    'src/components/DesktopIdentityGate.tsx',
    'src/pages/IdentityDeviceCenter.tsx',
  ];

  if (deviceCenter.includes('selectedUsers') || deviceCenter.includes('<Select')
    || deviceCenter.includes('userId:')) {
    issues.push('identity device approval must not select or submit a claimant userId');
  }
  if (settings.includes('name="desktopSyncToken"')) {
    issues.push('SystemSettings must not expose a long-term plaintext desktop sync token');
  }
  const nodeRoleField = settings.match(/<Form\.Item[^>]*name="nodeRole"[\s\S]*?<\/Form\.Item>/);
  if (nodeRoleField && !nodeRoleField[0].includes('disabled')) {
    issues.push('SystemSettings nodeRole control must be immutable');
  }
  if (nodeRoleField && !settings.includes('nodeRole: _managedNodeRole')
    && !settings.includes('saveRuntimeConfig(editableValues)')) {
    issues.push('SystemSettings must strip managed nodeRole before saving editable settings');
  }
  if (!identityClient.includes("gateState?.kind === 'online-unlocked'")
    || !identityClient.includes("gateState?.kind === 'offline-unlocked'")) {
    issues.push('business runtime must remain gated behind an unlocked identity state');
  }
  const identityVault = readText('public/desktopIdentityVault.js');
  if (!identityVault.includes('safeStorage.encryptString')
    || !identityVault.includes('safeStorage.decryptString')) {
    issues.push('desktop identity session must use the OS encrypted credential store');
  }

  const secretLogPattern = /(?:console\.(?:log|info|warn|error)|\blog\()[^\r\n]{0,240}(?:password|privateKey|hostCredential|recoveryCode|desktopSyncToken)/i;
  for (const file of sourceFiles) {
    const match = readText(file).match(secretLogPattern);
    if (match) issues.push(`${file}: secret-bearing log statement`);
  }
  return Object.freeze({ scannedFiles: Object.freeze(sourceFiles), issues: Object.freeze(issues) });
}

function checkIdentityBuildSafety() {
  const buildDir = path.join(process.cwd(), 'build', 'static', 'js');
  const issues = [];
  if (!fs.existsSync(buildDir)) {
    return Object.freeze({ scanned: false, files: Object.freeze([]), issues: Object.freeze([
      'desktop build/static/js is missing',
    ]) });
  }
  const files = fs.readdirSync(buildDir)
    .filter(name => name.endsWith('.js') && !name.endsWith('.js.map'))
    .sort();
  if (files.length === 0) issues.push('desktop JavaScript build artifacts are missing');
  const aggregate = files.map(name => fs.readFileSync(path.join(buildDir, name), 'utf-8')).join('\n');
  for (const forbidden of [
    'selectedUsers',
    '\u9009\u62e9\u8bbe\u5907\u7ed1\u5b9a\u8d26\u53f7',
    'name:"desktopSyncToken"',
  ]) {
    if (aggregate.includes(forbidden)) issues.push(`desktop build contains forbidden identity marker: ${forbidden}`);
  }
  if (aggregate.includes('name:"nodeRole"')
    && !/name:"nodeRole"[\s\S]{0,600}disabled:!0/.test(aggregate)) {
    issues.push('desktop build contains an editable nodeRole control');
  }
  const identityBuild = files
    .map(name => fs.readFileSync(path.join(buildDir, name), 'utf-8'))
    .filter(source => source.includes('identity-devices') || source.includes('primary-host'))
    .join('\n');
  const secretLogPattern = /console\.(?:log|info|warn|error)\([^)]{0,240}(?:password|privateKey|hostCredential|recoveryCode|desktopSyncToken)/i;
  if (secretLogPattern.test(identityBuild)) issues.push('desktop identity build contains a secret-bearing log statement');
  for (const required of ['beginUnifiedOnlineRegistration', 'confirmAndSubmit']) {
    if (!aggregate.includes(required)) issues.push(`desktop build is missing identity marker: ${required}`);
  }
  for (const forbidden of [
    'offline-secret-code',
    'one-time-secret',
    'BEGIN PRIVATE KEY',
    ['setRecoveryPackage', '(result.recoveryPackage)'].join(''),
  ]) {
    if (aggregate.includes(forbidden)) {
      issues.push(`desktop build contains recovery delivery secret marker: ${forbidden}`);
    }
  }
  const recoverySources = [
    'public/desktopIdentityVault.js',
    'public/electron.js',
    'src/pages/IdentityDeviceCenter.tsx',
  ].map(readText).join('\n');
  if (/console\.(?:log|info|warn|error)\([^\n]*(?:envelope|wrappedKey|ciphertext|privateKey|recoveryPackage|recoveryCode|signature)/i.test(recoverySources)) {
    issues.push('recovery delivery source contains a secret-bearing log statement');
  }
  return Object.freeze({ scanned: true, files: Object.freeze(files), issues: Object.freeze(issues) });
}

function checkDesktopReleaseBoundary() {
  const issues = [];
  const packageJson = readJson('package.json');
  const runtimeConfig = readText('public/runtimeConfig.js');
  const buildFlavor = readText('public/desktopBuildFlavor.js');
  const directTransport = readText('src/services/authorityTransports.mjs');
  const relayRoute = readText('gateway/src/routes/cloudRelay.js');
  const ordinaryFiles = packageJson.build?.files || [];
  const retiredHostFiles = [
    'public/primaryHostCredentialStore.js',
    'public/primaryHostOperationValidation.js',
    'public/primaryHostRuntimeManager.js',
    'public/primaryHostListenPolicy.js',
    'public/windowsHostFirewall.js',
  ];

  if (packageJson.desktopBuildFlavor !== 'unified-desktop') {
    issues.push('default desktop package flavor must be unified-desktop');
  }
  if (!ordinaryFiles.includes('public/electronShellPolicy.js')) {
    issues.push('ordinary package is missing electronShellPolicy.js');
  }
  for (const file of retiredHostFiles) {
    if (ordinaryFiles.includes(file)) issues.push(`unified package contains retired host module: ${file}`);
    if (fs.existsSync(path.join(process.cwd(), file))) issues.push(`retired host module still exists: ${file}`);
  }
  if (fs.existsSync(path.join(process.cwd(), 'electron-builder.host.config.cjs'))) {
    issues.push('a second host-only installer configuration must not exist');
  }
  if (packageJson.scripts?.['package:host-runtime-contract']) {
    issues.push('a second host-only packaging command must not exist');
  }
  if (!runtimeConfig.includes("desktopIdentityMode: 'full'")) {
    issues.push('desktop identity mode must default to full');
  }
  for (const retiredPath of [
    'src/services/oneClickSyncTransports.mjs',
    'src/services/oneClickSyncService.mjs',
    'src/services/syncApi.ts',
    'src/services/desktopSessionRelayClient.mjs',
    'backend/src/routes/sync.js',
  ]) {
    if (fs.existsSync(path.join(process.cwd(), retiredPath))) {
      issues.push(`retired sync path still exists: ${retiredPath}`);
    }
  }
  for (const forbidden of ['/api/sync/authorize', 'x-sync-authorization', 'syncAuthorizationToken']) {
    if (directTransport.includes(forbidden)) {
      issues.push(`direct V2 sync transport still accepts legacy authorization: ${forbidden}`);
    }
  }
  if (!relayRoute.includes("'pairingcode'") || !relayRoute.includes("'pairing_code'")) {
    issues.push('cloud relay must reject pairing-code response fields');
  }
  const clientFeed = /desktop\/['"]/.test(buildFlavor);
  if (!clientFeed) issues.push('the unified desktop update feed is missing');

  return Object.freeze({
    defaultDesktopFlavor: packageJson.desktopBuildFlavor,
    miniappReleaseState: 'frozen',
    issues: Object.freeze(issues),
  });
}

function main() {
  const required = checkRequiredEnv();
  const optional = checkOptionalEnv();
  const miniapp = checkMiniappReleaseConfig();
  const identityArchitecture = checkIdentityArchitecture();
  const unifiedDesktopRegistration = checkUnifiedDesktopRegistration();
  const identitySourceSafety = checkIdentitySourceSafety();
  const identityBuildSafety = checkIdentityBuildSafety();
  const desktopReleaseBoundary = checkDesktopReleaseBoundary();
  const missingRequired = required.filter(item => item.status === 'missing').map(item => item.name);

  console.log('Deploy readiness');
  console.log('Required env:');
  required.forEach(item => console.log(`- ${item.name}: ${item.status}`));
  console.log('Optional env:');
  optional.forEach(item => console.log(`- ${item.name}: ${item.status}`));
  console.log(`Miniapp appid: ${miniapp.appid || 'missing'}`);
  console.log(`Miniapp API: ${miniapp.apiBase}`);
  console.log('Desktop identity evidence:');
  identityArchitecture.evidence.forEach(item => console.log(`- ${item.key}: ${item.status}`));
  console.log('Unified desktop registration evidence:');
  unifiedDesktopRegistration.evidence.forEach(item => console.log(`- ${item.key}: ${item.status}`));
  console.log(`Desktop identity source safety: ${identitySourceSafety.issues.length === 0 ? 'pass' : 'fail'}`);
  console.log(`Desktop identity build safety: ${identityBuildSafety.issues.length === 0 ? 'pass' : 'fail'}`);
  console.log(`Desktop release boundary: ${desktopReleaseBoundary.issues.length === 0 ? 'pass' : 'fail'}`);
  console.log(`Miniapp release state: ${desktopReleaseBoundary.miniappReleaseState}`);

  if (miniapp.issues.length > 0) {
    console.log('Miniapp config issues:');
    miniapp.issues.forEach(issue => console.log(`- ${issue}`));
  }

  console.log('Before miniapp upload, run: npm run miniapp:release-check');
  console.log('Before backend deploy, run: node scripts/check_deploy_readiness.js');

  const identityIssues = [
    ...identityArchitecture.issues,
    ...unifiedDesktopRegistration.issues,
    ...identitySourceSafety.issues,
    ...identityBuildSafety.issues,
    ...desktopReleaseBoundary.issues,
  ];
  if (identityIssues.length > 0) {
    console.log('Desktop identity issues:');
    identityIssues.forEach(issue => console.log(`- ${issue}`));
  }

  if (missingRequired.length > 0 || miniapp.issues.length > 0 || identityIssues.length > 0) {
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
  checkIdentityArchitecture,
  checkUnifiedDesktopRegistration,
  checkIdentitySourceSafety,
  checkIdentityBuildSafety,
  checkDesktopReleaseBoundary,
  IDENTITY_EVIDENCE_CHECKS,
};
