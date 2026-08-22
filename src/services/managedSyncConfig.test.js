const assert = require('assert');
const fs = require('fs');
async function main() {
  const {
    resolveDesktopIdentityBaseUrl,
    resolveManagedSyncConfig,
    syncFailureMessage,
    DEFAULT_MANAGED_CLOUD_BASE_URL,
    DEFAULT_CLOUD_BUSINESS_IDENTITY_BASE_URL,
  } = await import('./managedSyncConfig.mjs');
  assert.strictEqual(
    DEFAULT_CLOUD_BUSINESS_IDENTITY_BASE_URL,
    'https://physicsedu.xyz/cloud-business',
    'new desktop registration must resolve the deployed cloud-business authority',
  );
  const client = resolveManagedSyncConfig({ nodeRole: 'desktop-client', cloudBaseUrl: '', desktopSyncToken: '' });
  assert.strictEqual(client.cloudBaseUrl, DEFAULT_MANAGED_CLOUD_BASE_URL);
  assert.strictEqual(client.configurationManaged, true);
  assert.strictEqual(resolveManagedSyncConfig({ nodeRole: 'desktop-client', cloudBaseUrl: 'https://evil.example' }).cloudBaseUrl, DEFAULT_MANAGED_CLOUD_BASE_URL);
  assert.strictEqual(resolveManagedSyncConfig({ nodeRole: 'primary-host', cloudBaseUrl: 'https://host.example/' }).cloudBaseUrl, 'https://host.example');
  assert.strictEqual(resolveDesktopIdentityBaseUrl({
    buildFlavor: 'primary-host',
    nodeRole: 'primary-host',
    desktopIdentityMode: 'full',
    hostBaseUrl: 'http://127.0.0.1:3001/',
    cloudBaseUrl: 'https://cloud.example/',
  }), DEFAULT_CLOUD_BUSINESS_IDENTITY_BASE_URL,
  'legacy primary-host configuration must not redirect new device identity registration to the retired control plane');
  assert.strictEqual(resolveDesktopIdentityBaseUrl({
    buildFlavor: 'desktop-client',
    nodeRole: 'desktop-client',
    hostBaseUrl: 'http://192.168.1.8:3001/',
  }), DEFAULT_CLOUD_BUSINESS_IDENTITY_BASE_URL,
  'ordinary desktops use cloud-business for new online identity registration');
  assert.ok(!/single-user|SingleUser/i.test(fs.readFileSync('src/services/managedSyncConfig.mjs', 'utf8')),
    'managed identity routing must not retain a legacy single-user bypass');
  assert.ok(syncFailureMessage('CLOUD_UNREACHABLE').includes('无法连接'));
  assert.ok(syncFailureMessage('AUTHORIZATION_CONTEXT_REQUIRED').includes('管理员批准'));
  console.log('managed sync config tests passed');
}
main().catch(error => { console.error(error); process.exit(1); });
