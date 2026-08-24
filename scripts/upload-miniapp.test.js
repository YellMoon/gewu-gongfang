const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const releaseMatrix = require('./release-matrix');

const {
  EXPECTED_MINIPROGRAM_CI_VERSION,
  MINIAPP_DEFERRED_UPLOAD_MARKER_INVALID,
  MINIAPP_DEFERRED_UPLOAD_MARKER_MISSING,
  MINIAPP_DEFERRED_UPLOAD_RECONCILIATION_REQUIRED,
  MINIAPP_DEFERRED_UPLOAD_VERSION_MISMATCH,
  MINIAPP_PENDING_UPLOAD_SCHEMA,
  buildCiProjectOptions,
  buildUploadArgs,
  buildUploadCommand,
  buildUploadExecOptions,
  main,
  resolveMiniappPrivateKeyPath,
  resolveReleaseManifestPath,
  resolveUploadVersion,
  resolveWechatCliPath,
  uploadWithMiniprogramCi,
} = require('./upload-miniapp');

const rootDir = path.resolve(__dirname, '..');
const releaseVersion = '7.2.10';
const rootPackage = require('../package.json');
const miniappPackage = require('../miniapp/package.json');
const miniappPackageLock = require('../miniapp/package-lock.json');

assert.strictEqual(
  MINIAPP_PENDING_UPLOAD_SCHEMA,
  'gewu.miniapp-upload-pending.v2',
  'commit/appid-bound deferred markers must use the v2 schema'
);

assert.strictEqual(
  miniappPackage.devDependencies['miniprogram-ci'],
  '2.1.31',
  'miniapp package must pin miniprogram-ci exactly'
);
assert.strictEqual(
  miniappPackageLock.packages[''].devDependencies['miniprogram-ci'],
  '2.1.31',
  'package-lock top-level specifier must pin miniprogram-ci exactly'
);
assert.strictEqual(
  miniappPackageLock.packages['node_modules/miniprogram-ci'].version,
  '2.1.31',
  'package-lock must resolve the approved miniprogram-ci version'
);
assert.strictEqual(
  rootPackage.scripts['miniapp:upload'],
  'python scripts/miniapp_fixed_egress.py',
  'miniapp upload must enter the Python lock owner before any build'
);
assert.ok(
  rootPackage.scripts['test:release-matrix'].includes('python scripts/miniapp_fixed_egress.test.py'),
  'release-matrix tests must execute the unified fixed-egress Python suite'
);

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function createReleaseRoot() {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-miniapp-upload-test-'));
  for (const relativePath of [
    'package.json',
    path.join('cloud-business-api', 'package.json'),
    path.join('backend', 'package.json'),
    path.join('gateway', 'package.json'),
    path.join('miniapp', 'package.json'),
  ]) {
    writeJson(path.join(fixtureRoot, relativePath), { version: releaseVersion });
  }
  writeJson(path.join(fixtureRoot, 'miniapp', 'project.config.json'), { appid: 'wx-test-app' });
  const privateKeyPath = path.join(fixtureRoot, 'private.wx-test-app.key');
  fs.writeFileSync(privateKeyPath, 'offline-test-key', 'utf8');
  const manifestPath = releaseMatrix.defaultManifestPath(fixtureRoot);
  releaseMatrix.writeManifest(
    manifestPath,
    releaseMatrix.createReleaseManifest({
      version: releaseVersion,
      commit: '测试提交',
      createdAt: '2026-08-01T00:00:00.000Z',
    })
  );
  return {
    fixtureRoot,
    manifestPath,
    markerPath: path.join(fixtureRoot, 'output', 'release-matrix', 'miniapp-upload-pending.json'),
    privateKeyPath,
  };
}

function createFakeCi(uploadCalls) {
  return {
    proxy() {},
    Project: class FakeProject {
      constructor(options) {
        this.options = options;
      }
    },
    async upload(options) {
      uploadCalls.push(options);
      return { success: true };
    },
  };
}

assert.strictEqual(
  resolveUploadVersion({ packageJson: { version: '5.0.34' } }),
  '5.0.34',
  'miniapp upload should default to the root package version'
);

assert.strictEqual(
  resolveUploadVersion({ argv: ['--version=6.1.0'], packageJson: { version: '5.0.34' } }),
  '6.1.0',
  'miniapp upload should preserve an explicit version override'
);

