const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');
const { URL } = require('url');
const { retryTransientNetwork } = require('./oss-upload-retry');
const releaseMatrix = require('./release-matrix');

try {
  const dotenv = require('dotenv');
  const envFiles = [
    process.env.OSS_ENV_FILE,
    path.join(__dirname, '..', '.env.local'),
    path.join(__dirname, '..', '.env'),
  ].filter(Boolean);

  for (const envFile of envFiles) {
    if (fs.existsSync(envFile)) {
      dotenv.config({ path: envFile, override: false });
    }
  }
} catch {
  // dotenv is optional for this script; real environment variables still work.
}

const packageJson = require('../package.json');

const distDir = path.resolve(process.env.DIST_DIR || path.join(__dirname, '..', 'dist'));
const baseUrl = (process.env.OSS_CDN_BASE_URL || 'https://gewu-staging-edu.oss-cn-beijing.aliyuncs.com/desktop').replace(/\/+$/, '');
const objectPrefix = (process.env.OSS_OBJECT_PREFIX || 'desktop').replace(/^\/+|\/+$/g, '');
const releasePrefix = (process.env.OSS_RELEASES_PREFIX || [objectPrefix, 'releases'].filter(Boolean).join('/')).replace(/^\/+|\/+$/g, '');
const dryRun = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';
const writeFeed = process.argv.includes('--write-feed') || process.env.WRITE_FEED === '1' || !dryRun;
const skipUpload = process.argv.includes('--skip-upload') || process.env.SKIP_UPLOAD === '1' || dryRun;
const releaseTarget = process.env.RELEASE_MATRIX_TARGET || 'desktop';
const recordReleaseReceipt = process.env.RELEASE_MATRIX_RECORD !== '0';

function getArgValue(name) {
  const prefix = `--${name}=`;
  const exact = `--${name}`;
  for (let index = 2; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg.startsWith(prefix)) {
      return arg.slice(prefix.length);
    }
    if (arg === exact) {
      const next = process.argv[index + 1];
      return next && !next.startsWith('--') ? next : '';
    }
  }
  return '';
}

function encodeObjectPath(value) {
  return value.split('/').map(encodeURIComponent).join('/');
}

function objectKey(...parts) {
  return parts.filter(Boolean).join('/');
}

function objectUrl(key) {
  let relative = key;
  if (objectPrefix && key.startsWith(`${objectPrefix}/`)) {
    relative = key.slice(objectPrefix.length + 1);
  } else if (objectPrefix && key === objectPrefix) {
    relative = '';
  }
  return relative ? `${baseUrl}/${encodeObjectPath(relative)}` : baseUrl;
}

function sha512File(filePath) {
  return crypto.createHash('sha512').update(fs.readFileSync(filePath)).digest('base64');
}

function yamlString(value) {
  return JSON.stringify(String(value));
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
  return [
    `version: ${packageJson.version}`,
    'files:',
    `  - url: ${yamlString(installer.name)}`,
    `    sha512: ${sha512}`,
    `    size: ${size}`,
    `path: ${yamlString(installer.name)}`,
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

function getHttpsText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(text);
        } else {
          reject(new Error(`GET ${url} failed: ${res.statusCode} ${text}`));
        }
      });
    }).on('error', reject);
  });
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

function createUploadPlan(items) {
  return items.map(item => ({
    key: item.key,
    content_type: item.contentType,
    bytes: item.body.length,
  }));
}

async function runUploadPlan(items) {
  const upload = [];
  if (skipUpload) {
    return upload;
  }

  for (const item of items) {
    upload.push({
      key: item.key,
      result: await retryTransientNetwork(() => putOssObject(item.key, item.body, item.contentType), {
        retries: Number(process.env.OSS_UPLOAD_RETRIES || 2),
        delayMs: Number(process.env.OSS_UPLOAD_RETRY_DELAY_MS || 2000),
      }),
    });
  }
  return upload;
}

