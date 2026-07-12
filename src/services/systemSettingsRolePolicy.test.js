const assert = require('assert');
async function main() {
  const { systemSettingsRolePolicy } = await import('./systemSettingsRolePolicy.mjs');
  assert.deepStrictEqual(systemSettingsRolePolicy('desktop-client'), {
    isPrimaryHost: false, loadQuestionBankStorage: false, loadBackupTargets: false,
    loadBackupJobs: false, showHostConfiguration: false, showDangerousDataManagement: false,
  });
  assert.ok(Object.values(systemSettingsRolePolicy('primary-host')).every(Boolean));
  console.log('system settings role policy tests passed');
}
main().catch(error => { console.error(error); process.exit(1); });
