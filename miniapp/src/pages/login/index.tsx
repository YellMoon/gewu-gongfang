import { useState } from 'react';
import Taro, { useDidShow } from '@tarojs/taro';
import { View, Text, Button } from '@tarojs/components';
import { api } from '../../utils/api';
import { clearPermissionCache } from '../../utils/permission';
import './index.scss';

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [needsPhoneAuth, setNeedsPhoneAuth] = useState(false);
  const [pendingReview, setPendingReview] = useState(false);

  useDidShow(() => {
    if (Taro.getStorageSync('auth_token')) Taro.reLaunch({ url: '/pages/index/index' });
  });

  const requestWxLogin = async (phoneCode?: string) => {
    setLoading(true);
    try {
      const { code } = await Taro.login();
      const res = await api.post<any>('/api/auth/wechat-login', { code, ...(phoneCode ? { phoneCode } : {}) });
      if (res.success && res.data) {
        const loginUser = res.data.user || { id: res.data.userId, nickname: res.data.nickname, role: res.data.role || 'student' };
        clearPermissionCache();
        Taro.setStorageSync('auth_token', res.data.token);
        Taro.setStorageSync('user_info', { ...loginUser, user_type: loginUser.role || loginUser.user_type || 'student' });
        Taro.reLaunch({ url: '/pages/index/index' });
      } else if (res.code === 'PENDING_REVIEW' || res.code === 'USER_PENDING_REVIEW') {
        setPendingReview(true);
        Taro.removeStorageSync('auth_token');
      } else if (res.code === 'PHONE_VERIFICATION_REQUIRED' && !phoneCode) {
        setNeedsPhoneAuth(true);
        Taro.showToast({ title: '\u8bf7\u9a8c\u8bc1\u9884\u7559\u624b\u673a\u53f7', icon: 'none' });
      } else if (res.code === 'PHONE_IDENTITY_CONFLICT') {
        Taro.showToast({ title: '\u624b\u673a\u53f7\u6216\u5fae\u4fe1\u5df2\u7ed1\u5b9a\u5176\u4ed6\u8d26\u53f7', icon: 'none' });
      } else if (res.code === 'AUTH_RATE_LIMITED') {
        Taro.showToast({ title: '\u64cd\u4f5c\u9891\u7e41\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5', icon: 'none' });
      } else Taro.showToast({ title: res.error || '\u767b\u5f55\u5931\u8d25', icon: 'error' });
    } catch (_error) {
      Taro.showToast({ title: '\u767b\u5f55\u5931\u8d25', icon: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handlePhoneLogin = async (event: any) => {
    const phoneCode = event?.detail?.code;
    if (phoneCode) await requestWxLogin(phoneCode);
  };

  return <View className="login-page">
    <View className="login-header"><View className="login-logo"><Text className="logo-text">{'\u683c'}</Text></View><Text className="login-title">{'\u683c\u7269\u5de5\u574a'}</Text></View>
    <View className="login-form">
      {pendingReview ? <View><Text>{'\u5df2\u63d0\u4ea4\u5ba1\u6838\uff0c\u8bf7\u7b49\u5f85\u7ba1\u7406\u5458\u6279\u51c6'}</Text></View>
        : needsPhoneAuth ? <Button className="wx-login-btn" openType="getPhoneNumber" onGetPhoneNumber={handlePhoneLogin} loading={loading} disabled={loading}>{'\u9a8c\u8bc1\u9884\u7559\u624b\u673a\u53f7'}</Button>
          : <Button className="wx-login-btn" onClick={() => requestWxLogin()} loading={loading} disabled={loading}>{'\u5fae\u4fe1\u4e00\u952e\u767b\u5f55'}</Button>}
    </View>
  </View>;
}
