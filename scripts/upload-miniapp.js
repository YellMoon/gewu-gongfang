const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');
const releaseMatrix = require('./release-matrix');

const EXPECTED_MINIPROGRAM_CI_VERSION = '2.1.31';
const MINIAPP_PENDING_UPLOAD_SCHEMA = 'gewu.miniapp-upload-pending.v2';
const MINIAPP_DEFERRED_UPLOAD_RECONCILIATION_REQUIRED = 'MINIAPP_DEFERRED_UPLOAD_RECONCILIATION_REQUIRED';
const MINIAPP_DEFERRED_UPLOAD_MARKER_MISSING = 'MINIAPP_DEFERRED_UPLOAD_MARKER_MISSING';
const MINIAPP_DEFERRED_UPLOAD_MARKER_INVALID = 'MINIAPP_DEFERRED_UPLOAD_MARKER_INVALID';
const MINIAPP_DEFERRED_UPLOAD_VERSION_MISMATCH = 'MINIAPP_DEFERRED_UPLOAD_VERSION_MISMATCH';
const MINIAPP_DEFERRED_UPLOAD_CONTEXT_MISMATCH = 'MINIAPP_DEFERRED_UPLOAD_CONTEXT_MISMATCH';
const MINIAPP_DEFERRED_UPLOAD_RECEIPT_MISMATCH = 'MINIAPP_DEFERRED_UPLOAD_RECEIPT_MISMATCH';
const MINIAPP_RECEIPT_OPERATION_INTERNAL_ONLY = 'MINIAPP_RECEIPT_OPERATION_INTERNAL_ONLY';
const MINIAPP_CI_VERSION_MISMATCH = 'MINIAPP_CI_VERSION_MISMATCH';
const MINIAPP_FIXED_EGRESS_REQUIRED = 'MINIAPP_FIXED_EGRESS_REQUIRED';
const MINIAPP_UPLOAD_FAILED = 'MINIAPP_UPLOAD_FAILED';
const PENDING_MARKER_KEYS = Object.freeze(['appid', 'commit', 'completedAt', 'schema', 'uploadMode', 'version']);

