const assert = require('assert');
async function main() {
  const { resolveManagedSyncConfig, syncFailureMessage, DEFAULT_MANAGED_CLOUD_BASE_URL } = await import('./managedSyncConfig.mjs');
  const client = resolveManagedSyncConfig({ nodeRole: 'desktop-client', cloudBaseUrl: '', desktopSyncToken: '' });
  assert.strictEqual(client.cloudBaseUrl, DEFAULT_MANAGED_CLOUD_BASE_URL);
  assert.strictEqual(client.configurationManaged, true);
  assert.strictEqual(resolveManagedSyncConfig({ nodeRole: 'desktop-client', cloudBaseUrl: 'https://evil.example' }).cloudBaseUrl, DEFAULT_MANAGED_CLOUD_BASE_URL);
  assert.strictEqual(resolveManagedSyncConfig({ nodeRole: 'primary-host', cloudBaseUrl: 'https://host.example/' }).cloudBaseUrl, 'https://host.example');
  assert.ok(syncFailureMessage('CLOUD_UNREACHABLE').includes('无法连接'));
  assert.ok(syncFailureMessage('AUTHORIZATION_CONTEXT_REQUIRED').includes('管理员批准'));
  console.log('managed sync config tests passed');
}
main().catch(error => { console.error(error); process.exit(1); });
