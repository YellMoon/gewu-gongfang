'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { createDesktopIdentityVault } = require('../public/desktopIdentityVault');

function assert(condition, code) {
  if (!condition) throw new Error(code);
}

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok || body?.success === false) {
    const error = new Error(body?.code || body?.error || `HTTP_${response.status}`);
    error.code = body?.code || 'LIVE_PAIRING_SMOKE_REQUEST_FAILED';
    error.statusCode = response.status;
    throw error;
  }
  return body;
}

function invalidButWellFormedCode(pairingCode) {
  const normalized = String(pairingCode || '').replace(/[\s-]+/g, '').toUpperCase();
  assert(/^[0-9A-HJKMNP-TV-Z]{16}$/.test(normalized), 'LIVE_PAIRING_SMOKE_GRANT_INVALID');
  return `${normalized[0] === '0' ? '1' : '0'}${normalized.slice(1)}`;
}

async function main() {
  assert(process.env.GEWU_LIVE_PAIRING_SMOKE === '1', 'LIVE_PAIRING_SMOKE_CONFIRMATION_REQUIRED');
  const configPath = path.join(process.env.APPDATA || '', 'gewu-gongfang', 'gewugongfang.config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const hostBaseUrl = normalizeBaseUrl(config.hostBaseUrl);
  const cloudBaseUrl = normalizeBaseUrl(config.cloudBaseUrl);
  const cdpUrl = normalizeBaseUrl(process.env.GEWU_LIVE_PAIRING_CDP_URL);
  const host = new URL(hostBaseUrl);
  assert(['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host.hostname), 'LIVE_PAIRING_SMOKE_HOST_NOT_LOCAL');
  assert(/^https:\/\//i.test(cloudBaseUrl), 'LIVE_PAIRING_SMOKE_CLOUD_URL_INVALID');
  assert(/^http:\/\/127\.0\.0\.1:\d+$/i.test(cdpUrl), 'LIVE_PAIRING_SMOKE_CDP_URL_INVALID');
  assert(config.desktopSyncToken, 'LIVE_PAIRING_SMOKE_HOST_TOKEN_MISSING');

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-live-cloud-pairing-'));
  const vaultPath = path.join(tempRoot, 'identity.bin');
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(value, 'utf8'),
    decryptString: value => Buffer.from(value).toString('utf8'),
  };
  let grant = null;
  let browser = null;
  let page = null;
  let requestReachedHost = false;
  let callbackReachedGateway = false;
  let grantRevoked = false;
  try {
    browser = await chromium.connectOverCDP(cdpUrl);
    page = browser.contexts().flatMap(context => context.pages())[0] || null;
    assert(page, 'LIVE_PAIRING_SMOKE_RENDERER_MISSING');
    const issued = await page.evaluate(async () => {
      if (!window.singleUserRuntime?.issuePairingCode) throw new Error('LIVE_PAIRING_SMOKE_BRIDGE_MISSING');
      return window.singleUserRuntime.issuePairingCode();
    });
    grant = issued.grant;
    assert(grant?.id && grant?.code, 'LIVE_PAIRING_SMOKE_GRANT_MISSING');

    const hostHeaders = {
      'Content-Type': 'application/json',
      'x-gewu-desktop-sync-token': config.desktopSyncToken,
    };
    const heartbeat = await jsonRequest(`${hostBaseUrl}/api/cloud-relay-host/heartbeat`, {
      method: 'POST',
      headers: hostHeaders,
      body: '{}',
    });
    assert(heartbeat?.pairingCapability?.success !== false, 'LIVE_PAIRING_SMOKE_CAPABILITY_NOT_PUBLISHED');

    const {
      discoverPairingCapability,
      pollPairingResult,
      submitPairingRequest,
    } = await import('../src/services/singleUserPairingClient.mjs');
    const discovery = await discoverPairingCapability({
      lanBaseUrl: '',
      cloudBaseUrl,
    });
    assert(discovery.channel === 'cloud', 'LIVE_PAIRING_SMOKE_DID_NOT_USE_CLOUD');

    const vault = createDesktopIdentityVault({ filePath: vaultPath, safeStorage });
    vault.beginSingleUserEnrollment({
      deviceId: `codex_pairing_smoke_${crypto.randomUUID().replace(/-/g, '')}`,
      deviceName: 'Codex cloud pairing route smoke',
      deviceKind: 'desktop-client',
    });
    const envelope = vault.createPairingEnvelope({
      capability: discovery.capability,
      pairingCode: invalidButWellFormedCode(grant.code),
    });
    const pending = await submitPairingRequest({ discovery, envelope });

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const processed = await jsonRequest(`${hostBaseUrl}/api/cloud-relay-host/tasks/process`, {
        method: 'POST',
        headers: hostHeaders,
        body: '{}',
      });
      if (Number(processed.processed || 0) > 0) requestReachedHost = true;
      try {
        const state = await pollPairingResult({ pending });
        if (state.status === 'completed') throw new Error('LIVE_PAIRING_SMOKE_UNEXPECTED_AUTHORIZATION');
      } catch (error) {
        if (error?.code === 'PAIRING_CODE_INVALID') {
          callbackReachedGateway = true;
          break;
        }
        if (!['PAIRING_REQUEST_CONTEXT_REQUIRED', 'PAIRING_RESPONSE_INVALID'].includes(error?.code)) throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert(requestReachedHost, 'LIVE_PAIRING_SMOKE_HOST_DID_NOT_CLAIM');
    assert(callbackReachedGateway, 'LIVE_PAIRING_SMOKE_GATEWAY_CALLBACK_MISSING');
  } finally {
    if (grant?.id) {
      try {
        await page?.evaluate(
          grantId => window.singleUserRuntime.revokePairingCode({ grantId }),
          grant.id
        );
        grantRevoked = true;
      } catch (_error) {
        grantRevoked = false;
      }
    }
    await browser?.close().catch(() => {});
    const resolvedTempRoot = path.resolve(tempRoot);
    assert(resolvedTempRoot.startsWith(path.resolve(os.tmpdir()) + path.sep), 'LIVE_PAIRING_SMOKE_TEMP_SCOPE_INVALID');
    fs.rmSync(resolvedTempRoot, { recursive: true, force: true });
  }
  assert(grantRevoked, 'LIVE_PAIRING_SMOKE_GRANT_REVOKE_FAILED');
  console.log(JSON.stringify({
    success: true,
    cloudCapabilityPublished: true,
    requestReachedHost,
    callbackReachedGateway,
    authorizationCreated: false,
    grantRevoked,
    secretsRecorded: false,
  }));
}

main().catch(error => {
  console.error(String(error?.code || error?.message || error));
  process.exitCode = 1;
});