function parseOption(argv, name) {
  const prefix = `--${name}=`;
  const inline = argv.find(arg => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = argv.indexOf(`--${name}`);
  if (index >= 0 && argv[index + 1] && !argv[index + 1].startsWith('--')) {
    return argv[index + 1];
  }
  return '';
}

function resolveUploadVersion(options = {}) {
  const argv = options.argv || process.argv.slice(2);
  const explicitVersion = parseOption(argv, 'version');
  if (options.releaseManifest) {
    return releaseMatrix.resolveTargetVersion({
      manifest: options.releaseManifest,
      target: 'miniapp',
      requestedVersion: explicitVersion,
    });
  }
  if (explicitVersion) return explicitVersion;

  const pkg = options.packageJson || require(path.join(__dirname, '..', 'miniapp', 'package.json'));
  if (!pkg.version) {
    throw new Error('package.json version is required for miniapp upload');
  }
  return pkg.version;
}

function resolveWechatCliPath(options = {}) {
  const platform = options.platform || process.platform;
  const envPath = options.env?.WECHAT_DEVTOOLS_CLI || process.env.WECHAT_DEVTOOLS_CLI;
  if (envPath) return envPath;

  if (platform === 'win32') {
    return path.join('C:', 'Program Files (x86)', 'Tencent', '微信web开发者工具', 'cli.bat');
  }

  if (platform === 'darwin') {
    return '/Applications/wechatwebdevtools.app/Contents/MacOS/cli';
  }

  return 'wechat-devtools-cli';
}

function resolveMiniappPrivateKeyPath(options = {}) {
  const env = options.env || process.env;
  if (env.WECHAT_MINIAPP_PRIVATE_KEY_PATH) return env.WECHAT_MINIAPP_PRIVATE_KEY_PATH;
  if (env.MINIAPP_PRIVATE_KEY_PATH) return env.MINIAPP_PRIVATE_KEY_PATH;
  if (env.WX_PRIVATE_KEY_PATH) return env.WX_PRIVATE_KEY_PATH;

  const appid = options.appid || readMiniappAppid(options);
  const homeDir = options.homeDir || os.homedir();
  return appid ? path.join(homeDir, '.ssh', `private.${appid}.key`) : '';
}

function readMiniappAppid(options = {}) {
  const rootDir = options.rootDir || path.resolve(__dirname, '..');
  const projectConfigPath = options.projectConfigPath || path.join(rootDir, 'miniapp', 'project.config.json');
  const projectConfig = JSON.parse(fs.readFileSync(projectConfigPath, 'utf-8'));
  return projectConfig.appid || '';
}

function buildCiProjectOptions(options = {}) {
  const rootDir = options.rootDir || path.resolve(__dirname, '..');
  const projectDir = options.projectDir || path.join(rootDir, 'miniapp');
  const appid = options.appid || readMiniappAppid({ rootDir });
  const privateKeyPath = options.privateKeyPath || resolveMiniappPrivateKeyPath({ ...options, rootDir, appid });
  return {
    appid,
    type: 'miniProgram',
    projectPath: projectDir,
    privateKeyPath,
    ignores: ['node_modules/**/*'],
  };
}

function resolveCiUploadThreads(options = {}) {
  const env = options.env || process.env;
  const rawThreads = options.threads !== undefined && options.threads !== ''
    ? options.threads
    : env.MINIAPP_UPLOAD_THREADS;
  const threads = rawThreads === undefined || rawThreads === '' ? 1 : Number(rawThreads);
  if (!Number.isInteger(threads) || threads < 1 || threads > 8) {
    throw new Error('miniapp upload threads must be an integer between 1 and 8');
  }
  return threads;
}

function resolveCiProxyUrl(options = {}) {
  const env = options.env || process.env;
  const proxyUrl = options.proxyUrl || env.MINIAPP_UPLOAD_PROXY_URL || '';
  if (!proxyUrl) return '';

  let parsedProxyUrl;
  try {
    parsedProxyUrl = new URL(proxyUrl);
  } catch {
    throw new Error('miniapp upload proxy URL must use http: or https: and include a hostname');
  }
  if (!['http:', 'https:'].includes(parsedProxyUrl.protocol) || !parsedProxyUrl.hostname) {
    throw new Error('miniapp upload proxy URL must use http: or https: and include a hostname');
  }
  return proxyUrl;
}

function readMiniprogramCiVersion(options = {}) {
  if (Object.prototype.hasOwnProperty.call(options, 'ciVersion') && options.ciVersion !== undefined) {
    return String(options.ciVersion || '');
  }
  const rootDir = options.rootDir || path.resolve(__dirname, '..');
  const packagePath = path.join(rootDir, 'miniapp', 'node_modules', 'miniprogram-ci', 'package.json');
  try {
    return String(JSON.parse(fs.readFileSync(packagePath, 'utf8')).version || '');
  } catch {
    throw new Error(MINIAPP_CI_VERSION_MISMATCH);
  }
}

function assertMiniprogramCiVersion(options = {}) {
  if (readMiniprogramCiVersion(options) !== EXPECTED_MINIPROGRAM_CI_VERSION) {
    throw new Error(MINIAPP_CI_VERSION_MISMATCH);
  }
}

async function uploadWithMiniprogramCi(options = {}) {
  const proxyUrl = resolveCiProxyUrl(options);
  const threads = resolveCiUploadThreads(options);
  const rootDir = options.rootDir || path.resolve(__dirname, '..');
  const ciPath = path.join(rootDir, 'miniapp', 'node_modules', 'miniprogram-ci');
  assertMiniprogramCiVersion({ rootDir, ciVersion: options.ciVersion });
  const ci = options.ci || require(ciPath);
  if (proxyUrl) {
    ci.proxy(proxyUrl);
  }
  const project = new ci.Project(buildCiProjectOptions(options));
  return ci.upload({
    project,
    version: options.version,
    desc: options.desc,
    setting: {
      useProjectConfig: true,
    },
    robot: Number(options.robot || process.env.WECHAT_MINIAPP_ROBOT || 1),
    threads,
    onProgressUpdate: options.onProgressUpdate || ((event) => {
      if (event && typeof event === 'object') {
        const status = event.message || event.status || event.percent;
        if (status) console.log(`[miniapp-ci] ${status}`);
      }
    }),
  });
}

function buildUploadArgs(options) {
  const rootDir = options.rootDir || path.resolve(__dirname, '..');
  const projectDir = options.projectDir || path.join(rootDir, 'miniapp');
  const infoOutput = options.infoOutput || path.join(os.tmpdir(), 'gewu-miniapp-upload-info.json');
  const desc = options.desc || `格物工坊小程序发布 ${new Date().toISOString().slice(0, 10)}`;

  return [
    'upload',
    '--project',
    projectDir,
    '--version',
    options.version,
    '--desc',
    desc,
    '--info-output',
    infoOutput,
    '--lang',
    'zh',
  ];
}

function buildUploadExecOptions(options = {}) {
  const platform = options.platform || process.platform;
  return {
    cwd: options.cwd,
    stdio: options.stdio || 'inherit',
    shell: false,
  };
}

function buildUploadCommand(options) {
  const platform = options.platform || process.platform;
  if (platform === 'win32') {
    const cliDir = path.dirname(options.cliPath);
    return {
      file: path.join(cliDir, 'node.exe'),
      args: [path.join(cliDir, 'cli.js'), ...(options.args || [])],
    };
  }
  return {
    file: options.cliPath,
    args: options.args || [],
  };
}

function resolveReleaseManifestPath({ rootDir = path.resolve(__dirname, '..'), argv = [], env = process.env, matrix = releaseMatrix } = {}) {
  const configured = parseOption(argv, 'release-manifest') || env.GEWU_RELEASE_MANIFEST_PATH;
  return configured ? path.resolve(rootDir, configured) : matrix.defaultManifestPath(rootDir);
}

function defaultPendingMarkerPath(rootDir = path.resolve(__dirname, '..'), manifestPath = releaseMatrix.defaultManifestPath(rootDir)) {
  return path.join(path.dirname(manifestPath), 'miniapp-upload-pending.json');
}

function isLoopbackProxyUrl(proxyUrl) {
  const match = /^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})$/.exec(String(proxyUrl || ''));
  if (!match) return false;
  return Number(match[1]) <= 65535;
}

