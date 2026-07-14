import { useRef, useState } from 'react';
import Taro, { useDidShow } from '@tarojs/taro';
import { View, Text, Button, Input } from '@tarojs/components';
import { api, authApi } from '../../utils/api';
import { clearPermissionCache } from '../../utils/permission';
import { clearBusinessCache, setBusinessCacheIdentity } from '../../utils/storage';
import {
  createReviewSessionCommitter,
  createSynchronousMutex,
  reviewLoginErrorMessage,
} from '../../utils/reviewExperience';
import './index.scss';

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [needsPhoneAuth, setNeedsPhoneAuth] = useState(false);
  const [pendingReview, setPendingReview] = useState(false);
  const [reviewCode, setReviewCode] = useState('');
  const [reviewRole, setReviewRole] = useState<'admin' | 'student'>('admin');
  const [reviewLoading, setReviewLoading] = useState(false);
  const loginMutexRef = useRef<ReturnType<typeof createSynchronousMutex> | null>(null);
  const reviewSessionCommitterRef = useRef<ReturnType<typeof createReviewSessionCommitter> | null>(null);
  if (!loginMutexRef.current) loginMutexRef.current = createSynchronousMutex();
  if (!reviewSessionCommitterRef.current) {
    reviewSessionCommitterRef.current = createReviewSessionCommitter({
      readUser: () => Taro.getStorageSync('user_info'),
      clearBusinessCache,
      clearPermissionCache,
      removeStorage: (key: string) => Taro.removeStorageSync(key),
      writeUser: (user: any) => Taro.setStorageSync('user_info', user),
      setBusinessCacheIdentity,
      writeToken: (token: string) => Taro.setStorageSync('auth_token', token),
      relaunch: () => Taro.reLaunch({ url: '/pages/index/index' }),
    });
  }
  const loginBusy = loading || reviewLoading;

  useDidShow(() => {
    if (Taro.getStorageSync('auth_token')) Taro.reLaunch({ url: '/pages/index/index' });
  });

  const requestWxLogin = async (phoneCode?: string) => {
    if (!loginMutexRef.current?.tryAcquire()) return;
    setLoading(true);
    try {
      const { code } = await Taro.login();
      const res = await api.post<any>('/api/auth/wechat-login', { code, ...(phoneCode ? { phoneCode } : {}) });
      if (res.success && res.data) {
        const loginUser = res.data.user || { id: res.data.userId, nickname: res.data.nickname, role: res.data.role || 'student' };
        const normalizedUser = { ...loginUser, user_type: loginUser.role || loginUser.user_type || 'student' };
        clearPermissionCache();
        Taro.setStorageSync('auth_token', res.data.token);
        Taro.setStorageSync('user_info', normalizedUser);
        setBusinessCacheIdentity(normalizedUser);
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
      loginMutexRef.current?.release();
    }
  };

  const handlePhoneLogin = async (event: any) => {
    const phoneCode = event?.detail?.code;
    if (phoneCode) await requestWxLogin(phoneCode);
  };

  const requestReviewLogin = async () => {
    const code = reviewCode.trim();
    if (!code) {
      Taro.showToast({ title: '\u8bf7\u8f93\u5165\u63d0\u5ba1\u8bf4\u660e\u4e2d\u7684\u5ba1\u6838\u4f53\u9a8c\u7801', icon: 'none' });
      return;
    }
    if (!loginMutexRef.current?.tryAcquire()) return;
    setReviewLoading(true);
    try {
      const res = await authApi.reviewDemo(code, reviewRole);
      if (res.success && res.data) {
        const committed = await reviewSessionCommitterRef.current?.commit(res.data, reviewRole);
        if (committed?.success) return;
      }
      Taro.showToast({ title: reviewLoginErrorMessage(String(res.code || ''), res.error), icon: 'none' });
    } catch (error: any) {
      Taro.showToast({ title: reviewLoginErrorMessage('', error?.errMsg || error?.message), icon: 'none' });
    } finally {
      setReviewLoading(false);
      loginMutexRef.current?.release();
    }
  };

  return <View className="login-page">
    <View className="login-header"><View className="login-logo"><Text className="logo-text">{'\u683c'}</Text></View><Text className="login-title">{'\u683c\u7269\u5de5\u574a'}</Text></View>
    <View className="login-form">
      {pendingReview ? <View><Text>{'\u5df2\u63d0\u4ea4\u5ba1\u6838\uff0c\u8bf7\u7b49\u5f85\u7ba1\u7406\u5458\u6279\u51c6'}</Text></View>
        : needsPhoneAuth ? <Button className="wx-login-btn" openType="getPhoneNumber" onGetPhoneNumber={handlePhoneLogin} loading={loading} disabled={loginBusy}>{'\u9a8c\u8bc1\u9884\u7559\u624b\u673a\u53f7'}</Button>
          : <Button className="wx-login-btn" onClick={() => requestWxLogin()} loading={loading} disabled={loginBusy}>{'\u5fae\u4fe1\u4e00\u952e\u767b\u5f55'}</Button>}
    </View>
    <View className="review-card">
      <Text className="review-title">{'\u5ba1\u6838\u4f53\u9a8c'}</Text>
      <Text className="review-description">{'\u4f7f\u7528\u63d0\u5ba1\u8bf4\u660e\u4e2d\u7684\u4f53\u9a8c\u7801\u67e5\u770b\u8131\u654f\u793a\u4f8b\u6570\u636e'}</Text>
      <Input
        className="review-code-input"
        value={reviewCode}
        password
        maxlength={128}
        placeholder={'\u8bf7\u8f93\u5165\u5ba1\u6838\u4f53\u9a8c\u7801'}
        onInput={event => setReviewCode(event.detail.value)}
      />
      <View className="review-role-controls">
        <Button
          className={`review-role-control ${reviewRole === 'admin' ? 'active' : ''}`}
          data-review-role="admin"
          aria-pressed={reviewRole === 'admin'}
          onClick={() => setReviewRole('admin')}
          disabled={loginBusy}
        >{'\u7ba1\u7406\u5458\u4f53\u9a8c'}</Button>
        <Button
          className={`review-role-control ${reviewRole === 'student' ? 'active' : ''}`}
          data-review-role="student"
          aria-pressed={reviewRole === 'student'}
          onClick={() => setReviewRole('student')}
          disabled={loginBusy}
        >{'\u5b66\u751f\u4f53\u9a8c'}</Button>
      </View>
      <Button
        className="review-login-btn"
        onClick={requestReviewLogin}
        loading={reviewLoading}
        disabled={loginBusy}
      >{'\u8fdb\u5165\u5ba1\u6838\u4f53\u9a8c'}</Button>
      <Text className="review-note">{'\u5ba1\u6838\u4f53\u9a8c\u4ec5\u4f7f\u7528\u53ea\u8bfb\u8131\u654f\u793a\u4f8b\u6570\u636e'}</Text>
    </View>
  </View>;
}
