import { useRef, useState } from 'react';
import Taro, { useLoad } from '@tarojs/taro';
import { Button, Input, Text, View } from '@tarojs/components';
import { desktopAuthorizationApi } from '../../utils/api';
import {
  buildDesktopConfirmationPayload,
  desktopAuthorizationErrorMessage,
  desktopAuthorizationPurposePresentation,
  desktopAuthorizationView,
  parseDesktopAuthorizationChallengeId,
  projectDesktopAuthorizationChallenge,
} from '../../utils/desktopAuthorizationRuntime';
import { normalizeManualPhone, validateManualPhone } from '../../utils/manualPhone';
import './index.scss';

type Challenge = {
  id: string;
  deviceName: string;
  keyFingerprintSummary: string;
  purpose: string;
  status: string;
  createdAt: string;
  expiresAt: string;
  rowVersion: number;
};

type ViewState = 'loading' | 'phone-required' | 'approval-pending' | 'approved' | 'operation-confirmed' | 'rejected' | 'expired' | 'error';

function localTime(value?: string): string {
  if (!value) return '--';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { hour12: false }) : '--';
}

export default function DesktopAuthorizationPage() {
  const [challengeId, setChallengeId] = useState('');
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [viewState, setViewState] = useState<ViewState>('loading');
  const [message, setMessage] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const operationRef = useRef(false);

  const showFailure = (code: any, fallback = '') => {
    setMessage(desktopAuthorizationErrorMessage(String(code || ''), fallback));
    setViewState(String(code || '') === 'DESKTOP_CHALLENGE_EXPIRED' ? 'expired' : 'error');
  };

  const acceptChallenge = (value: any) => {
    const next = projectDesktopAuthorizationChallenge(value) as Challenge;
    setChallenge(next);
    setViewState(desktopAuthorizationView(next, new Date()) as ViewState);
    setMessage('');
  };

  const loadChallenge = async (id: string) => {
    setViewState('loading');
    setMessage('');
    const response = await desktopAuthorizationApi.read(id);
    if (!response.success || !response.data?.challenge) {
      showFailure(response.code, response.error);
      return;
    }
    try {
      acceptChallenge(response.data.challenge);
    } catch (error: any) {
      showFailure(error?.code || error?.message);
    }
  };

  useLoad((options) => {
    try {
      const id = parseDesktopAuthorizationChallengeId(options || {});
      setChallengeId(id);
      void loadChallenge(id);
    } catch (error: any) {
      showFailure(error?.code || error?.message);
    }
  });

  const confirmPhoneIdentity = async () => {
    const normalizedPhone = normalizeManualPhone(phone);
    const validationError = validateManualPhone(normalizedPhone);
    if (validationError) {
      setMessage(validationError);
      return;
    }
    if (operationRef.current || !challengeId) return;
    operationRef.current = true;
    setBusy(true);
    setMessage('');
    try {
      const { code } = await Taro.login();
      const payload = buildDesktopConfirmationPayload({
        challengeId,
        loginCode: code,
        phone: normalizedPhone,
        expectedRowVersion: challenge?.rowVersion,
      });
      const response = await desktopAuthorizationApi.confirm(payload);
      if (!response.success || !response.data?.challenge) {
        showFailure(response.code, response.error);
        return;
      }
      acceptChallenge(response.data.challenge);
    } catch (error: any) {
      showFailure(error?.code || error?.message, error?.errMsg);
    } finally {
      setBusy(false);
      operationRef.current = false;
    }
  };

  const renderStatus = () => {
    const purposePresentation = desktopAuthorizationPurposePresentation(challenge?.purpose || 'register');
    if (viewState === 'loading') {
      return <View className="authorization-state state-loading"><View className="state-spinner" /><Text>{'\u6b63\u5728\u8bfb\u53d6\u8bbe\u5907\u7533\u8bf7\u2026'}</Text></View>;
    }
    if (viewState === 'phone-required') {
      return <>
        <View className="privacy-note">
          <Text className="privacy-title">{'\u786e\u8ba4\u7684\u662f\u4f60\u672c\u4eba'}</Text>
          <Text>{purposePresentation.phoneCopy}</Text>
        </View>
        <View className="phone-field">
          <Text className="phone-prefix">+86</Text>
          <Input
            className="phone-input"
            type="number"
            maxlength={11}
            value={phone}
            placeholder={'\u8bf7\u8f93\u5165\u624b\u673a\u53f7'}
            disabled={busy}
            onInput={event => setPhone(normalizeManualPhone(event.detail.value))}
          />
        </View>
        <Button
          className="phone-confirm-button"
          onClick={() => void confirmPhoneIdentity()}
          loading={busy}
          disabled={busy}
        >{'\u6838\u5bf9\u624b\u673a\u53f7\u5e76\u786e\u8ba4'}</Button>
      </>;
    }
    if (viewState === 'approval-pending') {
      return <View className="authorization-state state-success">
        <Text className="state-mark">{'\u5df2'}</Text>
        <Text className="state-title">{'\u8eab\u4efd\u5df2\u786e\u8ba4'}</Text>
        <Text>{'\u7b49\u5f85\u53ef\u4fe1\u8bbe\u5907\u5ba1\u6279\u3002\u5ba1\u6279\u4eba\u53ea\u80fd\u786e\u8ba4\u6216\u62d2\u7edd\uff0c\u4e0d\u80fd\u6539\u6210\u53e6\u4e00\u4e2a\u8d26\u53f7\u3002'}</Text>
        <Button className="secondary-button" onClick={() => void loadChallenge(challengeId)}>{'\u5237\u65b0\u5ba1\u6279\u72b6\u6001'}</Button>
      </View>;
    }
    if (viewState === 'operation-confirmed') {
      return <View className="authorization-state state-success">
        <Text className="state-mark">{'\u5df2'}</Text>
        <Text className="state-title">{'\u4e3b\u673a\u8eab\u4efd\u9a8c\u8bc1\u5df2\u5b8c\u6210'}</Text>
        <Text>{'\u8bf7\u56de\u5230\u53d1\u8d77\u64cd\u4f5c\u7684\u7535\u8111\uff0c\u7ee7\u7eed\u5b8c\u6210\u672c\u673a\u6570\u636e\u5e93\u3001\u9898\u5e93\u76d8\u4e0e\u8bbe\u5907\u79c1\u94a5\u6838\u9a8c\u3002\u672c\u6b21\u4e0d\u8fdb\u5165\u666e\u901a\u8bbe\u5907\u5ba1\u6279\u961f\u5217\u3002'}</Text>
      </View>;
    }
    if (viewState === 'approved') {
      return <View className="authorization-state state-success">
        <Text className="state-mark">{'\u901a'}</Text>
        <Text className="state-title">{'\u8bbe\u5907\u5ba1\u6279\u5df2\u901a\u8fc7'}</Text>
        <Text>{'\u8bf7\u56de\u5230\u7535\u8111\uff0c\u8bbe\u7f6e\u8fd9\u53f0\u7535\u8111\u72ec\u7acb\u7684\u672c\u673a\u5bc6\u7801\u3002'}</Text>
      </View>;
    }
    const title = viewState === 'expired'
      ? '\u7533\u8bf7\u5df2\u8fc7\u671f'
      : viewState === 'rejected' ? '\u7533\u8bf7\u672a\u901a\u8fc7' : '\u6682\u65f6\u65e0\u6cd5\u7ee7\u7eed';
    return <View className="authorization-state state-error">
      <Text className="state-mark">{'!'}</Text>
      <Text className="state-title">{title}</Text>
      <Text>{message || (viewState === 'rejected' ? '\u8bf7\u786e\u8ba4\u7533\u8bf7\u4fe1\u606f\uff0c\u518d\u5728\u7535\u8111\u4e0a\u91cd\u65b0\u53d1\u8d77\u3002' : '\u8bf7\u7a0d\u540e\u91cd\u8bd5\u3002')}</Text>
      {challengeId && <Button className="secondary-button" onClick={() => void loadChallenge(challengeId)}>{'\u91cd\u65b0\u8bfb\u53d6\u7533\u8bf7'}</Button>}
    </View>;
  };

  const purposePresentation = desktopAuthorizationPurposePresentation(challenge?.purpose || 'register');

  return <View className="desktop-authorization-page">
    <View className="authorization-hero">
      <View className="hero-icon"><Text>{'\u8bbe'}</Text></View>
      <Text className="hero-kicker">{'\u683c\u7269\u5de5\u574a\u00b7\u7535\u8111\u8eab\u4efd'}</Text>
      <Text className="hero-title">{purposePresentation.title}</Text>
      <Text className="hero-copy">{'\u624b\u586b\u624b\u673a\u53f7\u4ec5\u7528\u4e8e\u4e0e\u5df2\u6709\u8d44\u6599\u6838\u5bf9\uff0c\u4e0d\u4f1a\u4fdd\u5b58\u5230\u5f85\u6388\u6743\u7535\u8111\u3002'}</Text>
    </View>

    {challenge && <View className="device-card">
      <View className="device-card-header"><Text className="device-name">{challenge.deviceName}</Text><Text className="purpose-tag">{purposePresentation.label}</Text></View>
      <View className="detail-row"><Text className="detail-label">{'\u5bc6\u94a5\u6307\u7eb9'}</Text><Text className="detail-value fingerprint">{challenge.keyFingerprintSummary}</Text></View>
      <View className="detail-row"><Text className="detail-label">{'\u7533\u8bf7\u65f6\u95f4'}</Text><Text className="detail-value">{localTime(challenge.createdAt)}</Text></View>
      <View className="detail-row"><Text className="detail-label">{'\u8fc7\u671f\u65f6\u95f4'}</Text><Text className="detail-value">{localTime(challenge.expiresAt)}</Text></View>
    </View>}

    <View className="status-card">{renderStatus()}</View>
    {message && viewState === 'phone-required' && <View className="inline-message"><Text>{message}</Text></View>}
    <Text className="security-footer">{'\u5982\u679c\u4f60\u6ca1\u6709\u5728\u7535\u8111\u4e0a\u53d1\u8d77\u8fd9\u6b21\u7533\u8bf7\uff0c\u8bf7\u76f4\u63a5\u5173\u95ed\u672c\u9875\u3002'}</Text>
  </View>;
}
