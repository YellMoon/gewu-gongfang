export const DEFAULT_MANAGED_CLOUD_BASE_URL = 'https://physicsedu.xyz/cloud-business';

export function resolveManagedSyncConfig(config = {}, env = {}) {
  const isHost = config.nodeRole === 'primary-host';
  const managedCloudBaseUrl = String(env.managedCloudBaseUrl || config.managedCloudBaseUrl || DEFAULT_MANAGED_CLOUD_BASE_URL).replace(/\/+$/, '');
  return {
    ...config,
    cloudBaseUrl: isHost ? String(config.cloudBaseUrl || managedCloudBaseUrl).replace(/\/+$/, '') : managedCloudBaseUrl,
    managedCloudBaseUrl,
    configurationManaged: !isHost,
  };
}

export function resolveDesktopIdentityBaseUrl(config = {}, env = {}) {
  const managed = resolveManagedSyncConfig(config, env);
  return String(managed.cloudBaseUrl || '').replace(/\/+$/, '');
}

export function syncFailureMessage(code) {
  return ({
    AUTHORIZATION_CONTEXT_REQUIRED: '当前设备尚未获得同步授权，请等待管理员批准。',
    PAIRING_NOT_APPROVED: '当前设备仍在等待管理员批准。',
    USER_NOT_APPROVED: '绑定账号当前不可用，请联系管理员。',
    DEVICE_CREDENTIAL_REVOKED: '当前设备授权已被撤销，请重新申请。',
    CLOUD_UNREACHABLE: '暂时无法连接同步服务，本机更改已保留，请稍后重试。',
    NO_SYNC_TRANSPORT_AVAILABLE: '未找到可用同步通道，本机更改已保留。',
  })[code] || '同步未完成，本机更改已保留，请稍后重试。';
}