assert.strictEqual(
  resolveReleaseManifestPath({ rootDir, argv: [], env: { GEWU_RELEASE_MANIFEST_PATH: 'output/release-matrix-8.3.0/active.json' } }),
  path.join(rootDir, 'output', 'release-matrix-8.3.0', 'active.json'),
  'miniapp upload should honor the same explicit release manifest path as the unified deploy tooling'
);

const args = buildUploadArgs({
  rootDir,
  version: '5.0.34',
  desc: '联调发布',
  infoOutput: 'C:/tmp/upload-info.json',
});

assert.deepStrictEqual(args.slice(0, 2), ['upload', '--project']);
assert.ok(args.includes(path.join(rootDir, 'miniapp')), 'upload should target the miniapp project directory');
assert.ok(args.includes('--version'), 'upload should pass a version');
assert.ok(args.includes('5.0.34'), 'upload should use the resolved version');
assert.ok(args.includes('--desc'), 'upload should pass a description');
assert.ok(args.includes('联调发布'), 'upload should use the provided description');
assert.ok(args.includes('--info-output'), 'upload should request machine-readable output');

assert.ok(
  /微信web开发者工具[\\/]+cli\.bat$/.test(resolveWechatCliPath({ platform: 'win32' })),
  'Windows default CLI path should point to WeChat DevTools cli.bat'
);

assert.strictEqual(
  buildUploadExecOptions({ platform: 'win32' }).shell,
  false,
  'Windows upload should avoid implicit shell mode and use an explicit cmd.exe command'
);

assert.strictEqual(
  buildUploadExecOptions({ platform: 'linux' }).shell,
  false,
  'non-Windows CLI upload should not force shell execution'
);

const winCommand = buildUploadCommand({
  cliPath: 'C:\\Program Files (x86)\\Tencent\\微信web开发者工具\\cli.bat',
  args: ['upload', '--desc', '含 空格'],
  platform: 'win32',
});
assert.strictEqual(
  winCommand.file,
  'C:\\Program Files (x86)\\Tencent\\微信web开发者工具\\node.exe',
  'Windows upload should call WeChat DevTools node.exe directly'
);
assert.strictEqual(
  winCommand.args[0],
  'C:\\Program Files (x86)\\Tencent\\微信web开发者工具\\cli.js',
  'Windows upload should pass WeChat DevTools cli.js as the first argument'
);
assert.ok(
  winCommand.args.includes('含 空格'),
  'Windows direct node execution should preserve arguments with spaces'
);

assert.strictEqual(
  resolveMiniappPrivateKeyPath({
    appid: 'wx123',
    homeDir: 'C:\\Users\\demo',
    env: {},
  }),
  'C:\\Users\\demo\\.ssh\\private.wx123.key',
  'miniapp upload should auto-discover the official upload key under .ssh'
);

assert.strictEqual(
  resolveMiniappPrivateKeyPath({
    appid: 'wx123',
    homeDir: 'C:\\Users\\demo',
    env: { WECHAT_MINIAPP_PRIVATE_KEY_PATH: 'D:\\keys\\wx.key' },
  }),
  'D:\\keys\\wx.key',
  'miniapp upload should allow explicit private key path override'
);

const ciOptions = buildCiProjectOptions({
  rootDir,
  appid: 'wx123',
  privateKeyPath: 'C:\\Users\\demo\\.ssh\\private.wx123.key',
});
assert.strictEqual(ciOptions.type, 'miniProgram', 'miniprogram-ci should use miniProgram project type');
assert.strictEqual(ciOptions.appid, 'wx123', 'miniprogram-ci should receive the miniapp appid');
assert.strictEqual(ciOptions.projectPath, path.join(rootDir, 'miniapp'), 'miniprogram-ci should upload the miniapp project');
assert.strictEqual(ciOptions.privateKeyPath, 'C:\\Users\\demo\\.ssh\\private.wx123.key', 'miniprogram-ci should receive the private key path');
assert.ok(ciOptions.ignores.includes('node_modules/**/*'), 'miniprogram-ci upload should ignore node_modules');

