import { useRef, useState } from 'react';
import Taro, { useDidShow } from '@tarojs/taro';
import { View, Text, Button, Input } from '@tarojs/components';
import { api } from '../../utils/api';
import { authSessionRuntime } from '../../utils/authSession';
import { accountSessionCleanupStorageKeys, isUnrecognizedIdentity } from '../../utils/accountExperience';
import { clearPermissionCache } from '../../utils/permission';
import { clearBusinessCache, setBusinessCacheIdentity } from '../../utils/storage';
import { createAuthenticationEntryBoundary, createNormalSessionCommitter } from '../../utils/miniappApiSessionRuntime';
import { loginResultState, normalizeManualPhone, validateManualPhone } from './manualPhoneLoginRuntime';
import './index.scss';

const FORMAL_HOME = '/pages/index/index';
const UNRECOGNIZED_HOME = '/pages/unrecognized-experience/index';

function homeForIdentity(identity: any): string {
  return isUnrecognizedIdentity(identity) ? UNRECOGNIZED_HOME : FORMAL_HOME;
}

function loginErrorMessage(code?: string, fallback?: string): string {
  const messages: Record<string, string> = {
    MANUAL_PHONE_REQUIRED: '\u8bf7\u8f93\u5165\u624b\u673a\u53f7\u540e\u767b\u5f55',
    MANUAL_PHONE_INVALID: '\u8bf7\u8f93\u5165\u6b63\u786e\u7684\u4e2d\u56fd\u5927\u9646\u624b\u673a\u53f7',
    WECHAT_BINDING_REVIEW_REQUIRED: '\u8be5\u624b\u673a\u53f7\u5df2\u6709\u6863\u6848\uff0c\u5fae\u4fe1\u7ed1\u5b9a\u7533\u8bf7\u5df2\u63d0\u4ea4\uff0c\u8bf7\u7b49\u5f85\u8d85\u7ea7\u7ba1\u7406\u5458\u5ba1\u6838',
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
  const [phone, setPhone] = useState('');
  const [pendingBinding, setPendingBinding] = useState(false);
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

  const handlePhoneLogin = async () => {
    const normalizedPhone = normalizeManualPhone(phone);
    const validationError = validateManualPhone(normalizedPhone);
    if (validationError) {
      Taro.showToast({ title: validationError, icon: 'none' });
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
        phone: normalizedPhone,
      }));
      const result = loginResultState(response);
      if (result.kind === 'pending-binding') {
        setPendingBinding(true);
        return;
      }
      if (result.kind !== 'authenticated') {
        Taro.showToast({ title: loginErrorMessage(String(response.code || ''), response.error), icon: 'none' });
        return;
      }

      const user = result.user;
      loginBoundary.assertCurrent();
      const committed = await sessionCommitterRef.current?.commit({ token: result.token, user });
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
      <Text className="login-description">{'\u8bf7\u8f93\u5165\u624b\u673a\u53f7\u767b\u5f55\u3002\u624b\u673a\u53f7\u4ec5\u7528\u4e8e\u67e5\u627e\u8d26\u53f7\uff1b\u5df2\u6709\u6863\u6848\u9996\u6b21\u7ed1\u5b9a\u5f53\u524d\u5fae\u4fe1\u65f6\uff0c\u9700\u8981\u8d85\u7ea7\u7ba1\u7406\u5458\u5ba1\u6838\u3002'}</Text>
      <View className="phone-field">
        <Text className="phone-prefix">+86</Text>
        <Input
          className="phone-input"
          type="number"
          maxlength={11}
          value={phone}
          placeholder={'\u8bf7\u8f93\u5165\u624b\u673a\u53f7'}
          disabled={loading}
          onInput={event => {
            setPhone(normalizeManualPhone(event.detail.value));
            setPendingBinding(false);
          }}
        />
      </View>
      <Button
        className="wx-login-btn"
        onClick={() => void handlePhoneLogin()}
        loading={loading}
        disabled={loading}
      >{'\u767b\u5f55'}</Button>
      {pendingBinding ? <View className="binding-review-notice">
        <Text className="binding-review-title">{'\u5fae\u4fe1\u7ed1\u5b9a\u7533\u8bf7\u5df2\u63d0\u4ea4'}</Text>
        <Text className="binding-review-description">{'\u4e3a\u9632\u6b62\u624b\u673a\u53f7\u88ab\u5192\u7528\uff0c\u9700\u8981\u8d85\u7ea7\u7ba1\u7406\u5458\u6838\u9a8c\u3002\u5ba1\u6838\u901a\u8fc7\u540e\uff0c\u8bf7\u5728\u672c\u9875\u91cd\u65b0\u767b\u5f55\u3002'}</Text>
      </View> : null}
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
