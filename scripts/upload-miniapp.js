const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

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
  if (explicitVersion) return explicitVersion;

  const pkg = options.packageJson || require(path.join(__dirname, '..', 'package.json'));
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

async function uploadWithMiniprogramCi(options = {}) {
  const rootDir = options.rootDir || path.resolve(__dirname, '..');
  const ciPath = path.join(rootDir, 'miniapp', 'node_modules', 'miniprogram-ci');
  const ci = require(ciPath);
  const project = new ci.Project(buildCiProjectOptions(options));
  return ci.upload({
    project,
    version: options.version,
    desc: options.desc,
    setting: {
      useProjectConfig: true,
    },
    robot: Number(options.robot || process.env.WECHAT_MINIAPP_ROBOT || 1),
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

async function main() {
  const argv = process.argv.slice(2);
  const rootDir = path.resolve(__dirname, '..');
  const version = resolveUploadVersion({ argv });
  const desc = parseOption(argv, 'desc') || parseOption(argv, 'description') || `格物工坊小程序发布 ${new Date().toISOString().slice(0, 10)}`;
  const infoOutput = parseOption(argv, 'info-output') || path.join(os.tmpdir(), 'gewu-miniapp-upload-info.json');
  const uploadMode = parseOption(argv, 'upload-mode') || process.env.MINIAPP_UPLOAD_MODE || 'auto';
  const appid = readMiniappAppid({ rootDir });
  const privateKeyPath = parseOption(argv, 'private-key') || resolveMiniappPrivateKeyPath({ rootDir, appid });

  if (uploadMode !== 'devtools' && privateKeyPath && fs.existsSync(privateKeyPath)) {
    if (argv.includes('--dry-run')) {
      console.log(JSON.stringify({
        uploadMode: 'miniprogram-ci',
        appid,
        projectPath: path.join(rootDir, 'miniapp'),
        privateKeyPath,
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
    });
    console.log(JSON.stringify({ success: true, uploadMode: 'miniprogram-ci', result }, null, 2));
    return;
  }

  const cliPath = resolveWechatCliPath();
  const args = buildUploadArgs({ rootDir, version, desc, infoOutput });

  if (argv.includes('--dry-run')) {
    console.log(JSON.stringify({ cliPath, args }, null, 2));
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

  if (fs.existsSync(infoOutput)) {
    console.log(fs.readFileSync(infoOutput, 'utf-8'));
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

module.exports = {
  buildCiProjectOptions,
  buildUploadArgs,
  buildUploadCommand,
  buildUploadExecOptions,
  readMiniappAppid,
  resolveMiniappPrivateKeyPath,
  resolveUploadVersion,
  resolveWechatCliPath,
  uploadWithMiniprogramCi,
};