async function testMiniprogramCiProxyAndThreads() {
  const threadsError = 'miniapp upload threads must be an integer between 1 and 8';
  const proxyError = 'miniapp upload proxy URL must use http: or https: and include a hostname';
  const proxyCalls = [];
  const uploadCalls = [];
  let constructedProject;
  const fakeCi = {
    proxy(proxyUrl) {
      proxyCalls.push(proxyUrl);
    },
    Project: class FakeProject {
      constructor(options) {
        this.options = options;
        constructedProject = this;
      }
    },
    async upload(options) {
      uploadCalls.push(options);
      return { success: true };
    },
  };

  await uploadWithMiniprogramCi({
    rootDir: path.join(rootDir, 'missing-for-ci-injection-test'),
    appid: 'wx123',
    privateKeyPath: 'C:\\Users\\demo\\.ssh\\private.wx123.key',
    version: '5.0.34',
    desc: '代理上传测试',
    proxyUrl: 'http://127.0.0.1:18080',
    env: {},
    ci: fakeCi,
    ciVersion: EXPECTED_MINIPROGRAM_CI_VERSION,
  });

  assert.deepStrictEqual(
    proxyCalls,
    ['http://127.0.0.1:18080'],
    'miniprogram-ci should receive the explicit proxy URL'
  );
  assert.strictEqual(uploadCalls.length, 1, 'miniprogram-ci upload should be called once');
  assert.strictEqual(uploadCalls[0].threads, 1, 'miniprogram-ci upload should default to one thread');
  assert.strictEqual(
    uploadCalls[0].project,
    constructedProject,
    'miniprogram-ci upload should receive the constructed project'
  );

  await assert.rejects(
    uploadWithMiniprogramCi({
      rootDir: path.join(rootDir, 'missing-for-ci-injection-test'),
      appid: 'wx123',
      privateKeyPath: 'C:\\Users\\demo\\.ssh\\private.wx123.key',
      version: '5.0.34',
      threads: 0,
      env: {},
      ci: fakeCi,
      ciVersion: EXPECTED_MINIPROGRAM_CI_VERSION,
    }),
    { message: threadsError },
    'threads value 0 should be rejected'
  );

  await uploadWithMiniprogramCi({
    rootDir: path.join(rootDir, 'missing-for-ci-injection-test'),
    appid: 'wx123',
    privateKeyPath: 'C:\\Users\\demo\\.ssh\\private.wx123.key',
    version: '5.0.34',
    desc: '显式线程数测试',
    proxyUrl: 'https://explicit-proxy.example.test',
    threads: '2',
    env: {
      MINIAPP_UPLOAD_PROXY_URL: 'https://ignored-proxy.example.test',
      MINIAPP_UPLOAD_THREADS: '3',
    },
    ci: fakeCi,
    ciVersion: EXPECTED_MINIPROGRAM_CI_VERSION,
  });
  assert.strictEqual(
    proxyCalls[proxyCalls.length - 1],
    'https://explicit-proxy.example.test',
    'explicit proxy should take precedence over the environment'
  );
  assert.strictEqual(uploadCalls[uploadCalls.length - 1].threads, 2, 'string thread count should be converted to a number');

  await uploadWithMiniprogramCi({
    rootDir: path.join(rootDir, 'missing-for-ci-injection-test'),
    appid: 'wx123',
    privateKeyPath: 'C:\\Users\\demo\\.ssh\\private.wx123.key',
    version: '5.0.34',
    desc: '环境变量回退测试',
    env: {
      MINIAPP_UPLOAD_PROXY_URL: 'http://127.0.0.1:18081',
      MINIAPP_UPLOAD_THREADS: '3',
    },
    ci: fakeCi,
    ciVersion: EXPECTED_MINIPROGRAM_CI_VERSION,
  });
  assert.strictEqual(
    proxyCalls[proxyCalls.length - 1],
    'http://127.0.0.1:18081',
    'proxy should fall back to MINIAPP_UPLOAD_PROXY_URL'
  );
  assert.strictEqual(
    uploadCalls[uploadCalls.length - 1].threads,
    3,
    'threads should fall back to MINIAPP_UPLOAD_THREADS'
  );

  for (const invalidThreads of [-1, 1.5, 'not-a-number', Infinity, 9]) {
    await assert.rejects(
      uploadWithMiniprogramCi({
        rootDir: path.join(rootDir, 'missing-for-ci-injection-test'),
        appid: 'wx123',
        privateKeyPath: 'C:\\Users\\demo\\.ssh\\private.wx123.key',
        version: '5.0.34',
        threads: invalidThreads,
        env: {},
        ci: fakeCi,
        ciVersion: EXPECTED_MINIPROGRAM_CI_VERSION,
      }),
      { message: threadsError },
      `threads value ${String(invalidThreads)} should be rejected`
    );
  }

  for (const invalidProxyUrl of ['not-a-url', 'socks5://127.0.0.1:1080', 'http://']) {
    await assert.rejects(
      uploadWithMiniprogramCi({
        rootDir: path.join(rootDir, 'missing-for-ci-injection-test'),
        appid: 'wx123',
        privateKeyPath: 'C:\\Users\\demo\\.ssh\\private.wx123.key',
        version: '5.0.34',
        proxyUrl: invalidProxyUrl,
        env: {},
        ci: fakeCi,
        ciVersion: EXPECTED_MINIPROGRAM_CI_VERSION,
      }),
      { message: proxyError },
      `proxy URL ${invalidProxyUrl} should be rejected`
    );
  }

  const uploadCountBeforeVersionFailure = uploadCalls.length;
  await assert.rejects(
    uploadWithMiniprogramCi({
      rootDir: path.join(rootDir, 'missing-for-ci-injection-test'),
      appid: 'wx123',
      privateKeyPath: 'C:\\Users\\demo\\.ssh\\private.wx123.key',
      version: '5.0.34',
      env: {},
      ci: fakeCi,
      ciVersion: '2.1.30',
    }),
    { message: 'MINIAPP_CI_VERSION_MISMATCH' },
    'an unexpected miniprogram-ci runtime version should fail closed before upload'
  );
  assert.strictEqual(
    uploadCalls.length,
    uploadCountBeforeVersionFailure,
    'CI version mismatch must be rejected before ci.upload'
  );

  const installedCiRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-miniapp-ci-version-test-'));
  try {
    writeJson(
      path.join(installedCiRoot, 'miniapp', 'node_modules', 'miniprogram-ci', 'package.json'),
      { version: EXPECTED_MINIPROGRAM_CI_VERSION }
    );
    await uploadWithMiniprogramCi({
      rootDir: installedCiRoot,
      appid: 'wx123',
      privateKeyPath: 'C:\\Users\\demo\\.ssh\\private.wx123.key',
      version: '5.0.34',
      env: {},
      ci: fakeCi,
    });
    assert.strictEqual(
      uploadCalls.length,
      uploadCountBeforeVersionFailure + 1,
      'production path should read and accept the exact installed CI package version'
    );
  } finally {
    fs.rmSync(installedCiRoot, { recursive: true, force: true });
  }
}

