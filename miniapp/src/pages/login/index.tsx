import { useRef, useState } from 'react';
import Taro, { useDidShow } from '@tarojs/taro';
import { View, Text, Button } from '@tarojs/components';
import { miniappCloudAuthApi } from '../../utils/api';
import { authSessionRuntime } from '../../utils/authSession';
import { accountSessionCleanupStorageKeys } from '../../utils/accountExperience';
import { clearPermissionCache } from '../../utils/permission';
import { clearBusinessCache, setBusinessCacheIdentity } from '../../utils/storage';
import { createAuthenticationEntryBoundary, createNormalSessionCommitter } from '../../utils/miniappApiSessionRuntime';
import { cloudSessionUser } from './cloudSessionIdentityRuntime';
import './index.scss';

function loginErrorMessage(code?: string, fallback?: string): string {
  const messages: Record<string, string> = {
    CLOUD_MINIAPP_IDENTITY_REJECTED: '\u5fae\u4fe1\u9a8c\u8bc1\u672a\u901a\u8fc7\uff0c\u8bf7\u91cd\u65b0\u6388\u6743\u540e\u518d\u8bd5',
    CLOUD_MINIAPP_IDENTITY_UNAVAILABLE: '\u4e91\u7aef\u767b\u5f55\u6682\u4e0d\u53ef\u7528\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5',
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

  const handleCloudLogin = async (phoneCode: string) => {
    if (typeof phoneCode !== 'string' || !phoneCode.trim()) {
      Taro.showToast({ title: '\u8bf7\u6388\u6743\u5fae\u4fe1\u624b\u673a\u53f7\u540e\u767b\u5f55', icon: 'none' });
      return;
    }
    if (loginBusyRef.current) return;
    loginBusyRef.current = true;
    setLoading(true);
    try {
      const loginBoundary = createAuthenticationEntryBoundary(authSessionRuntime);
      const wechatLogin = await loginBoundary.run(() => Taro.login());
      const loginCode = wechatLogin?.code;
      if (typeof loginCode !== 'string' || !loginCode.trim()) {
        Taro.showToast({ title: '\u6682\u65f6\u65e0\u6cd5\u767b\u5f55\uff0c\u8bf7\u91cd\u8bd5', icon: 'none' });
        return;
      }
      const response = await loginBoundary.run(() => miniappCloudAuthApi.login(loginCode, phoneCode));
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
      }
    } catch (error: any) {
      Taro.showToast({ title: loginErrorMessage(String(error?.code || ''), error?.errMsg || error?.message), icon: 'none' });
    } finally {
      setLoading(false);
      loginBusyRef.current = false;
    }
  };

  return <View className="login-page">
    <View className="login-brand">
      <View className="login-logo"><Text className="logo-text">{'\u683c'}</Text></View>
      <Text className="login-title">{'\u683c\u7269\u5de5\u574a'}</Text>
    </View>
    <View className="login-action">
      <Button className="wx-login-btn" openType="getPhoneNumber" onGetPhoneNumber={(event) => void handleCloudLogin(event?.detail?.code || '')} loading={loading} disabled={loading}>{'\u624b\u673a\u53f7\u5feb\u6377\u767b\u5f55'}</Button>
    </View>
    <View className="privacy-entry">
      <Text className="privacy-text">{'\u7ee7\u7eed\u5373\u8868\u793a\u4f60\u5df2\u9605\u8bfb'}</Text>
      <Text className="privacy-link" onClick={() => Taro.navigateTo({ url: '/pages/login/privacy' })}>{'\u300a\u9690\u79c1\u4fdd\u62a4\u6307\u5f15\u300b'}</Text>
    </View>
  </View>;
}
