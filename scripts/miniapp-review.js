const fs = require('fs');
const path = require('path');
const releaseMatrix = require('./release-matrix');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env.local') });

const ROOT_DIR = path.resolve(__dirname, '..');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function miniappAppid() {
  return readJson(path.join(ROOT_DIR, 'miniapp', 'project.config.json')).appid;
}

function requireWechatConfig() {
  const appid = process.env.WECHAT_APPID || miniappAppid();
  const secret = process.env.WECHAT_APPSECRET;
  if (!appid || !secret) throw new Error('WECHAT_APPID/WECHAT_APPSECRET are required');
  return { appid, secret };
}

async function getAccessToken() {
  const { appid, secret } = requireWechatConfig();
  const url = new URL('https://api.weixin.qq.com/cgi-bin/token');
  url.searchParams.set('grant_type', 'client_credential');
  url.searchParams.set('appid', appid);
  url.searchParams.set('secret', secret);
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  const payload = await res.json();
  if (!res.ok || payload.errcode || !payload.access_token) {
    throw new Error(`WECHAT_ACCESS_TOKEN_FAILED: ${payload.errmsg || res.status}`);
  }
  return payload.access_token;
}

async function wechatGet(endpoint, accessToken) {
  const url = new URL(`https://api.weixin.qq.com${endpoint}`);
  url.searchParams.set('access_token', accessToken);
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  const payload = await res.json();
  return payload;
}

async function wechatPost(endpoint, accessToken, body = {}) {
  const url = new URL(`https://api.weixin.qq.com${endpoint}`);
  url.searchParams.set('access_token', accessToken);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  const payload = await res.json();
  return payload;
}

function firstPage(pagePayload) {
  const pages = pagePayload.page_list || pagePayload.pageList || [];
  return pages.find(page => page === 'pages/index/index') || pages[0] || 'pages/index/index';
}

function firstCategory(categoryPayload) {
  const categories = categoryPayload.category_list || categoryPayload.categoryList || [];
  const category = categories[0] || {};
  return {
    first_class: category.first_class || category.firstClass || '',
    second_class: category.second_class || category.secondClass || '',
    first_id: category.first_id || category.firstId || 0,
    second_id: category.second_id || category.secondId || 0,
  };
}

function buildSubmitAuditPayload({ pagePayload, categoryPayload, tag = '教育,课程,题库', title = '格物工坊' }) {
  const page = firstPage(pagePayload || {});
  const category = firstCategory(categoryPayload || {});
  const item = {
    address: page,
    tag,
    title,
    ...category,
  };
  return { item_list: [item] };
}

function sanitize(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const copy = { ...payload };
  delete copy.access_token;
  return copy;
}

async function status() {
  const token = await getAccessToken();
  return sanitize(await wechatGet('/wxa/get_latest_auditstatus', token));
}

async function submitAudit(options = {}) {
  const token = await getAccessToken();
  const pagePayload = await wechatGet('/wxa/get_page', token);
  if (pagePayload.errcode) return { stage: 'get_page', ...sanitize(pagePayload) };
  const categoryPayload = await wechatGet('/wxa/get_category', token);
  if (categoryPayload.errcode) return { stage: 'get_category', ...sanitize(categoryPayload) };
  const body = buildSubmitAuditPayload({
    pagePayload,
    categoryPayload,
    tag: options.tag,
    title: options.title,
  });
  const result = await wechatPost('/wxa/submit_audit', token, body);
  return { request: body, response: sanitize(result) };
}

async function release() {
  const token = await getAccessToken();
  return sanitize(await wechatPost('/wxa/release', token, {}));
}

function recordProductionRelease({
  manifest,
  releaseResult,
  verifiedAt,
  evidence = 'WeChat production release API returned errcode 0',
} = {}) {
  if (!releaseResult || releaseResult.errcode !== 0) {
    const code = releaseResult?.errcode ?? 'unknown';
    throw new Error(`WECHAT_MINIAPP_PRODUCTION_RELEASE_FAILED: ${code}`);
  }
  return releaseMatrix.recordReceipt(manifest, {
    target: 'miniapp',
    version: manifest?.componentVersions?.miniapp,
    verifiedAt,
    evidence,
    releaseLevel: 'production',
  });
}

function recordProductionReleaseReceipt({
  rootDir = ROOT_DIR,
  manifestPath = releaseMatrix.defaultManifestPath(rootDir),
  releaseResult,
  verifiedAt,
} = {}) {
  const manifest = releaseMatrix.readManifest(manifestPath);
  const sourceVersions = releaseMatrix.assertSourceVersionMatrix(
    releaseMatrix.readSourceVersionMatrix({ rootDir }),
  );
  if (sourceVersions.miniapp !== manifest.componentVersions?.miniapp) {
    throw new Error('Miniapp source version does not match the release compatibility matrix');
  }
  recordProductionRelease({ manifest, releaseResult, verifiedAt });
  releaseMatrix.writeManifest(manifestPath, manifest);
  return manifest;
}

async function main() {
  const command = process.argv[2] || 'status';
  let result;
  if (command === 'status') result = await status();
  else if (command === 'submit') result = await submitAudit();
  else if (command === 'release') {
    result = await release();
    recordProductionReleaseReceipt({ releaseResult: result });
  }
  else throw new Error(`unknown command: ${command}`);
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch(error => {
    console.error(error?.message || error);
    process.exit(1);
  });
}

module.exports = {
  buildSubmitAuditPayload,
  firstCategory,
  firstPage,
  recordProductionRelease,
  recordProductionReleaseReceipt,
};