async function testDeferredUploadAndFinalize() {
  const fixture = createReleaseRoot();
  const uploadCalls = [];
  const fakeCi = createFakeCi(uploadCalls);
  try {
    const manifestBefore = fs.readFileSync(fixture.manifestPath, 'utf8');
    await main({
      argv: [
        '--upload-mode=miniprogram-ci',
        '--proxy=http://127.0.0.1:18080',
        '--defer-receipt',
        `--private-key=${fixture.privateKeyPath}`,
      ],
      rootDir: fixture.fixtureRoot,
      ci: fakeCi,
      ciVersion: EXPECTED_MINIPROGRAM_CI_VERSION,
      now: () => new Date('2026-08-01T02:03:04.000Z'),
      log: () => {},
    });
    assert.strictEqual(uploadCalls.length, 1, 'deferred upload should call ci.upload once');
    assert.strictEqual(
      fs.readFileSync(fixture.manifestPath, 'utf8'),
      manifestBefore,
      'successful deferred upload must not modify the unified manifest'
    );
    assert.deepStrictEqual(
      JSON.parse(fs.readFileSync(fixture.markerPath, 'utf8')),
      {
        schema: MINIAPP_PENDING_UPLOAD_SCHEMA,
        version: releaseVersion,
        uploadMode: 'miniprogram-ci',
        completedAt: '2026-08-01T02:03:04.000Z',
        commit: '测试提交',
        appid: 'wx-test-app',
      },
      'deferred upload marker should use the fixed non-sensitive schema'
    );

    const manifestBeforeValidation = fs.readFileSync(fixture.manifestPath, 'utf8');
    const markerBeforeValidation = fs.readFileSync(fixture.markerPath, 'utf8');
    await main({
      argv: ['--validate-deferred-receipt'],
      internalReceiptOperation: true,
      rootDir: fixture.fixtureRoot,
      env: {},
      log: () => {},
    });
    assert.strictEqual(fs.readFileSync(fixture.manifestPath, 'utf8'), manifestBeforeValidation);
    assert.strictEqual(fs.readFileSync(fixture.markerPath, 'utf8'), markerBeforeValidation);

    await assert.rejects(
      main({
        argv: [
          '--upload-mode=miniprogram-ci',
          '--proxy=http://127.0.0.1:18080',
          '--defer-receipt',
          `--private-key=${fixture.privateKeyPath}`,
        ],
        rootDir: fixture.fixtureRoot,
        ci: fakeCi,
        ciVersion: EXPECTED_MINIPROGRAM_CI_VERSION,
        log: () => {},
      }),
      { message: MINIAPP_DEFERRED_UPLOAD_RECONCILIATION_REQUIRED },
      'an unfinished marker should block a second upload'
    );
    assert.strictEqual(uploadCalls.length, 1, 'blocked reconciliation must not call ci.upload again');

    await main({
      argv: ['--finalize-deferred-receipt'],
      internalReceiptOperation: true,
      rootDir: fixture.fixtureRoot,
      env: {},
      log: () => {},
    });
    const finalizedManifest = releaseMatrix.readManifest(fixture.manifestPath);
    assert.strictEqual(finalizedManifest.targets.miniapp.status, 'verified');
    assert.strictEqual(finalizedManifest.targets.miniapp.receipt.version, releaseVersion);
    assert.strictEqual(finalizedManifest.commit, '测试提交', 'atomic UTF-8 manifest replacement should preserve CJK');
    assert.strictEqual(fs.existsSync(fixture.markerPath), false, 'successful finalize should delete the marker');

    const manifestAfterFinalize = fs.readFileSync(fixture.manifestPath, 'utf8');
    await assert.rejects(
      main({
        argv: ['--finalize-deferred-receipt'],
        internalReceiptOperation: true,
        rootDir: fixture.fixtureRoot,
        env: {},
        ci: {
          upload() {
            throw new Error('finalize must not load or call CI');
          },
        },
        log: () => {},
      }),
      { message: MINIAPP_DEFERRED_UPLOAD_MARKER_MISSING },
      'repeated finalize should fail stably when the one-shot marker is gone'
    );
    assert.strictEqual(
      fs.readFileSync(fixture.manifestPath, 'utf8'),
      manifestAfterFinalize,
      'repeated finalize must not write another receipt'
    );
  } finally {
    fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true });
  }
}