function assertProductionUploadGuard({ uploadMode, proxyUrl, deferReceipt, allowUnsafeTestUpload, dryRun }) {
  if (dryRun || allowUnsafeTestUpload === true) return;
  if (uploadMode !== 'miniprogram-ci' || !deferReceipt || !isLoopbackProxyUrl(proxyUrl)) {
    throw new Error(MINIAPP_FIXED_EGRESS_REQUIRED);
  }
}

function temporarySiblingPath(filePath) {
  return path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
  );
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = temporarySiblingPath(filePath);
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
    fs.renameSync(temporaryPath, filePath);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

function atomicWriteManifest(manifestPath, manifest, matrix = releaseMatrix) {
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  const temporaryPath = temporarySiblingPath(manifestPath);
  try {
    matrix.writeManifest(temporaryPath, manifest);
    fs.renameSync(temporaryPath, manifestPath);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

function readPendingMarker(markerPath) {
  if (!fs.existsSync(markerPath)) {
    throw new Error(MINIAPP_DEFERRED_UPLOAD_MARKER_MISSING);
  }
  let marker;
  try {
    marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  } catch {
    throw new Error(MINIAPP_DEFERRED_UPLOAD_MARKER_INVALID);
  }
  const keys = marker && typeof marker === 'object' && !Array.isArray(marker)
    ? Object.keys(marker).sort()
    : [];
  const completedAt = marker?.completedAt;
  const completedDate = typeof completedAt === 'string' ? new Date(completedAt) : null;
  const validCompletedAt = completedDate
    && !Number.isNaN(completedDate.getTime())
    && completedDate.toISOString() === completedAt;
  if (
    keys.length !== PENDING_MARKER_KEYS.length
    || keys.some((key, index) => key !== PENDING_MARKER_KEYS[index])
    || marker.schema !== MINIAPP_PENDING_UPLOAD_SCHEMA
    || !/^\d+\.\d+\.\d+$/.test(String(marker.version || ''))
    || !['miniprogram-ci', 'devtools'].includes(marker.uploadMode)
    || typeof marker.commit !== 'string'
    || !marker.commit
    || typeof marker.appid !== 'string'
    || !marker.appid
    || !validCompletedAt
  ) {
    throw new Error(MINIAPP_DEFERRED_UPLOAD_MARKER_INVALID);
  }
  return marker;
}

function completedAt(options = {}) {
  const value = options.now ? options.now() : new Date();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(MINIAPP_DEFERRED_UPLOAD_MARKER_INVALID);
  }
  return date.toISOString();
}

function deferredReceiptEvidence(uploadMode) {
  return `${uploadMode} development upload confirmed after post-health`;
}

function recordOrDeferReceipt({
  deferReceipt,
  markerPath,
  matrix,
  release,
  version,
  uploadMode,
  evidence,
  commit,
  appid,
  now,
}) {
  if (deferReceipt) {
    atomicWriteJson(markerPath, {
      schema: MINIAPP_PENDING_UPLOAD_SCHEMA,
      version,
      uploadMode,
      completedAt: completedAt({ now }),
      commit,
      appid,
    });
    return;
  }
  matrix.recordReceipt(release.manifest, {
    target: 'miniapp',
    version,
    evidence,
    releaseLevel: 'development',
  });
  atomicWriteManifest(release.manifestPath, release.manifest, matrix);
}

function loadDeferredReceiptContext(options = {}) {
  const rootDir = options.rootDir || path.resolve(__dirname, '..');
  const argv = options.argv || process.argv.slice(2);
  const env = options.env || process.env;
  const matrix = options.releaseMatrix || releaseMatrix;
  const manifestPath = options.manifestPath || resolveReleaseManifestPath({ rootDir, argv, env, matrix });
  const markerPath = options.markerPath || defaultPendingMarkerPath(rootDir, manifestPath);
  const marker = readPendingMarker(markerPath);
  const manifest = matrix.readManifest(manifestPath);
  const version = matrix.resolveTargetVersion({
    manifest,
    target: 'miniapp',
    requestedVersion: parseOption(argv, 'version'),
  });
  const sourceVersions = matrix.assertSourceVersionMatrix(matrix.readSourceVersionMatrix({ rootDir }));
  if (sourceVersions.miniapp !== version) throw new Error(MINIAPP_DEFERRED_UPLOAD_VERSION_MISMATCH);
  if (marker.version !== version) {
    throw new Error(MINIAPP_DEFERRED_UPLOAD_VERSION_MISMATCH);
  }
  const appid = readMiniappAppid({ rootDir });
  if (marker.commit !== manifest.commit || marker.appid !== appid) {
    throw new Error(MINIAPP_DEFERRED_UPLOAD_CONTEXT_MISMATCH);
  }
  const evidence = deferredReceiptEvidence(marker.uploadMode);
  const targetState = manifest.targets.miniapp;
  if (
    targetState.status === 'verified'
    && (
      targetState.receipt?.version !== version
      || targetState.receipt?.evidence !== evidence
    )
  ) {
    throw new Error(MINIAPP_DEFERRED_UPLOAD_RECEIPT_MISMATCH);
  }
  return { appid, evidence, manifest, manifestPath, marker, markerPath, matrix, targetState, version };
}

function validateDeferredReceipt(options = {}) {
  const context = loadDeferredReceiptContext(options);
  const log = options.log || console.log;
  log(JSON.stringify({
    success: true,
    action: 'validated-deferred-receipt',
    uploadMode: context.marker.uploadMode,
    version: context.version,
  }, null, 2));
  return context;
}

function finalizeDeferredReceipt(options = {}) {
  const {
    evidence,
    manifest,
    manifestPath,
    marker,
    markerPath,
    matrix,
    targetState,
    version,
  } = loadDeferredReceiptContext(options);
  let action = 'finalized-deferred-receipt';
  if (targetState.status === 'pending') {
    matrix.recordReceipt(manifest, {
      target: 'miniapp',
      version,
      evidence,
      releaseLevel: 'development',
    });
    atomicWriteManifest(manifestPath, manifest, matrix);
  } else if (targetState.status === 'verified') {
    action = 'recovered-deferred-receipt-cleanup';
  } else {
    throw new Error(MINIAPP_DEFERRED_UPLOAD_RECEIPT_MISMATCH);
  }
  const removeFile = options.removeFile || ((filePath) => fs.rmSync(filePath, { force: false }));
  removeFile(markerPath);
  const log = options.log || console.log;
  log(JSON.stringify({
    success: true,
    action,
    uploadMode: marker.uploadMode,
    version,
  }, null, 2));
}

async function main(options = {}) {
  const argv = options.argv || process.argv.slice(2);
  const rootDir = options.rootDir || path.resolve(__dirname, '..');
  const matrix = options.releaseMatrix || releaseMatrix;
  const log = options.log || console.log;
  const env = options.env || process.env;
  const manifestPath = options.manifestPath || resolveReleaseManifestPath({ rootDir, argv, env, matrix });
  const markerPath = options.markerPath || defaultPendingMarkerPath(rootDir, manifestPath);
  const receiptOperationRequested = (
    argv.includes('--validate-deferred-receipt')
    || argv.includes('--finalize-deferred-receipt')
  );
  if (
    receiptOperationRequested
    && options.internalReceiptOperation !== true
    && env.GEWU_MINIAPP_INTERNAL_RECEIPT_OPERATION !== '1'
  ) {
    throw new Error(MINIAPP_RECEIPT_OPERATION_INTERNAL_ONLY);
  }
  if (argv.includes('--validate-deferred-receipt')) {
    validateDeferredReceipt({ ...options, argv, rootDir, releaseMatrix: matrix, markerPath, log });
    return;
  }
  if (argv.includes('--finalize-deferred-receipt')) {
    finalizeDeferredReceipt({ ...options, argv, rootDir, releaseMatrix: matrix, markerPath, log });
    return;
  }

  const uploadMode = parseOption(argv, 'upload-mode') || env.MINIAPP_UPLOAD_MODE || 'auto';
  const proxyUrl = parseOption(argv, 'proxy');
  const deferReceipt = argv.includes('--defer-receipt');
  assertProductionUploadGuard({
    uploadMode,
    proxyUrl,
    deferReceipt,
    allowUnsafeTestUpload: options.allowUnsafeTestUpload,
    dryRun: argv.includes('--dry-run'),
  });

  const release = matrix.assertReleaseTarget({
    rootDir,
    manifestPath,
    target: 'miniapp',
    requestedVersion: parseOption(argv, 'version'),
  });
  if (fs.existsSync(markerPath)) {
    throw new Error(MINIAPP_DEFERRED_UPLOAD_RECONCILIATION_REQUIRED);
  }
  const version = resolveUploadVersion({ argv, releaseManifest: release.manifest });
  const desc = parseOption(argv, 'desc') || parseOption(argv, 'description') || `格物工坊小程序发布 ${new Date().toISOString().slice(0, 10)}`;
  const infoOutput = parseOption(argv, 'info-output') || path.join(os.tmpdir(), 'gewu-miniapp-upload-info.json');
  const threads = parseOption(argv, 'threads');
  const appid = readMiniappAppid({ rootDir });
  const privateKeyPath = parseOption(argv, 'private-key') || resolveMiniappPrivateKeyPath({ rootDir, appid, env });
  if (
    !argv.includes('--dry-run')
    && options.allowUnsafeTestUpload !== true
    && (!privateKeyPath || !fs.existsSync(privateKeyPath))
  ) {
    throw new Error(MINIAPP_FIXED_EGRESS_REQUIRED);
  }

  if (uploadMode !== 'devtools' && privateKeyPath && fs.existsSync(privateKeyPath)) {
    if (argv.includes('--dry-run')) {
      log(JSON.stringify({
        uploadMode: 'miniprogram-ci',
        appid,
        projectPath: path.join(rootDir, 'miniapp'),
        privateKeyPresent: Boolean(privateKeyPath && fs.existsSync(privateKeyPath)),
        version,
        desc,
      }, null, 2));
      return;
    }

    const result = await uploadWithMiniprogramCi({
      rootDir,
      appid,
      privateKeyPath,
      version,
      desc,
      robot: parseOption(argv, 'robot'),
      proxyUrl,
      threads,
      env,
      ci: options.ci,
      ciVersion: options.ciVersion,
    });
    recordOrDeferReceipt({
      deferReceipt,
      markerPath,
      matrix,
      release,
      version,
      uploadMode: 'miniprogram-ci',
      evidence: `miniprogram-ci development upload for ${appid}`,
      commit: release.manifest.commit,
      appid,
      now: options.now,
    });
    log(JSON.stringify({ success: true, uploadMode: 'miniprogram-ci', deferredReceipt: deferReceipt, result }, null, 2));
    return;
  }

  const cliPath = resolveWechatCliPath();
  const args = buildUploadArgs({ rootDir, version, desc, infoOutput });

  if (argv.includes('--dry-run')) {
    log(JSON.stringify({ cliPath, args }, null, 2));
    return;
  }

  if (!fs.existsSync(cliPath) && path.isAbsolute(cliPath)) {
    throw new Error(`WeChat DevTools CLI not found: ${cliPath}`);
  }

  if (fs.existsSync(infoOutput)) {
    fs.rmSync(infoOutput, { force: true });
  }

  const command = buildUploadCommand({ cliPath, args });
  childProcess.execFileSync(command.file, command.args, buildUploadExecOptions({ cwd: rootDir }));

  recordOrDeferReceipt({
    deferReceipt,
    markerPath,
    matrix,
    release,
    version,
    uploadMode: 'devtools',
    evidence: `wechat-devtools development upload for ${appid}`,
    commit: release.manifest.commit,
    appid,
    now: options.now,
  });

  if (fs.existsSync(infoOutput)) {
    log(fs.readFileSync(infoOutput, 'utf-8'));
  }
}

function stableCliError(error) {
  const message = error && typeof error.message === 'string' ? error.message : '';
  return /^MINIAPP_[A-Z0-9_]+$/.test(message) ? message : MINIAPP_UPLOAD_FAILED;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(stableCliError(err));
    process.exit(1);
  });
}

