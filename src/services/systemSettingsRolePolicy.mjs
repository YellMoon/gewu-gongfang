export function systemSettingsRolePolicy(nodeRole) {
  const isPrimaryHost = nodeRole === 'primary-host';
  return {
    isPrimaryHost,
    loadQuestionBankStorage: isPrimaryHost,
    loadBackupTargets: isPrimaryHost,
    loadBackupJobs: isPrimaryHost,
    showHostConfiguration: isPrimaryHost,
    showDangerousDataManagement: isPrimaryHost,
  };
}