async function testProductionCliRejectsUnsafeUploadPaths() {
  const fixture = createReleaseRoot();
  const uploadCalls = [];
  try {
    for (const argv of [
      [
        '--upload-mode=miniprogram-ci',
        `--private-key=${fixture.privateKeyPath}`,
      ],
      [
        '--allow-unsafe-test-upload',
        '--upload-mode=miniprogram-ci',
        `--private-key=${fixture.privateKeyPath}`,
      ],
      [
        '--upload-mode=miniprogram-ci',
        '--proxy=https://proxy.example.test:8443',
        '--defer-receipt',
        `--private-key=${fixture.privateKeyPath}`,
      ],
      [
        '--upload-mode=miniprogram-ci',
        '--proxy=https://127.0.0.1:18080',
        '--defer-receipt',
        `--private-key=${fixture.privateKeyPath}`,
      ],
      [
        '--upload-mode=miniprogram-ci',
        '--proxy=http://[::1]:18080',
        '--defer-receipt',
        `--private-key=${fixture.privateKeyPath}`,
      ],
      [
        '--upload-mode=miniprogram-ci',
        '--proxy=http://127.0.0.1',
        '--defer-receipt',
        `--private-key=${fixture.privateKeyPath}`,
      ],
      [
        '--upload-mode=miniprogram-ci',
        '--proxy=http://127.0.0.1:0',
        '--defer-receipt',
        `--private-key=${fixture.privateKeyPath}`,
      ],
      [
        '--upload-mode=miniprogram-ci',
        '--proxy=http://127.0.0.1:65536',
        '--defer-receipt',
        `--private-key=${fixture.privateKeyPath}`,
      ],
      [
        '--upload-mode=miniprogram-ci',
        '--proxy=http://127.0.0.1:18080',
        `--private-key=${fixture.privateKeyPath}`,
      ],
      [
        '--upload-mode=devtools',
        '--proxy=http://127.0.0.1:18080',
        '--defer-receipt',
      ],
      [
        '--upload-mode=miniprogram-ci',
        '--proxy=http://127.0.0.1:18080',
        '--defer-receipt',
        `--private-key=${path.join(fixture.fixtureRoot, 'missing-private.key')}`,
      ],
    ]) {
      await assert.rejects(
        main({
          argv,
          rootDir: fixture.fixtureRoot,
          ci: createFakeCi(uploadCalls),
          ciVersion: EXPECTED_MINIPROGRAM_CI_VERSION,
          log: () => {},
        }),
        { message: 'MINIAPP_FIXED_EGRESS_REQUIRED' },
        `production CLI path must reject unsafe upload arguments: ${argv.join(' ')}`
      );
    }
    assert.strictEqual(uploadCalls.length, 0, 'unsafe production paths must fail before upload');
    assert.strictEqual(releaseMatrix.readManifest(fixture.manifestPath).targets.miniapp.status, 'pending');
    assert.strictEqual(fs.existsSync(fixture.markerPath), false);
  } finally {
    fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true });
  }
}

