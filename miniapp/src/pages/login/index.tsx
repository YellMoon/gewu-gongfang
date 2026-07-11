/**
 * 登录页 v2 — 微信一键登录 + 邀请码注册 + 离线提示
 */
import { useState } from 'react';
import Taro, { useDidShow } from '@tarojs/taro';
import { View, Text, Input, Button } from '@tarojs/components';
import { api } from '../../utils/api';
import { clearPermissionCache } from '../../utils/permission';
import './index.scss';

export default function LoginPage() {
  const [inviteCode, setInviteCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'login' | 'invite'>('login');
  const [needsPhoneAuth, setNeedsPhoneAuth] = useState(false);

  useDidShow(() => {
    const token = Taro.getStorageSync('auth_token');
    if (token) {
      Taro.reLaunch({ url: '/pages/index/index' });
    }
  });

  const requestWxLogin = async (phoneCode?: string) => {
    setLoading(true);
    try {
      const { code } = await Taro.login();
      if (!code) {
        Taro.showToast({ title: '获取微信登录凭证失败', icon: 'error' });
        setLoading(false);
        return;
      }

      const res = await api.post<{ token: string; user?: any; userId?: string; nickname?: string; avatarUrl?: string; role?: string }>('/api/auth/wechat-login', {
        code,
        ...(phoneCode ? { phoneCode } : {}),
      });

      if (res.success && res.data) {
        const loginUser = res.data.user || {
          id: res.data.userId,
          nickname: res.data.nickname,
          avatarUrl: res.data.avatarUrl,
          role: res.data.role || 'student',
          user_type: res.data.role || 'student',
        };
        clearPermissionCache();
        Taro.setStorageSync('auth_token', res.data.token);
        Taro.setStorageSync('user_info', {
          ...loginUser,
          user_type: loginUser.role || loginUser.user_type || 'student',
        });
        Taro.showToast({ title: '登录成功', icon: 'success' });
        setTimeout(() => {
          Taro.reLaunch({ url: '/pages/index/index' });
        }, 500);
      } else if (res.code === 'MINIAPP_USER_NOT_PREAUTHORIZED' && !phoneCode) {
        setNeedsPhoneAuth(true);
        Taro.showToast({ title: '\u8bf7\u9a8c\u8bc1\u9884\u7559\u624b\u673a\u53f7', icon: 'none' });
      } else {
        Taro.showToast({ title: res.error || '登录失败', icon: 'error' });
      }
    } catch (err: any) {
      Taro.showToast({ title: err.errMsg?.includes('timeout') ? '请求超时' : '登录失败', icon: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleWxLogin = () => requestWxLogin();

  const handlePhoneLogin = async (event: any) => {
    const phoneCode = event?.detail?.code;
    if (!phoneCode) {
      Taro.showToast({ title: '\u672a\u5b8c\u6210\u624b\u673a\u53f7\u9a8c\u8bc1', icon: 'none' });
      return;
    }
    await requestWxLogin(phoneCode);
  };

  const handleInviteRegister = async () => {
    if (!inviteCode.trim()) {
      Taro.showToast({ title: '请输入邀请码', icon: 'error' });
      return;
    }

    setLoading(true);
    try {
      const { code } = await Taro.login();
      const res = await api.post<{ token: string; user: any }>('/api/auth/register', {
        openid: code,
        invite_code: inviteCode.trim(),
      });

      if (res.success && res.data) {
        clearPermissionCache();
        Taro.setStorageSync('auth_token', res.data.token);
        Taro.setStorageSync('user_info', res.data.user);
        Taro.showToast({ title: '注册成功', icon: 'success' });
        setTimeout(() => {
          Taro.reLaunch({ url: '/pages/index/index' });
        }, 500);
      } else {
        Taro.showToast({ title: res.error || '注册失败', icon: 'error' });
      }
    } catch (err: any) {
      Taro.showToast({ title: '网络错误', icon: 'error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <View className="login-page">
      <View className="login-header">
        <View className="login-logo">
          <Text className="logo-text">格</Text>
        </View>
        <Text className="login-title">格物工坊</Text>
        <Text className="login-subtitle">教育综合服务平台</Text>
      </View>

      {mode === 'login' ? (
        <View className="login-form">
          {needsPhoneAuth ? (
            <Button
              className={`wx-login-btn ${loading ? 'loading' : ''}`}
              openType="getPhoneNumber"
              onGetPhoneNumber={handlePhoneLogin}
              loading={loading}
              disabled={loading}
            >
              {loading ? '\u9a8c\u8bc1\u4e2d...' : '\u9a8c\u8bc1\u9884\u7559\u624b\u673a\u53f7'}
            </Button>
          ) : (
          <Button
            className={`wx-login-btn ${loading ? 'loading' : ''}`}
            onClick={handleWxLogin}
            loading={loading}
            disabled={loading}
          >
            {loading ? '登录中...' : '微信一键登录'}
          </Button>
          )}

          <View className="divider">
            <View className="divider-line" />
            <Text className="divider-text">其他方式</Text>
            <View className="divider-line" />
          </View>

          <View className="invite-link" onClick={() => setMode('invite')}>
            <Text>使用邀请码注册</Text>
          </View>
        </View>
      ) : (
        <View className="invite-form">
          <Input
            className="invite-input"
            placeholder="请输入邀请码"
            value={inviteCode}
            onInput={(e) => setInviteCode(e.detail.value)}
            maxlength={32}
          />

          <Button
            className={`invite-btn ${loading ? 'loading' : ''}`}
            onClick={handleInviteRegister}
            loading={loading}
            disabled={loading || !inviteCode.trim()}
          >
            {loading ? '注册中...' : '立即注册'}
          </Button>

          <View className="divider">
            <View className="divider-line" />
            <Text className="divider-text">已有账号</Text>
            <View className="divider-line" />
          </View>

          <View className="invite-link" onClick={() => setMode('login')}>
            <Text>返回微信登录</Text>
          </View>
        </View>
      )}

      <View className="login-footer">
        <Text className="footer-text">教务管理 · 题库 · 财务</Text>
      </View>
    </View>
  );
}
