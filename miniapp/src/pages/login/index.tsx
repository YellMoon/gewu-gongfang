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

  useDidShow(() => {
    const token = Taro.getStorageSync('auth_token');
    if (token) {
      Taro.switchTab({ url: '/pages/index/index' });
    }
  });

  const handleWxLogin = async () => {
    // 先检查网络
    const network = await Taro.getNetworkType();
    if (network.networkType === 'none') {
      Taro.showToast({ title: '无网络连接', icon: 'error', duration: 2000 });
      return;
    }

    setLoading(true);
    try {
      const { code } = await Taro.login();
      if (!code) {
        Taro.showToast({ title: '获取微信登录凭证失败', icon: 'error' });
        setLoading(false);
        return;
      }

      const res = await api.post<{ token: string; user: any }>('/api/auth/login', {
        openid: code,
      });

      if (res.success && res.data) {
        clearPermissionCache();
        Taro.setStorageSync('auth_token', res.data.token);
        Taro.setStorageSync('user_info', res.data.user);
        Taro.showToast({ title: '登录成功 🎉', icon: 'success' });
        setTimeout(() => {
          Taro.switchTab({ url: '/pages/index/index' });
        }, 500);
      } else {
        Taro.showToast({ title: res.error || '登录失败', icon: 'error' });
      }
    } catch (err: any) {
      Taro.showToast({ title: err.errMsg?.includes('timeout') ? '请求超时' : '登录失败', icon: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleInviteRegister = async () => {
    if (!inviteCode.trim()) {
      Taro.showToast({ title: '请输入邀请码', icon: 'error' });
      return;
    }

    const network = await Taro.getNetworkType();
    if (network.networkType === 'none') {
      Taro.showToast({ title: '无网络连接', icon: 'error' });
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
        Taro.showToast({ title: '注册成功 🎉', icon: 'success' });
        setTimeout(() => {
          Taro.switchTab({ url: '/pages/index/index' });
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
          <Button
            className={`wx-login-btn ${loading ? 'loading' : ''}`}
            onClick={handleWxLogin}
            loading={loading}
            disabled={loading}
          >
            {loading ? '登录中...' : '微信一键登录'}
          </Button>

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