async function publishRelease() {
  const releaseRoot = path.resolve(__dirname, '..');
  const release = dryRun
    ? null
    : recordReleaseReceipt
      ? releaseMatrix.assertReleaseTarget({
        rootDir: releaseRoot,
        target: releaseTarget,
        requestedVersion: packageJson.version,
      })
      : releaseMatrix.assertDesktopReleasePrerequisites({
        rootDir: releaseRoot,
        requestedVersion: packageJson.version,
      });
  if (!dryRun && recordReleaseReceipt) {
    releaseMatrix.assertDesktopReleasePrerequisites({
      rootDir: releaseRoot,
      requestedVersion: packageJson.version,
    });
  }
  const installer = findInstaller();
  if (!installer) {
    throw new Error(`Windows installer for version ${packageJson.version} was not found in ${distDir}`);
  }

  const installerObjectKey = objectKey(objectPrefix, installer.name);
  const feedObjectKey = objectKey(objectPrefix, 'latest.yml');
  const archiveInstallerObjectKey = objectKey(releasePrefix, packageJson.version, installer.name);
  const archiveFeedObjectKey = objectKey(releasePrefix, packageJson.version, 'latest.yml');
  const sha512 = process.env.INSTALLER_SHA512 || sha512File(installer.path);
  const size = fs.statSync(installer.path).size;
  const latest = buildLatestYml(installer, sha512, size);
  const latestPath = path.join(distDir, 'latest.yml');
  const archiveLatestPath = path.join(distDir, 'releases', packageJson.version, 'latest.yml');

  if (writeFeed) {
    fs.mkdirSync(path.dirname(archiveLatestPath), { recursive: true });
    fs.writeFileSync(latestPath, latest, 'utf8');
    fs.writeFileSync(archiveLatestPath, latest, 'utf8');
  }

  const installerBody = fs.readFileSync(installer.path);
  const latestBody = Buffer.from(latest, 'utf8');
  const uploadItems = [
    {
      key: installerObjectKey,
      body: installerBody,
      contentType: 'application/vnd.microsoft.portable-executable',
    },
    {
      key: archiveInstallerObjectKey,
      body: installerBody,
      contentType: 'application/vnd.microsoft.portable-executable',
    },
    {
      key: archiveFeedObjectKey,
      body: latestBody,
      contentType: 'text/yaml; charset=utf-8',
    },
    {
      key: feedObjectKey,
      body: latestBody,
      contentType: 'text/yaml; charset=utf-8',
    },
  ];
  const upload = await runUploadPlan(uploadItems);
  if (release && !skipUpload && recordReleaseReceipt) {
    releaseMatrix.recordReceipt(release.manifest, {
      target: releaseTarget,
      version: packageJson.version,
      evidence: `OSS latest.yml and installer upload: ${objectUrl(feedObjectKey)}`,
    });
    releaseMatrix.writeManifest(release.manifestPath, release.manifest);
  }

  console.log(JSON.stringify({
    mode: 'publish',
    version: packageJson.version,
    dry_run: dryRun,
    wrote_feed: writeFeed,
    skipped_upload: skipUpload,
    planned_upload: createUploadPlan(uploadItems),
    installer: {
      file: installer.name,
      size,
      sha512,
      oss_key: installerObjectKey,
      oss_url: objectUrl(installerObjectKey),
    },
    release_archive: {
      installer: {
        file: installer.name,
        oss_key: archiveInstallerObjectKey,
        oss_url: objectUrl(archiveInstallerObjectKey),
      },
      latest_yml: {
        file: 'latest.yml',
        path: archiveLatestPath,
        oss_key: archiveFeedObjectKey,
        oss_url: objectUrl(archiveFeedObjectKey),
      },
    },
    latest_yml: {
      file: 'latest.yml',
      path: latestPath,
      oss_key: feedObjectKey,
      oss_url: objectUrl(feedObjectKey),
      content: latest,
    },
    upload,
  }, null, 2));
}

async function rollbackRelease(version) {
  if (!version) {
    throw new Error('Missing rollback version. Use --rollback=5.0.38 or ROLLBACK_TO_VERSION=5.0.38');
  }

  const archiveFeedObjectKey = objectKey(releasePrefix, version, 'latest.yml');
  const feedObjectKey = objectKey(objectPrefix, 'latest.yml');
  const sourceUrl = objectUrl(archiveFeedObjectKey);
  const localRollbackFeed = process.env.ROLLBACK_FEED_PATH;
  const latest = localRollbackFeed
    ? fs.readFileSync(localRollbackFeed, 'utf8')
    : await getHttpsText(sourceUrl);
  const versionPattern = new RegExp(`(^|\\n)version:\\s*${version.replace(/\./g, '\\.')}(\\s|\\n|$)`);

  if (!versionPattern.test(latest)) {
    throw new Error(`Archived feed does not look like version ${version}`);
  }

  const latestPath = path.join(distDir, 'latest.yml');
  if (writeFeed) {
    fs.mkdirSync(path.dirname(latestPath), { recursive: true });
    fs.writeFileSync(latestPath, latest, 'utf8');
  }

  const uploadItems = [{
    key: feedObjectKey,
    body: Buffer.from(latest, 'utf8'),
    contentType: 'text/yaml; charset=utf-8',
  }];
  const upload = await runUploadPlan(uploadItems);

  console.log(JSON.stringify({
    mode: 'rollback',
    version: packageJson.version,
    dry_run: dryRun,
    wrote_feed: writeFeed,
    skipped_upload: skipUpload,
    planned_upload: createUploadPlan(uploadItems),
    rollback: {
      version,
      source: {
        file: 'latest.yml',
        path: localRollbackFeed || null,
        oss_key: archiveFeedObjectKey,
        oss_url: sourceUrl,
      },
    },
    latest_yml: {
      file: 'latest.yml',
      path: latestPath,
      oss_key: feedObjectKey,
      oss_url: objectUrl(feedObjectKey),
      content: latest,
    },
    upload,
  }, null, 2));
}

async function main() {
  const rollbackArgPresent = process.argv.slice(2).some(arg => (
    arg === '--rollback'
    || arg.startsWith('--rollback=')
    || arg === '--rollback-to'
    || arg.startsWith('--rollback-to=')
  ));
  const rollbackVersion = getArgValue('rollback') || getArgValue('rollback-to') || process.env.ROLLBACK_TO_VERSION || process.env.ROLLBACK_VERSION;
  if (rollbackArgPresent || process.env.ROLLBACK_TO_VERSION || process.env.ROLLBACK_VERSION) {
    await rollbackRelease(rollbackVersion);
    return;
  }
  await publishRelease();
}

main().catch(err => {
  console.error(err.message);
  process.exitCode = 1;
});