async function testDirectReceiptOperationRequiresInternalAuthorization() {
  const fixture = createReleaseRoot();
  try {
    await assert.rejects(
      main({
        argv: ['--finalize-deferred-receipt'],
        rootDir: fixture.fixtureRoot,
        env: {},
        log: () => {},
      }),
      { message: 'MINIAPP_RECEIPT_OPERATION_INTERNAL_ONLY' }
    );
  } finally {
    fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true });
  }
}

async function testExplicitTestInjectionPreservesImmediateReceiptCoverage() {
  const fixture = createReleaseRoot();
  const uploadCalls = [];
  try {
    await main({
      argv: [
        '--upload-mode=miniprogram-ci',
        `--private-key=${fixture.privateKeyPath}`,
      ],
      rootDir: fixture.fixtureRoot,
      ci: createFakeCi(uploadCalls),
      ciVersion: EXPECTED_MINIPROGRAM_CI_VERSION,
      allowUnsafeTestUpload: true,
      log: () => {},
    });
    assert.strictEqual(uploadCalls.length, 1);
    assert.strictEqual(releaseMatrix.readManifest(fixture.manifestPath).targets.miniapp.status, 'verified');
    assert.strictEqual(fs.existsSync(fixture.markerPath), false);
  } finally {
    fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true });
  }
}

async function testCustomReleaseManifestPathReceivesTheReceipt() {
  const fixture = createReleaseRoot();
  const uploadCalls = [];
  const customManifestPath = path.join(fixture.fixtureRoot, 'output', 'release-matrix-8.3.0', 'active.json');
  try {
    fs.mkdirSync(path.dirname(customManifestPath), { recursive: true });
    fs.renameSync(fixture.manifestPath, customManifestPath);
    await main({
      argv: [
        '--upload-mode=miniprogram-ci',
        `--private-key=${fixture.privateKeyPath}`,
      ],
      rootDir: fixture.fixtureRoot,
      env: { GEWU_RELEASE_MANIFEST_PATH: customManifestPath },
      ci: createFakeCi(uploadCalls),
      ciVersion: EXPECTED_MINIPROGRAM_CI_VERSION,
      allowUnsafeTestUpload: true,
      log: () => {},
    });
    assert.strictEqual(uploadCalls.length, 1);
    assert.strictEqual(releaseMatrix.readManifest(customManifestPath).targets.miniapp.status, 'verified');
    assert.strictEqual(fs.existsSync(fixture.manifestPath), false, 'the protected default release manifest path must remain untouched');
  } finally {
    fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true });
  }
}

async function testDryRunRedactsPrivateKeyPath() {
  const fixture = createReleaseRoot();
  const logs = [];
  try {
    await main({
      argv: [
        '--upload-mode=miniprogram-ci',
        '--dry-run',
        `--private-key=${fixture.privateKeyPath}`,
      ],
      rootDir: fixture.fixtureRoot,
      log: (value) => logs.push(value),
    });
    const output = logs.join('\n');
    assert.strictEqual(output.includes(fixture.privateKeyPath), false, 'dry-run must not print a private key path');
    const payload = JSON.parse(logs[0]);
    assert.strictEqual(payload.privateKeyPresent, true);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(payload, 'privateKeyPath'), false);
  } finally {
    fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true });
  }
}

