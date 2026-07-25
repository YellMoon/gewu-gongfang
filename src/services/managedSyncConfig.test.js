const assert = require('assert');
async function main() {
  const {
    resolveDesktopIdentityBaseUrl,
    resolveManagedSyncConfig,
    syncFailureMessage,
    DEFAULT_MANAGED_CLOUD_BASE_URL,
  } = await import('./managedSyncConfig.mjs');
  const client = resolveManagedSyncConfig({ nodeRole: 'desktop-client', cloudBaseUrl: '', desktopSyncToken: '' });
  assert.strictEqual(client.cloudBaseUrl, DEFAULT_MANAGED_CLOUD_BASE_URL);
  assert.strictEqual(client.configurationManaged, true);
  assert.strictEqual(resolveManagedSyncConfig({ nodeRole: 'desktop-client', cloudBaseUrl: 'https://evil.example' }).cloudBaseUrl, DEFAULT_MANAGED_CLOUD_BASE_URL);
  assert.strictEqual(resolveManagedSyncConfig({ nodeRole: 'primary-host', cloudBaseUrl: 'https://host.example/' }).cloudBaseUrl, 'https://host.example');
  assert.strictEqual(resolveDesktopIdentityBaseUrl({
    buildFlavor: 'primary-host',
    nodeRole: 'primary-host',
    desktopIdentityMode: 'single-user',
    hostBaseUrl: 'http://127.0.0.1:3001/',
    cloudBaseUrl: 'https://cloud.example/',
  }), 'http://127.0.0.1:3001');
  assert.strictEqual(resolveDesktopIdentityBaseUrl({
    buildFlavor: 'primary-host',
    nodeRole: 'desktop-client',
    desktopIdentityMode: 'single-user',
    hostBaseUrl: 'http://127.0.0.1:3001/',
    cloudBaseUrl: 'https://cloud.example/',
  }), 'http://127.0.0.1:3001');
  assert.strictEqual(resolveDesktopIdentityBaseUrl({
    buildFlavor: 'desktop-client',
    nodeRole: 'desktop-client',
    desktopIdentityMode: 'single-user',
    hostBaseUrl: 'http://127.0.0.1:3001/',
    cloudBaseUrl: 'https://cloud.example/',
  }), DEFAULT_MANAGED_CLOUD_BASE_URL);
  assert.strictEqual(resolveDesktopIdentityBaseUrl({
    buildFlavor: 'primary-host',
    nodeRole: 'primary-host',
    desktopIdentityMode: 'full',
    hostBaseUrl: 'http://127.0.0.1:3001/',
    cloudBaseUrl: 'https://cloud.example/',
  }), 'https://cloud.example');
  assert.strictEqual(resolveDesktopIdentityBaseUrl({
    buildFlavor: 'primary-host',
    nodeRole: 'primary-host',
    desktopIdentityMode: 'single-user',
    cloudBaseUrl: 'https://cloud.example/',
  }), '', 'single-user host must fail closed when its trusted local identity endpoint is absent');
  assert.strictEqual(resolveDesktopIdentityBaseUrl({
    buildFlavor: 'desktop-client',
    nodeRole: 'desktop-client',
    hostBaseUrl: 'http://192.168.1.8:3001/',
  }, { authorizationSource: 'single_user_pairing' }), 'http://192.168.1.8:3001',
  'single-user paired clients must send identity requests to the LAN host that issued their session');
  assert.strictEqual(resolveDesktopIdentityBaseUrl({
    buildFlavor: 'desktop-client',
    nodeRole: 'desktop-client',
    hostBaseUrl: 'http://127.0.0.1:3001/',
  }, { authorizationSource: 'single_user_pairing' }), '',
  'a loopback host base points at the client itself; fail closed so the cloud relay path takes over');
  assert.strictEqual(resolveDesktopIdentityBaseUrl({
    buildFlavor: 'desktop-client',
    nodeRole: 'desktop-client',
    hostBaseUrl: 'http://192.168.1.8:3001/',
  }, { authorizationSource: 'wechat_phone' }), DEFAULT_MANAGED_CLOUD_BASE_URL,
  'fully registered clients keep using the managed cloud identity plane');
  assert.ok(syncFailureMessage('CLOUD_UNREACHABLE').includes('无法连接'));
  assert.ok(syncFailureMessage('AUTHORIZATION_CONTEXT_REQUIRED').includes('管理员批准'));
  console.log('managed sync config tests passed');
}
main().catch(error => { console.error(error); process.exit(1); });
