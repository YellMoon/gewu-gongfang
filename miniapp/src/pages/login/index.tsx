import { useRef, useState } from 'react';
import Taro, { useDidShow, useRouter } from '@tarojs/taro';
import { View, Text, Button } from '@tarojs/components';
import { miniappCloudAuthApi } from '../../utils/api';
import { authSessionRuntime } from '../../utils/authSession';
import { accountSessionCleanupStorageKeys } from '../../utils/accountExperience';
import { clearPermissionCache } from '../../utils/permission';
import { clearBusinessCache, setBusinessCacheIdentity } from '../../utils/storage';
import { createAuthenticationEntryBoundary, createNormalSessionCommitter } from '../../utils/miniappApiSessionRuntime';
import { cloudSessionUser } from './cloudSessionIdentityRuntime';
import {
  desktopLoginConfirmationError,
  parseDesktopLoginConfirmationQuery,
} from './desktopLoginConfirmationRuntime';
import './index.scss';

function loginErrorMessage(code?: string, fallback?: string): string {
  const messages: Record<string, string> = {
    CLOUD_MINIAPP_IDENTITY_REJECTED: '\u5fae\u4fe1\u9a8c\u8bc1\u672a\u901a\u8fc7\uff0c\u8bf7\u91cd\u65b0\u6388\u6743\u540e\u518d\u8bd5',
    CLOUD_MINIAPP_IDENTITY_UNAVAILABLE: '\u4e91\u7aef\u767b\u5f55\u6682\u4e0d\u53ef\u7528\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5',
  };
  return messages[String(code || '')] || fallback || '\u767b\u5f55\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5';
}

export default function LoginPage() {
  const router = useRouter();
  const desktopLogin = parseDesktopLoginConfirmationQuery(router.params);
  const [loading, setLoading] = useState(false);
  const [desktopLoginState, setDesktopLoginState] = useState<'ready' | 'success' | 'error'>('ready');
  const [desktopLoginError, setDesktopLoginError] = useState('');
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
    if (desktopLogin) return;
    const session = authSessionRuntime.capture();
    if (session.token && session.identity) Taro.reLaunch({ url: '/pages/index/index' });
  });

  const handleDesktopLogin = async (phoneCode: string) => {
    if (!desktopLogin || typeof phoneCode !== 'string' || !phoneCode.trim()) {
      Taro.showToast({ title: '\u8bf7\u6388\u6743\u5fae\u4fe1\u624b\u673a\u53f7\u540e\u7ee7\u7eed', icon: 'none' });
      return;
    }
    if (loginBusyRef.current) return;
    loginBusyRef.current = true;
    setLoading(true);
    setDesktopLoginError('');
    try {
      const wechatLogin = await Taro.login();
      const loginCode = wechatLogin?.code;
      if (typeof loginCode !== 'string' || !loginCode.trim()) throw new Error('NETWORK_ERROR');
      const response = await miniappCloudAuthApi.confirmDesktopLogin(
        desktopLogin,
        loginCode,
        phoneCode,
      );
      if (!response.success || response.data?.status !== 'verified') {
        const error = Object.assign(new Error(response.error || 'NETWORK_ERROR'), { code: response.code });
        throw error;
      }
      setDesktopLoginState('success');
    } catch (error: any) {
      setDesktopLoginState('error');
      setDesktopLoginError(desktopLoginConfirmationError(String(error?.code || 'NETWORK_ERROR')));
    } finally {
      setLoading(false);
      loginBusyRef.current = false;
    }
  };

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

  if (desktopLogin) {
    return <View className="login-page">
      <View className="login-brand">
        <View className="login-logo"><Text className="logo-text">{'\u683c'}</Text></View>
        <Text className="login-title">{'\u683c\u7269\u5de5\u574a'}</Text>
      </View>
      <View className="desktop-login-card">
        {desktopLoginState === 'success' ? <>
          <Text className="desktop-login-title">{'\u5df2\u767b\u5f55'}</Text>
          <Text className="desktop-login-copy">{'\u53ef\u4ee5\u8fd4\u56de\u7535\u8111\u7ee7\u7eed\u4f7f\u7528\u3002'}</Text>
          <Button className="desktop-login-secondary" onClick={() => Taro.reLaunch({ url: '/pages/index/index' })}>{'\u5b8c\u6210'}</Button>
        </> : <>
          <Text className="desktop-login-title">{'\u5728\u7535\u8111\u4e0a\u767b\u5f55\u683c\u7269\u5de5\u574a'}</Text>
          <Text className="desktop-login-copy">{'\u5982\u679c\u4e0d\u662f\u4f60\u672c\u4eba\u64cd\u4f5c\uff0c\u8bf7\u53d6\u6d88\u3002'}</Text>
          {desktopLoginError ? <Text className="desktop-login-error">{desktopLoginError}</Text> : null}
          <Button className="wx-login-btn" openType="getPhoneNumber" onGetPhoneNumber={(event) => void handleDesktopLogin(event?.detail?.code || '')} loading={loading} disabled={loading}>{'\u786e\u8ba4\u767b\u5f55'}</Button>
          <Button className="desktop-login-secondary" disabled={loading} onClick={() => Taro.reLaunch({ url: '/pages/login/index' })}>{'\u53d6\u6d88'}</Button>
        </>}
      </View>
    </View>;
  }

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
