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

const EXPECTED_API_BASE = 'https://physicsedu.xyz/scheduling';
const PROJECT_CONFIG_PATH = 'miniapp/project.config.json';
const PROD_CONFIG_PATH = 'miniapp/config/prod.ts';
const IDENTITY_EVIDENCE_CHECKS = Object.freeze([
  Object.freeze({
    key: 'backendDesktopIdentityV2',
    files: Object.freeze([
      Object.freeze({ path: 'backend/src/routes/desktopIdentity.js', markers: Object.freeze([
        "router.post('/session/challenges/start'",
        "router.post('/primary-host/bootstrap'",
        "router.post('/primary-host/recover'",
      ]) }),
    ]),
  }),
  Object.freeze({
    key: 'gatewayDesktopPairingV1Tombstone',
    files: Object.freeze([
      Object.freeze({ path: 'gateway/src/routes/desktopPairing.js', markers: Object.freeze([
        'res.status(410)',
        'DESKTOP_PAIRING_V1_REMOVED',
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
    key: 'primaryHostGeneration',
    files: Object.freeze([
      Object.freeze({ path: 'backend/src/schema.sql', markers: Object.freeze([
        'CREATE TABLE IF NOT EXISTS primary_host_epochs',
        'idx_primary_host_single_active',
      ]) }),
      Object.freeze({ path: 'public/runtimeConfig.js', markers: Object.freeze([
        'primaryHostEpochId',
        'primaryHostGeneration',
        'writeManagedHostRuntimeConfig',
      ]) }),
    ]),
  }),
  Object.freeze({
    key: 'miniappDesktopAuthorization',
    files: Object.freeze([
      Object.freeze({ path: 'miniapp/src/app.config.ts', markers: Object.freeze([
        'pages/desktop-authorization/index',
      ]) }),
      Object.freeze({ path: 'miniapp/src/pages/desktop-authorization/index.tsx', markers: Object.freeze([
        'openType="getPhoneNumber"',
        'desktopAuthorizationApi.confirm',
        'operation-confirmed',
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
    key: 'identityDeviceCenter',
    files: Object.freeze([
      Object.freeze({ path: 'src/App.tsx', markers: Object.freeze([
        "import('./pages/IdentityDeviceCenter')",
        "case 'identity-devices'",
      ]) }),
      Object.freeze({ path: 'src/pages/IdentityDeviceCenter.tsx', markers: Object.freeze([
        'loadIdentityDeviceCenter',
        'startPrimaryHostOperation',
        'requiresRuntimeDemotion',
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

function checkPrimaryHostRecoveryDelivery() {
  const issues = [];
  const required = [
    ['backend/src/schema.sql', 'CREATE TABLE IF NOT EXISTS host_recovery_deliveries'],
    ['backend/src/services/primaryHostRecoveryDeliveryProtocol.js', 'RSA_PKCS1_OAEP_PADDING'],
    ['backend/src/services/primaryHostRecoveryDeliveryProtocol.js', 'RSA_PKCS1_PSS_PADDING'],
    ['backend/src/services/primaryHostIdentityService.js', 'PRIMARY_HOST_RECOVERY_DELIVERY_KEY_REQUIRED'],
    ['backend/src/services/primaryHostRecoveryDeliveryService.js', "status='acknowledged'"],
    ['public/primaryHostCredentialStore.js', 'RECOVERY_DELIVERY_STORE_VERSION'],
    ['public/primaryHostRuntimeManager.js', 'revealRecoveryPackage'],
    ['public/primaryHostRuntimeManager.js', 'acknowledgeRecoveryPackage'],
    ['src/pages/IdentityDeviceCenter.tsx', 'acknowledgeRecoveryPackageAndRestart'],
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
  const databaseSource = readText('backend/src/database.js');
  const schemaVersion = Number(databaseSource.match(/const SCHEMA_VERSION = (\d+)/)?.[1] || 0);
  const schemaVersionPresent = schemaVersion >= 3120;
  if (!schemaVersionPresent) issues.push('backend/src/database.js requires SCHEMA_VERSION >= 3120');
  evidence.push(Object.freeze({
    key: 'backend/src/database.js:SCHEMA_VERSION>=3120',
    status: schemaVersionPresent ? 'present' : 'missing',
  }));
  const identityService = readText('backend/src/services/primaryHostIdentityService.js');
  const deviceCenter = readText('src/pages/IdentityDeviceCenter.tsx');
  if (identityService.includes('recoveryPackage: prepared.recovery.recoveryPackage')) {
    issues.push('primary-host activation still returns a plaintext recovery package');
  }
  if (deviceCenter.includes('result' + '.recoveryPackage')) {
    issues.push('renderer still consumes a plaintext HTTP recovery package');
  }
  return Object.freeze({ evidence: Object.freeze(evidence), issues: Object.freeze(issues) });
}

function checkDesktopPasswordReset() {
  const issues = [];
  const required = [
    ['backend/src/services/desktopIdentityService.js', "'password_reset'"],
    ['backend/src/services/desktopIdentityService.js', 'DESKTOP_PASSWORD_RESET_IDENTITY_MISMATCH'],
    ['backend/src/services/desktopIdentityService.js', 'desktop_device_password_reset_exchanged'],
    ['public/desktopIdentityVault.js', 'beginPasswordReset'],
    ['public/desktopIdentityVault.js', 'completePasswordReset'],
    ['public/preload.js', 'desktop-identity:begin-password-reset'],
    ['public/electron.js', 'desktop-identity:complete-password-reset'],
    ['src/services/desktopIdentityClient.mjs', 'beginPasswordReset'],
    ['src/components/DesktopIdentityGate.tsx', "pending?.challenge?.purpose === 'password_reset'"],
    ['src/pages/IdentityDeviceCenter.tsx', "row.purpose === 'password_reset'"],
    ['miniapp/src/utils/desktopAuthorizationRuntime.js', "'password_reset'"],
  ];
  const evidence = required.map(([file, marker]) => {
    let found = false;
    try {
      found = readText(file).includes(marker);
    } catch (_error) { /* reported below */ }
    if (!found) issues.push(`${file} missing ${marker}`);
    return Object.freeze({ key: `${file}:${marker}`, status: found ? 'present' : 'missing' });
  });
  const resetSources = required.map(([file]) => file)
    .filter((file, index, files) => files.indexOf(file) === index)
    .map(readText)
    .join('\n');
  for (const forbidden of [
    'recoverPlaintextPassword',
    'plaintextPasswordStore',
    'passwordHistoryStore',
  ]) {
    if (resetSources.includes(forbidden)) {
      issues.push(`desktop password reset source contains forbidden plaintext recovery marker: ${forbidden}`);
    }
  }
  const buildDir = path.join(process.cwd(), 'build', 'static', 'js');
  if (!fs.existsSync(buildDir)) {
    issues.push('desktop build/static/js is missing for password reset gate');
  } else {
    const aggregate = fs.readdirSync(buildDir)
      .filter(name => name.endsWith('.js') && !name.endsWith('.js.map'))
      .map(name => fs.readFileSync(path.join(buildDir, name), 'utf8'))
      .join('\n');
    for (const marker of ['beginPasswordReset', 'password_reset']) {
      if (!aggregate.includes(marker)) issues.push(`desktop build is missing password reset marker: ${marker}`);
    }
  }
  return Object.freeze({ evidence: Object.freeze(evidence), issues: Object.freeze(issues) });
}

function checkIdentitySourceSafety() {
  const issues = [];
  const deviceCenter = readText('src/pages/IdentityDeviceCenter.tsx');
  const settings = readText('src/pages/SystemSettings.tsx');
  const identityClient = readText('src/services/desktopIdentityClient.mjs');
  const credentialStore = readText('public/primaryHostCredentialStore.js');
  const sourceFiles = [
    'public/electron.js',
    'public/desktopIdentityVault.js',
    'public/primaryHostCredentialStore.js',
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
  if (!credentialStore.includes('safeStorage.encryptString')
    || !credentialStore.includes('safeStorage.decryptString')) {
    issues.push('primary-host credentials must use the OS encrypted credential store');
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
  for (const required of ['identity-devices', 'primary-host']) {
    if (!aggregate.includes(required)) issues.push(`desktop build is missing identity marker: ${required}`);
  }
  for (const required of ['revealRecoveryPackage', 'acknowledgeRecoveryPackage']) {
    if (!aggregate.includes(required)) {
      issues.push(`desktop build is missing recovery delivery marker: ${required}`);
    }
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
    'backend/src/services/primaryHostRecoveryDeliveryProtocol.js',
    'backend/src/services/primaryHostRecoveryDeliveryService.js',
    'public/primaryHostCredentialStore.js',
    'public/primaryHostRuntimeManager.js',
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
  const hostConfig = require(path.join(process.cwd(), 'electron-builder.host.config.cjs'));
  const runtimeConfig = readText('public/runtimeConfig.js');
  const buildFlavor = readText('public/desktopBuildFlavor.js');
  const directTransport = readText('src/services/authorityTransports.mjs');
  const relayRoute = readText('gateway/src/routes/cloudRelay.js');
  const ordinaryFiles = packageJson.build?.files || [];
  const hostFiles = hostConfig.files || [];
  const hostOnlyFiles = [
    'public/primaryHostCredentialStore.js',
    'public/primaryHostOperationValidation.js',
    'public/primaryHostRuntimeManager.js',
  ];

  if (packageJson.desktopBuildFlavor !== 'desktop-client') {
    issues.push('default desktop package flavor must be desktop-client');
  }
  if (!ordinaryFiles.includes('public/electronShellPolicy.js')) {
    issues.push('ordinary package is missing electronShellPolicy.js');
  }
  for (const file of hostOnlyFiles) {
    if (ordinaryFiles.includes(file)) issues.push(`ordinary package contains host-only module: ${file}`);
    if (!hostFiles.includes(file)) issues.push(`primary-host package is missing host-only module: ${file}`);
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
  const hostFeed = /desktop\/host\/['"]/.test(buildFlavor);
  if (!clientFeed || !hostFeed) issues.push('desktop client and primary-host update feeds must be isolated');

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
  const primaryHostRecoveryDelivery = checkPrimaryHostRecoveryDelivery();
  const desktopPasswordReset = checkDesktopPasswordReset();
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
  console.log('Primary-host recovery delivery evidence:');
  primaryHostRecoveryDelivery.evidence.forEach(item => console.log(`- ${item.key}: ${item.status}`));
  console.log('Desktop password reset evidence:');
  desktopPasswordReset.evidence.forEach(item => console.log(`- ${item.key}: ${item.status}`));
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
    ...primaryHostRecoveryDelivery.issues,
    ...desktopPasswordReset.issues,
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
  checkPrimaryHostRecoveryDelivery,
  checkDesktopPasswordReset,
  checkIdentitySourceSafety,
  checkIdentityBuildSafety,
  checkDesktopReleaseBoundary,
  IDENTITY_EVIDENCE_CHECKS,
};
