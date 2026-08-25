export const DEFAULT_MANAGED_CLOUD_BASE_URL = 'https://physicsedu.xyz/scheduling';
export const DEFAULT_CLOUD_BUSINESS_IDENTITY_BASE_URL = 'https://physicsedu.xyz/cloud-business';

export function resolveManagedSyncConfig(config = {}, env = {}) {
  const managedCloudBaseUrl = String(env.managedCloudBaseUrl || config.managedCloudBaseUrl || DEFAULT_MANAGED_CLOUD_BASE_URL).replace(/\/+$/, '');
  return {
    ...config,
    cloudBaseUrl: managedCloudBaseUrl,
    managedCloudBaseUrl,
    configurationManaged: true,
  };
}

export function resolveDesktopIdentityBaseUrl(config = {}, env = {}) {
  return String(env.cloudBusinessIdentityBaseUrl || config.cloudBusinessIdentityBaseUrl || DEFAULT_CLOUD_BUSINESS_IDENTITY_BASE_URL).replace(/\/+$/, '');
}

export function syncFailureMessage(code) {
  return ({
    AUTHORIZATION_CONTEXT_REQUIRED: '当前登录会话未完成，请联网后重新登录。',
    PAIRING_NOT_APPROVED: '此设备登录会话未完成，请重新登录。',
    USER_NOT_APPROVED: '账号当前不可用，请重新登录或联系支持人员。',
    DEVICE_CREDENTIAL_REVOKED: '此设备登录已失效，请重新登录。',
    CLOUD_UNREACHABLE: '暂时无法连接同步服务，本机更改已保留，请稍后重试。',
    NO_SYNC_TRANSPORT_AVAILABLE: '未找到可用同步通道，本机更改已保留。',
  })[code] || '同步未完成，本机更改已保留，请稍后重试。';
}
