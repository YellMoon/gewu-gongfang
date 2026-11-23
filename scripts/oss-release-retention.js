const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

function xmlValue(xml, name) {
  return xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1]
    ?.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function versionOf(key, prefix) {
  const relative = key.slice(prefix.length + 1);
  if (relative.startsWith('releases/')) {
    return /^releases\/(\d+\.\d+\.\d+)\/(?:latest\.yml|[^/]+\.exe(?:\.blockmap)?)$/.exec(relative)?.[1];
  }
  return /^[^/]*?(\d+\.\d+\.\d+)[^/]*\.exe(?:\.blockmap)?$/.exec(relative)?.[1];
}

function compareVersions(first, second) {
  const left = first.split('.').map(Number);
  const right = second.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return right[index] - left[index];
  }
  return 0;
}

function createCleanupPlan({ objects, prefix, currentVersion, protectedKeys, now = Date.now(), keepVersions = 3, graceDays = 7 }) {
  if (!/^\d+\.\d+\.\d+$/.test(currentVersion) || !prefix || prefix.includes('..')) throw new Error('Invalid retention scope');
  if (!Number.isInteger(keepVersions) || keepVersions < 2 || !Number.isFinite(graceDays) || graceDays < 1) throw new Error('Invalid retention policy');
  const scoped = objects.filter(object => object.key.startsWith(`${prefix}/`));
  const versions = [...new Set(scoped.map(object => versionOf(object.key, prefix)).filter(Boolean))]
    .filter(version => compareVersions(version, currentVersion) >= 0).sort(compareVersions);
  const retained = new Set([currentVersion, ...versions.filter(version => version !== currentVersion).slice(0, keepVersions - 1)]);
  const byKey = new Map(scoped.map(object => [object.key, object]));
  const candidates = scoped.filter(object => {
    const version = versionOf(object.key, prefix);
    if (!version || protectedKeys.has(object.key)) return false;
    const relative = object.key.slice(prefix.length + 1);
    if (relative.startsWith('releases/') && /\.exe(?:\.blockmap)?$/.test(relative)) {
      const root = byKey.get(`${prefix}/${path.posix.basename(object.key)}`);
      if (root && root.etag === object.etag && root.bytes === object.bytes) return true;
    }
    const modified = Date.parse(object.modified);
    return !retained.has(version) && compareVersions(version, currentVersion) >= 0
      && Number.isFinite(modified) && now - modified >= graceDays * 86400000;
  });
  return { currentVersion, keepVersions, graceDays, retainedVersions: [...retained], candidates,
    bytes: candidates.reduce((sum, object) => sum + object.bytes, 0) };
}

async function cleanupReleases({ request, prefix, apply = false, auditDir, now = Date.now() }) {
  const feedKey = `${prefix}/latest.yml`;
  const feed = await request('GET', feedKey);
  const current = yaml.load(feed.body.toString('utf8'));
  const objects = [];
  let marker = '';
  do {
    const query = new URLSearchParams({ prefix: `${prefix}/`, 'max-keys': '1000', ...(marker ? { marker } : {}) });
    const response = await request('GET', '', query.toString());
    const xml = response.body.toString('utf8');
    for (const match of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      objects.push({ key: xmlValue(match[1], 'Key'), bytes: Number(xmlValue(match[1], 'Size')),
        etag: xmlValue(match[1], 'ETag'), modified: xmlValue(match[1], 'LastModified') });
    }
    const next = xmlValue(xml, 'NextMarker');
    if (xmlValue(xml, 'IsTruncated') === 'true' && (!next || next === marker)) throw new Error('Incomplete OSS inventory');
    marker = xmlValue(xml, 'IsTruncated') === 'true' ? next : '';
  } while (marker);
  const protectedKeys = new Set([feedKey]);
  const protectFeed = async (content) => {
    if (!Array.isArray(content.files) || !content.files.length) throw new Error('Invalid update feed');
    for (const file of content.files) {
      const url = new URL(file.url, `https://retention.invalid/${prefix}/`);
      if (url.origin !== 'https://retention.invalid') throw new Error('External installer reference requires manual review');
      const key = decodeURIComponent(url.pathname.slice(1));
      if (!key.startsWith(`${prefix}/`) || key.includes('..')) throw new Error('Invalid installer reference');
      const artifact = await request('HEAD', key);
      if (Number(artifact.headers['content-length']) !== Number(file.size)) throw new Error(`Installer size mismatch: ${key}`);
      protectedKeys.add(key);
      protectedKeys.add(`${key}.blockmap`);
    }
  };
  await protectFeed(current);
  let plan = createCleanupPlan({ objects, prefix, currentVersion: current.version, protectedKeys, now });
  for (const version of plan.retainedVersions) {
    const key = `${prefix}/releases/${version}/latest.yml`;
    if (objects.some(object => object.key === key)) {
      const archived = yaml.load((await request('GET', key)).body.toString('utf8'));
      if (archived.version !== version) throw new Error(`Archived version mismatch: ${version}`);
      await protectFeed(archived);
      protectedKeys.add(key);
    }
  }
  plan = createCleanupPlan({ objects, prefix, currentVersion: current.version, protectedKeys, now });
  const report = { ...plan, applied: apply, inventoryBytes: objects.reduce((sum, object) => sum + object.bytes, 0), deleted: [] };
  if (!apply) return report;
  fs.mkdirSync(auditDir, { recursive: true });
  const auditPath = path.join(auditDir, `oss-retention-${new Date(now).toISOString().replace(/[:.]/g, '-')}.json`);
  const save = () => fs.writeFileSync(auditPath, JSON.stringify({ ...report, inventory: objects }, null, 2), 'utf8');
  save();
  try {
    for (const object of plan.candidates) {
      const latest = await request('GET', feedKey);
      if (!latest.body.equals(feed.body)) throw new Error('Update feed changed during cleanup');
      const head = await request('HEAD', object.key);
      if (head.headers.etag !== object.etag || Number(head.headers['content-length']) !== object.bytes
        || Date.parse(head.headers['last-modified']) !== Date.parse(object.modified)) throw new Error(`Object changed during cleanup: ${object.key}`);
      await request('DELETE', object.key);
      report.deleted.push(object.key);
      save();
    }
    await protectFeed(current);
  } catch (error) {
    report.error = error.message;
    save();
    throw error;
  }
  report.auditPath = auditPath;
  save();
  return report;
}

module.exports = { createCleanupPlan, cleanupReleases, xmlValue };
