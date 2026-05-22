const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');
const { URL } = require('url');

const packageJson = require('../package.json');

const distDir = path.resolve(process.env.DIST_DIR || path.join(__dirname, '..', 'dist'));
const baseUrl = (process.env.OSS_CDN_BASE_URL || 'https://gewugongfang.oss-cn-hangzhou.aliyuncs.com/desktop').replace(/\/+$/, '');
const objectPrefix = (process.env.OSS_OBJECT_PREFIX || 'desktop').replace(/^\/+|\/+$/g, '');
const dryRun = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';
const writeFeed = process.argv.includes('--write-feed') || process.env.WRITE_FEED === '1' || !dryRun;
const skipUpload = process.argv.includes('--skip-upload') || process.env.SKIP_UPLOAD === '1' || dryRun;

function encodeObjectPath(value) {
  return value.split('/').map(encodeURIComponent).join('/');
}

function sha512File(filePath) {
  return crypto.createHash('sha512').update(fs.readFileSync(filePath)).digest('base64');
}

function md5Base64(buffer) {
  return crypto.createHash('md5').update(buffer).digest('base64');
}

function findInstaller() {
  if (!fs.existsSync(distDir)) {
    throw new Error(`dist directory not found: ${distDir}`);
  }

  const exactVersion = new RegExp(`(^|[^0-9])${packageJson.version.replace(/\./g, '\\.')}([^0-9]|$)`);
  return fs.readdirSync(distDir)
    .filter(name => name.endsWith('.exe') && exactVersion.test(name))
    .map(name => ({
      name,
      path: path.join(distDir, name),
      mtime: fs.statSync(path.join(distDir, name)).mtimeMs,
    }))
    .sort((a, b) => a.mtime - b.mtime)
    .pop();
}

function buildLatestYml(installer, sha512, size) {
  const safeName = encodeURI(installer.name);
  return [
    `version: ${packageJson.version}`,
    'files:',
    `  - url: ${safeName}`,
    `    sha512: ${sha512}`,
    `    size: ${size}`,
    `path: ${safeName}`,
    `sha512: ${sha512}`,
    `releaseDate: '${new Date().toISOString()}'`,
    '',
  ].join('\n');
}

function getOssConfig() {
  const accessKeyId = process.env.OSS_ACCESS_KEY_ID || process.env.ALIYUN_ACCESS_KEY_ID;
  const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET || process.env.ALIYUN_ACCESS_KEY_SECRET;
  const bucket = process.env.OSS_BUCKET || new URL(baseUrl).hostname.split('.')[0];
  const configuredEndpoint = (process.env.OSS_ENDPOINT || new URL(baseUrl).hostname).replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const endpointHost = configuredEndpoint.startsWith(`${bucket}.`) ? configuredEndpoint : `${bucket}.${configuredEndpoint}`;
  const endpoint = `https://${endpointHost}`;

  if (!accessKeyId || !accessKeySecret) {
    throw new Error('Missing OSS_ACCESS_KEY_ID/OSS_ACCESS_KEY_SECRET for OSS upload');
  }

  return { accessKeyId, accessKeySecret, bucket, endpoint };
}

function signOssPut({ method, contentMd5, contentType, date, objectKey, bucket, accessKeyId, accessKeySecret }) {
  const canonicalResource = `/${bucket}/${objectKey}`;
  const stringToSign = [method, contentMd5, contentType, date, canonicalResource].join('\n');
  const signature = crypto.createHmac('sha1', accessKeySecret).update(stringToSign).digest('base64');
  return `OSS ${accessKeyId}:${signature}`;
}

function putOssObject(objectKey, body, contentType) {
  const config = getOssConfig();
  const endpoint = new URL(config.endpoint);
  const date = new Date().toUTCString();
  const contentMd5 = md5Base64(body);
  const encodedKey = encodeObjectPath(objectKey);
  const authorization = signOssPut({
    method: 'PUT',
    contentMd5,
    contentType,
    date,
    objectKey,
    bucket: config.bucket,
    accessKeyId: config.accessKeyId,
    accessKeySecret: config.accessKeySecret,
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      method: 'PUT',
      hostname: endpoint.hostname,
      path: `/${encodedKey}`,
      headers: {
        Authorization: authorization,
        Date: date,
        'Content-Type': contentType,
        'Content-MD5': contentMd5,
        'Content-Length': body.length,
        'Cache-Control': objectKey.endsWith('latest.yml') ? 'no-cache, max-age=0' : 'public, max-age=31536000, immutable',
      },
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ statusCode: res.statusCode, etag: res.headers.etag });
        } else {
          reject(new Error(`OSS PUT ${objectKey} failed: ${res.statusCode} ${text}`));
        }
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}

async function main() {
  const installer = findInstaller();
  if (!installer) {
    throw new Error(`Windows installer for version ${packageJson.version} was not found in ${distDir}`);
  }

  const installerObjectKey = [objectPrefix, installer.name].filter(Boolean).join('/');
  const feedObjectKey = [objectPrefix, 'latest.yml'].filter(Boolean).join('/');
  const installerUrl = `${baseUrl}/${encodeObjectPath(installer.name)}`;
  const feedUrl = `${baseUrl}/latest.yml`;
  const sha512 = process.env.INSTALLER_SHA512 || sha512File(installer.path);
  const size = fs.statSync(installer.path).size;
  const latest = buildLatestYml(installer, sha512, size);
  const latestPath = path.join(distDir, 'latest.yml');

  if (writeFeed) {
    fs.writeFileSync(latestPath, latest, 'utf8');
  }

  const upload = [];
  if (!skipUpload) {
    upload.push({
      key: installerObjectKey,
      result: await putOssObject(installerObjectKey, fs.readFileSync(installer.path), 'application/vnd.microsoft.portable-executable'),
    });
    upload.push({
      key: feedObjectKey,
      result: await putOssObject(feedObjectKey, Buffer.from(latest, 'utf8'), 'text/yaml; charset=utf-8'),
    });
  }

  console.log(JSON.stringify({
    version: packageJson.version,
    dry_run: dryRun,
    wrote_feed: writeFeed,
    skipped_upload: skipUpload,
    installer: {
      file: installer.name,
      size,
      sha512,
      oss_key: installerObjectKey,
      oss_url: installerUrl,
    },
    latest_yml: {
      file: 'latest.yml',
      path: latestPath,
      oss_key: feedObjectKey,
      oss_url: feedUrl,
      content: latest,
    },
    upload,
  }, null, 2));
}

main().catch(err => {
  console.error(err.message);
  process.exitCode = 1;
});
