const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const packageJson = require('../package.json');

const distDir = path.resolve(process.env.DIST_DIR || path.join(__dirname, '..', 'dist'));
const baseUrl = (process.env.OSS_CDN_BASE_URL || 'https://gewugongfang.oss-cn-hangzhou.aliyuncs.com/desktop').replace(/\/+$/, '');
const objectPrefix = (process.env.OSS_OBJECT_PREFIX || 'desktop').replace(/^\/+|\/+$/g, '');
const dryRun = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';

function encodeObjectPath(value) {
  return value.split('/').map(encodeURIComponent).join('/');
}

function sha512File(filePath) {
  return crypto.createHash('sha512').update(fs.readFileSync(filePath)).digest('base64');
}

function findInstaller() {
  if (!fs.existsSync(distDir)) {
    throw new Error(`dist directory not found: ${distDir}`);
  }
  return fs.readdirSync(distDir)
    .filter(name => name.endsWith('.exe') && name.includes(packageJson.version))
    .map(name => ({
      name,
      path: path.join(distDir, name),
      mtime: fs.statSync(path.join(distDir, name)).mtimeMs,
    }))
    .sort((a, b) => a.mtime - b.mtime)
    .pop();
}

const installer = findInstaller();
if (!installer) {
  throw new Error(`Windows installer for version ${packageJson.version} was not found in ${distDir}`);
}

const installerObjectKey = [objectPrefix, installer.name].filter(Boolean).join('/');
const feedObjectKey = [objectPrefix, 'latest.yml'].filter(Boolean).join('/');
const installerUrl = `${baseUrl}/${encodeObjectPath(installer.name)}`;
const sha512 = process.env.INSTALLER_SHA512 || sha512File(installer.path);
const size = fs.statSync(installer.path).size;

const latest = [
  `version: ${packageJson.version}`,
  'files:',
  `  - url: ${encodeURI(installer.name)}`,
  `    sha512: ${sha512}`,
  `    size: ${size}`,
  `path: ${encodeURI(installer.name)}`,
  `sha512: ${sha512}`,
  `releaseDate: '${new Date().toISOString()}'`,
  '',
].join('\n');

if (!dryRun) {
  fs.writeFileSync(path.join(distDir, 'latest.yml'), latest, 'utf8');
}

const feed = {
  version: packageJson.version,
  dry_run: dryRun,
  installer: {
    file: installer.name,
    size,
    sha512,
    oss_key: installerObjectKey,
    oss_url: installerUrl,
  },
  latest_yml: {
    file: 'latest.yml',
    oss_key: feedObjectKey,
    oss_url: `${baseUrl}/latest.yml`,
    content: latest,
  },
};

console.log(JSON.stringify(feed, null, 2));