async function testFinalizeRecoversAfterMarkerDeletionFailure() {
  const fixture = createReleaseRoot();
  const uploadCalls = [];
  let receiptWrites = 0;
  let manifestWrites = 0;
  const trackingMatrix = {
    ...releaseMatrix,
    recordReceipt(...args) {
      receiptWrites += 1;
      return releaseMatrix.recordReceipt(...args);
    },
    writeManifest(...args) {
      manifestWrites += 1;
      return releaseMatrix.writeManifest(...args);
    },
  };
  try {
    await main({
      argv: [
        '--upload-mode=miniprogram-ci',
        '--proxy=http://127.0.0.1:18080',
        '--defer-receipt',
        `--private-key=${fixture.privateKeyPath}`,
      ],
      rootDir: fixture.fixtureRoot,
      ci: createFakeCi(uploadCalls),
      ciVersion: EXPECTED_MINIPROGRAM_CI_VERSION,
      log: () => {},
    });
    await assert.rejects(
      main({
        argv: ['--finalize-deferred-receipt'],
        internalReceiptOperation: true,
        rootDir: fixture.fixtureRoot,
        releaseMatrix: trackingMatrix,
        removeFile() {
          const error = new Error('simulated marker delete denial');
          error.code = 'EPERM';
          throw error;
        },
        log: () => {},
      }),
      { code: 'EPERM' },
      'first finalize should expose marker deletion failure after the manifest write'
    );
    assert.strictEqual(releaseMatrix.readManifest(fixture.manifestPath).targets.miniapp.status, 'verified');
    assert.strictEqual(fs.existsSync(fixture.markerPath), true, 'delete failure must leave the marker for recovery');
    assert.strictEqual(receiptWrites, 1);
    assert.strictEqual(manifestWrites, 1);
    const manifestAfterFirstWrite = fs.readFileSync(fixture.manifestPath, 'utf8');

    await main({
      argv: ['--finalize-deferred-receipt'],
      internalReceiptOperation: true,
      rootDir: fixture.fixtureRoot,
      releaseMatrix: trackingMatrix,
      log: () => {},
    });
    assert.strictEqual(fs.existsSync(fixture.markerPath), false, 'recovery finalize should only delete the marker');
    assert.strictEqual(receiptWrites, 1, 'recovery must not record a second receipt');
    assert.strictEqual(manifestWrites, 1, 'recovery must not rewrite the manifest');
    assert.strictEqual(fs.readFileSync(fixture.manifestPath, 'utf8'), manifestAfterFirstWrite);
  } finally {
    fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true });
  }
}

async function testFinalizeRecoveryRejectsMismatchedEvidence() {
  const fixture = createReleaseRoot();
  try {
    writeJson(fixture.markerPath, {
      schema: MINIAPP_PENDING_UPLOAD_SCHEMA,
      version: releaseVersion,
      uploadMode: 'miniprogram-ci',
      completedAt: '2026-08-01T02:03:04.000Z',
      commit: '测试提交',
      appid: 'wx-test-app',
    });
    const manifest = releaseMatrix.readManifest(fixture.manifestPath);
    releaseMatrix.recordReceipt(manifest, {
      target: 'miniapp',
      version: releaseVersion,
      evidence: 'unrelated manual evidence',
    });
    releaseMatrix.writeManifest(fixture.manifestPath, manifest);
    const manifestBefore = fs.readFileSync(fixture.manifestPath, 'utf8');
    await assert.rejects(
      main({
        argv: ['--finalize-deferred-receipt'],
        internalReceiptOperation: true,
        rootDir: fixture.fixtureRoot,
        log: () => {},
      }),
      { message: 'MINIAPP_DEFERRED_UPLOAD_RECEIPT_MISMATCH' }
    );
    assert.strictEqual(fs.existsSync(fixture.markerPath), true);
    assert.strictEqual(fs.readFileSync(fixture.manifestPath, 'utf8'), manifestBefore);

    writeJson(fixture.markerPath, {
      schema: MINIAPP_PENDING_UPLOAD_SCHEMA,
      version: '7.2.9',
      uploadMode: 'miniprogram-ci',
      completedAt: '2026-08-01T02:03:04.000Z',
      commit: '测试提交',
      appid: 'wx-test-app',
    });
    await assert.rejects(
      main({
        argv: ['--finalize-deferred-receipt'],
        internalReceiptOperation: true,
        rootDir: fixture.fixtureRoot,
        log: () => {},
      }),
      { message: MINIAPP_DEFERRED_UPLOAD_VERSION_MISMATCH },
      'recovery must not clean a marker for a different release version'
    );
    assert.strictEqual(fs.existsSync(fixture.markerPath), true);
    assert.strictEqual(fs.readFileSync(fixture.manifestPath, 'utf8'), manifestBefore);
  } finally {
    fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true });
  }
}

