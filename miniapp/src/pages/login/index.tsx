import { useRef, useState } from 'react';
import Taro, { useDidShow } from '@tarojs/taro';
import { View, Text, Button } from '@tarojs/components';
import { api } from '../../utils/api';
import { authSessionRuntime } from '../../utils/authSession';
import { accountSessionCleanupStorageKeys, isUnrecognizedIdentity } from '../../utils/accountExperience';
import { clearPermissionCache } from '../../utils/permission';
import { clearBusinessCache, setBusinessCacheIdentity } from '../../utils/storage';
import { createAuthenticationEntryBoundary, createNormalSessionCommitter } from '../../utils/miniappApiSessionRuntime';
import './index.scss';

const FORMAL_HOME = '/pages/index/index';
const UNRECOGNIZED_HOME = '/pages/unrecognized-experience/index';

function homeForIdentity(identity: any): string {
  return isUnrecognizedIdentity(identity) ? UNRECOGNIZED_HOME : FORMAL_HOME;
}

function loginErrorMessage(code?: string, fallback?: string): string {
  const messages: Record<string, string> = {
    PHONE_VERIFICATION_REQUIRED: '请授权微信绑定手机号后登录',
    PHONE_AUTHORIZATION_REQUIRED: '请授权微信绑定手机号后登录',
    WECHAT_PHONE_EXCHANGE_FAILED: '手机号验证失败，请重新授权',
    PHONE_WECHAT_BINDING_CONFLICT: '该手机号已绑定另一个微信账号，请联系管理员核验',
    OPENID_PHONE_BINDING_CONFLICT: '该微信已绑定另一个手机号，请联系管理员核验',
    PHONE_IDENTITY_CONFLICT: '手机号或微信绑定信息冲突，请联系管理员核验',
    MINIAPP_LOGIN_DISABLED: '该账号已停用，请联系管理员',
    ACCOUNT_DISABLED: '该账号已停用，请联系管理员',
    AUTH_RATE_LIMITED: '操作频繁，请稍后再试',
  };
  return messages[String(code || '')] || fallback || '登录失败，请稍后重试';
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
      relaunch: (user: any) => Taro.reLaunch({ url: homeForIdentity(user) }),
    });
  }

  useDidShow(() => {
    const session = authSessionRuntime.capture();
    if (session.token && session.identity) {
      Taro.reLaunch({ url: homeForIdentity(session.identity) });
    }
  });

  const handlePhoneLogin = async (event: any) => {
    const phoneCode = String(event?.detail?.code || '').trim();
    if (!phoneCode) {
      Taro.showToast({ title: '需要授权手机号才能登录', icon: 'none' });
      return;
    }
    if (loginBusyRef.current) return;
    loginBusyRef.current = true;
    setLoading(true);
    try {
      const loginBoundary = createAuthenticationEntryBoundary(authSessionRuntime);
      const { code } = await loginBoundary.run(() => Taro.login());
      const response = await loginBoundary.run(() => api.post<any>('/api/auth/wechat-login', {
        code,
        phoneCode,
      }));
      if (!response.success || !response.data?.token || !response.data?.user) {
        Taro.showToast({ title: loginErrorMessage(String(response.code || ''), response.error), icon: 'none' });
        return;
      }

      const user = response.data.user;
      loginBoundary.assertCurrent();
      const committed = await sessionCommitterRef.current?.commit({ token: response.data.token, user });
      if (!committed?.success) {
        Taro.showToast({ title: '登录状态保存失败，请重试', icon: 'none' });
      }
    } catch (error: any) {
      Taro.showToast({
        title: loginErrorMessage(String(error?.code || ''), error?.errMsg || error?.message),
        icon: 'none',
      });
    } finally {
      setLoading(false);
      loginBusyRef.current = false;
    }
  };

  return <View className="login-page">
    <View className="login-header">
      <View className="login-logo"><Text className="logo-text">格</Text></View>
      <Text className="login-title">格物工坊</Text>
    </View>
    <View className="login-form">
      <Text className="login-description">使用微信绑定手机号核验身份。未建档学生可进入示例题体验并提交身份申请。</Text>
      <Button
        className="wx-login-btn"
        openType="getPhoneNumber"
        onGetPhoneNumber={handlePhoneLogin}
        loading={loading}
        disabled={loading}
      >验证手机号并登录</Button>
    </View>
    <View className="privacy-entry">
      <Text className="privacy-text">登录前请阅读</Text>
      <Text
        className="privacy-link"
        onClick={() => Taro.navigateTo({ url: '/pages/login/privacy' })}
      >《隐私保护指引》</Text>
    </View>
  </View>;
}
