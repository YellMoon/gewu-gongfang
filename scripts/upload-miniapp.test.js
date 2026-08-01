const assert = require('assert');
const path = require('path');

const {
  buildCiProjectOptions,
  buildUploadArgs,
  buildUploadCommand,
  buildUploadExecOptions,
  resolveMiniappPrivateKeyPath,
  resolveUploadVersion,
  resolveWechatCliPath,
  uploadWithMiniprogramCi,
} = require('./upload-miniapp');

const rootDir = path.resolve(__dirname, '..');

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
      }),
      { message: proxyError },
      `proxy URL ${invalidProxyUrl} should be rejected`
    );
  }
}

testMiniprogramCiProxyAndThreads()
  .then(() => {
    console.log('upload-miniapp checks passed');
  })
  .catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  });
