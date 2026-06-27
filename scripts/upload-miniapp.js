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

function main() {
  const argv = process.argv.slice(2);
  const rootDir = path.resolve(__dirname, '..');
  const version = resolveUploadVersion({ argv });
  const desc = parseOption(argv, 'desc') || parseOption(argv, 'description') || `格物工坊小程序发布 ${new Date().toISOString().slice(0, 10)}`;
  const infoOutput = parseOption(argv, 'info-output') || path.join(os.tmpdir(), 'gewu-miniapp-upload-info.json');
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

  childProcess.execFileSync(cliPath, args, {
    cwd: rootDir,
    stdio: 'inherit',
  });

  if (fs.existsSync(infoOutput)) {
    console.log(fs.readFileSync(infoOutput, 'utf-8'));
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  buildUploadArgs,
  resolveUploadVersion,
  resolveWechatCliPath,
};
