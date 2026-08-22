import { useRef, useState } from 'react';
import Taro, { useDidShow } from '@tarojs/taro';
import { View, Text, Button } from '@tarojs/components';
import { api } from '../../utils/api';
import { authSessionRuntime } from '../../utils/authSession';
import { accountSessionCleanupStorageKeys } from '../../utils/accountExperience';
import { clearPermissionCache } from '../../utils/permission';
import { clearBusinessCache, setBusinessCacheIdentity } from '../../utils/storage';
import { createAuthenticationEntryBoundary, createNormalSessionCommitter } from '../../utils/miniappApiSessionRuntime';
import './index.scss';

function cloudSessionUser(identity: any): any | null {
  if (!identity || typeof identity.accountId !== 'string' || !identity.accountId || !Array.isArray(identity.roles)
    || !['active', 'pending_authorization'].includes(identity.status)) return null;
  const role = identity.roles.includes('super_admin') ? 'super_admin'
    : identity.roles.includes('admin') ? 'admin'
      : identity.roles.includes('teacher') ? 'teacher'
        : identity.roles.includes('student') ? 'student' : 'pending';
  return {
    id: identity.accountId,
    cloud_account_id: identity.accountId,
    role,
    user_type: role,
    account_state: identity.status === 'pending_authorization' ? 'pending' : 'formal',
    token_use: 'miniapp-cloud',
  };
}

function loginErrorMessage(code?: string, fallback?: string): string {
  const messages: Record<string, string> = {
    CLOUD_MINIAPP_IDENTITY_REJECTED: '\u5fae\u4fe1\u9a8c\u8bc1\u672a\u901a\u8fc7\uff0c\u8bf7\u91cd\u65b0\u6388\u6743\u540e\u518d\u8bd5',
    CLOUD_MINIAPP_IDENTITY_UNAVAILABLE: '\u4e91\u7aef\u767b\u5f55\u6682\u4e0d\u53ef\u7528\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5',
    CLOUD_MINIAPP_ACCOUNT_PENDING: '\u8d26\u53f7\u5df2\u521b\u5efa\uff0c\u7b49\u5f85\u8d85\u7ea7\u7ba1\u7406\u5458\u6388\u4e88\u6743\u9650',
  };
  return messages[String(code || '')] || fallback || '\u767b\u5f55\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5';
}

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const loginBusyRef = useRef(false);
  const sessionCommitterRef = useRef<ReturnType<typeof createNormalSessionCommitter> | null>(null);

  if (!sessionCommitterRef.current) {
    sessionCommitterRef.current = createNormalSessionCommitter({
      readUser: () => Taro.getStorageSync('user_info'),
      clearBusinessCache,
      clearPermissionCache,
      removeStorage: (key: string) => Taro.removeStorageSync(key),
      cleanupStorageKeys: accountSessionCleanupStorageKeys,
      writeUser: (user: any) => Taro.setStorageSync('user_info', user),
      setBusinessCacheIdentity,
      invalidateAndAdvance: () => authSessionRuntime.invalidateAndAdvance(),
      writeToken: (token: string) => Taro.setStorageSync('auth_token', token),
      activateSession: () => authSessionRuntime.activate(),
      relaunch: () => Taro.reLaunch({ url: '/pages/index/index' }),
    });
  }

  useDidShow(() => {
    const session = authSessionRuntime.capture();
    if (session.token && session.identity) Taro.reLaunch({ url: '/pages/index/index' });
  });

  const handleCloudLogin = async (event: any) => {
    const phoneCode = event?.detail?.code;
    if (typeof phoneCode !== 'string' || !phoneCode.trim()) {
      Taro.showToast({ title: '\u8bf7\u6388\u6743\u5fae\u4fe1\u624b\u673a\u53f7\u540e\u767b\u5f55', icon: 'none' });
      return;
    }
    if (loginBusyRef.current) return;
    loginBusyRef.current = true;
    setLoading(true);
    try {
      const loginBoundary = createAuthenticationEntryBoundary(authSessionRuntime);
      const response = await loginBoundary.run(() => api.post<any>('/api/miniapp/cloud-login', { phoneCode }));
      const payload = response.success ? response.data : null;
      const user = cloudSessionUser(payload?.identity);
      if (!payload?.ok || typeof payload.token !== 'string' || !user) {
        Taro.showToast({ title: loginErrorMessage(String(response.code || ''), response.error), icon: 'none' });
        return;
      }
      loginBoundary.assertCurrent();
      const committed = await sessionCommitterRef.current?.commit({ token: payload.token, user });
      if (!committed?.success) {
        Taro.showToast({ title: '\u767b\u5f55\u72b6\u6001\u4fdd\u5b58\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5', icon: 'none' });
      } else if (payload.identity.status === 'pending_authorization') {
        Taro.showToast({ title: loginErrorMessage('CLOUD_MINIAPP_ACCOUNT_PENDING'), icon: 'none' });
      }
    } catch (error: any) {
      Taro.showToast({ title: loginErrorMessage(String(error?.code || ''), error?.errMsg || error?.message), icon: 'none' });
    } finally {
      setLoading(false);
      loginBusyRef.current = false;
    }
  };

  return <View className="login-page">
    <View className="login-header">
      <View className="login-logo"><Text className="logo-text">{'\u683c'}</Text></View>
      <Text className="login-title">{'\u683c\u7269\u5de5\u574a'}</Text>
    </View>
    <View className="login-form">
      <Text className="login-description">{'\u4f7f\u7528\u5fae\u4fe1\u624b\u673a\u53f7\u5b8c\u6210\u4e91\u7aef\u767b\u5f55\u3002\u65b0\u8d26\u53f7\u9700\u7b49\u5f85\u8d85\u7ea7\u7ba1\u7406\u5458\u6388\u4e88\u6743\u9650\u3002'}</Text>
      <Button className="wx-login-btn" openType="getPhoneNumber" onGetPhoneNumber={(event) => void handleCloudLogin(event)} loading={loading} disabled={loading}>{'\u7528\u5fae\u4fe1\u624b\u673a\u53f7\u767b\u5f55'}</Button>
    </View>
    <View className="privacy-entry">
      <Text className="privacy-text">{'\u767b\u5f55\u524d\u8bf7\u9605\u8bfb'}</Text>
      <Text className="privacy-link" onClick={() => Taro.navigateTo({ url: '/pages/login/privacy' })}>{'\u300a\u9690\u79c1\u4fdd\u62a4\u6307\u5f15\u300b'}</Text>
    </View>
  </View>;
}