module.exports = {
  EXPECTED_MINIPROGRAM_CI_VERSION,
  MINIAPP_CI_VERSION_MISMATCH,
  MINIAPP_DEFERRED_UPLOAD_CONTEXT_MISMATCH,
  MINIAPP_DEFERRED_UPLOAD_MARKER_INVALID,
  MINIAPP_DEFERRED_UPLOAD_MARKER_MISSING,
  MINIAPP_DEFERRED_UPLOAD_RECEIPT_MISMATCH,
  MINIAPP_DEFERRED_UPLOAD_RECONCILIATION_REQUIRED,
  MINIAPP_DEFERRED_UPLOAD_VERSION_MISMATCH,
  MINIAPP_FIXED_EGRESS_REQUIRED,
  MINIAPP_PENDING_UPLOAD_SCHEMA,
  MINIAPP_RECEIPT_OPERATION_INTERNAL_ONLY,
  atomicWriteManifest,
  buildCiProjectOptions,
  buildUploadArgs,
  buildUploadCommand,
  buildUploadExecOptions,
  defaultPendingMarkerPath,
  finalizeDeferredReceipt,
  loadDeferredReceiptContext,
  main,
  readPendingMarker,
  readMiniappAppid,
  resolveMiniappPrivateKeyPath,
  resolveReleaseManifestPath,
  resolveUploadVersion,
  resolveWechatCliPath,
  uploadWithMiniprogramCi,
  validateDeferredReceipt,
};