async function testDeferredMarkerContextMismatchFailsClosed() {
  for (const markerOverride of [
    { commit: 'different-commit' },
    { appid: 'wx-different-app' },
  ]) {
    const fixture = createReleaseRoot();
    try {
      writeJson(fixture.markerPath, {
        schema: MINIAPP_PENDING_UPLOAD_SCHEMA,
        version: releaseVersion,
        uploadMode: 'miniprogram-ci',
        completedAt: '2026-08-01T02:03:04.000Z',
        commit: '测试提交',
        appid: 'wx-test-app',
        ...markerOverride,
      });
      await assert.rejects(
        main({
          argv: ['--finalize-deferred-receipt'],
          internalReceiptOperation: true,
          rootDir: fixture.fixtureRoot,
          env: {},
          log: () => {},
        }),
        { message: 'MINIAPP_DEFERRED_UPLOAD_CONTEXT_MISMATCH' }
      );
      assert.strictEqual(fs.existsSync(fixture.markerPath), true);
      assert.strictEqual(releaseMatrix.readManifest(fixture.manifestPath).targets.miniapp.status, 'pending');
    } finally {
      fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true });
    }
  }
}

async function testInvalidDeferredMarkersFailClosed() {
  for (const testCase of [
    {
      marker: {
        schema: 'wrong.schema',
        version: releaseVersion,
        uploadMode: 'miniprogram-ci',
        completedAt: '2026-08-01T02:03:04.000Z',
        commit: '测试提交',
        appid: 'wx-test-app',
      },
      expected: MINIAPP_DEFERRED_UPLOAD_MARKER_INVALID,
    },
    {
      marker: {
        schema: MINIAPP_PENDING_UPLOAD_SCHEMA,
        version: '7.2.9',
        uploadMode: 'miniprogram-ci',
        completedAt: '2026-08-01T02:03:04.000Z',
        commit: '测试提交',
        appid: 'wx-test-app',
      },
      expected: MINIAPP_DEFERRED_UPLOAD_VERSION_MISMATCH,
    },
    {
      marker: {
        schema: MINIAPP_PENDING_UPLOAD_SCHEMA,
        version: releaseVersion,
        uploadMode: 'miniprogram-ci',
        completedAt: '2026-08-01T02:03:04.000Z',
      },
      expected: MINIAPP_DEFERRED_UPLOAD_MARKER_INVALID,
    },
  ]) {
    const fixture = createReleaseRoot();
    try {
      writeJson(fixture.markerPath, testCase.marker);
      await assert.rejects(
        main({
          argv: ['--finalize-deferred-receipt'],
          internalReceiptOperation: true,
          rootDir: fixture.fixtureRoot,
          env: {},
          log: () => {},
        }),
        { message: testCase.expected }
      );
      assert.strictEqual(releaseMatrix.readManifest(fixture.manifestPath).targets.miniapp.status, 'pending');
      assert.strictEqual(fs.existsSync(fixture.markerPath), true, 'rejected marker should be preserved for diagnosis');
    } finally {
      fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true });
    }
  }
}

testMiniprogramCiProxyAndThreads()
  .then(testDeferredUploadAndFinalize)
  .then(testDirectReceiptOperationRequiresInternalAuthorization)
  .then(testFinalizeRecoveryRejectsMismatchedEvidence)
  .then(testFinalizeRecoversAfterMarkerDeletionFailure)
  .then(testProductionCliRejectsUnsafeUploadPaths)
  .then(testExplicitTestInjectionPreservesImmediateReceiptCoverage)
  .then(testCustomReleaseManifestPathReceivesTheReceipt)
  .then(testDryRunRedactsPrivateKeyPath)
  .then(testDeferredMarkerContextMismatchFailsClosed)
  .then(testInvalidDeferredMarkersFailClosed)
  .then(() => {
    console.log('upload-miniapp checks passed');
  })
  .catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  });
