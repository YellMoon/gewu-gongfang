import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Divider,
  Input,
  QRCode,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';
import {
  LockOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  WechatOutlined,
} from '@ant-design/icons';
import { getRuntimeConfig } from '../services/runtimeConfigClient';
import { resolveDesktopIdentityBaseUrl } from '../services/managedSyncConfig.mjs';
import { desktopIdentityErrorMessage } from '../services/desktopIdentityError.mjs';
import {
  canStartBusinessRuntime,
  createDesktopIdentityClient,
  desktopIdentityExpiryDelay,
  isDesktopIdentityNetworkFailure,
  registrationViewForChallenge,
  resolveDesktopGateState,
} from '../services/desktopIdentityClient.mjs';
import {
  clearCurrentDesktopIdentityPartition,
  setCurrentDesktopIdentityContext,
} from '../services/desktopIdentityPartition.mjs';
import './DesktopIdentityGate.css';

const BusinessApp = React.lazy(() => import('../App'));
const { Paragraph, Text, Title } = Typography;

type GateState = {
  kind: string;
  userId?: string;
  activeRole?: string;
  eligibleRoles?: string[];
  teacherId?: string | null;
  studentId?: string | null;
  partitionKey?: string;
  expiresAt?: string | null;
};

function browserOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

function roleLabel(role?: string): string {
  return ({
    super_admin: '超级管理员',
    admin: '管理员',
    teacher: '老师',
    student: '学生',
    parent: '家长',
  } as Record<string, string>)[String(role || '')] || String(role || '未知角色');
}

function messageForError(error: any): string {
  return desktopIdentityErrorMessage(error);
}

const DesktopIdentityGate: React.FC = () => {
  const [gateState, setGateState] = useState<GateState>({ kind: 'loading' });
  const [pending, setPending] = useState<any>(null);
  const [runtimeConfig, setRuntimeConfig] = useState<any>(null);
  const [onlineSession, setOnlineSession] = useState<any>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [accountLoginType, setAccountLoginType] = useState<'phone' | 'account_name'>('phone');
  const [accountLogin, setAccountLogin] = useState('');
  const [accountPassword, setAccountPassword] = useState('');
  const [cloudLoginName, setCloudLoginName] = useState('');
  const [cloudPassword, setCloudPassword] = useState('');
  const [cloudPasswordAgain, setCloudPasswordAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [polling, setPolling] = useState(false);
  const [runtimeSuspended, setRuntimeSuspended] = useState(false);
  const [error, setError] = useState('');
  const clientRef = useRef<any>(null);
  const onlineSessionRef = useRef<any>(null);
  const currentPartitionRef = useRef<string | null>(null);
  const pollingRef = useRef(false);
  const registrationFlowRef = useRef(0);

  const suspendBusinessMemory = useCallback(async (_partitionKey?: string) => {
    setRuntimeSuspended(true);
    (window as any).dbService?.prepareIdentityPartitionChange?.();
  }, []);

  const secureRelock = useCallback(async (nextState: GateState) => {
    setRuntimeSuspended(true);
    try {
      await clientRef.current?.lock();
    } finally {
      (window as any).dbService?.prepareIdentityPartitionChange?.();
      clearCurrentDesktopIdentityPartition(window);
      currentPartitionRef.current = null;
      onlineSessionRef.current = null;
      setOnlineSession(null);
      setGateState(nextState);
      setRuntimeSuspended(false);
    }
  }, []);

  const installIdentityContext = useCallback((next: GateState) => {
    if (!next.partitionKey || !next.userId || !next.activeRole) return;
    setCurrentDesktopIdentityContext({
      userId: next.userId,
      activeRole: next.activeRole,
      teacherId: next.teacherId || null,
      studentId: next.studentId || null,
      partitionKey: next.partitionKey,
      offline: next.kind === 'offline-unlocked',
    }, window);
    (window as any).dbService?.switchIdentityPartition?.(next.partitionKey);
    currentPartitionRef.current = next.partitionKey;
  }, []);

  const acceptRuntime = useCallback((result: any) => {
    const next = result.gateState as GateState;
    if (!canStartBusinessRuntime({ gateState: next })) {
      setGateState(next);
      return;
    }
    installIdentityContext(next);
    const nextOnlineSession = result.token ? {
      token: result.token,
      expiresAt: result.expiresAt,
      session: result.session,
      profile: result.profile,
    } : null;
    onlineSessionRef.current = nextOnlineSession;
    setOnlineSession(nextOnlineSession);
    setGateState(next);
    setRuntimeSuspended(false);
    setError('');
  }, [installIdentityContext]);

  useEffect(() => {
    let cancelled = false;
    let installedProvider: any = null;
    (async () => {
      try {
        if (!window.desktopIdentity) throw new Error('DESKTOP_IDENTITY_BRIDGE_REQUIRED');
        const config = await getRuntimeConfig();
        setRuntimeConfig(config);
        const identityBaseUrl = resolveDesktopIdentityBaseUrl(config);
        if (!identityBaseUrl) throw new Error('PAIRING_API_BASE_REQUIRED');
        const client = createDesktopIdentityClient({
          desktopIdentity: window.desktopIdentity,
          clearRoleCache: suspendBusinessMemory,
        });
        const vaultStatus = await client.status();
        if (cancelled) return;
        clientRef.current = client;
        installedProvider = {
          ensureOnline: async () => {
            const result = await client.ensureOnlineSession({
              baseUrl: identityBaseUrl,
            });
            if (!cancelled) acceptRuntime(result);
            return result;
          },
          listCloudSchedules: async () => {
            const currentSession = onlineSessionRef.current;
            if (!currentSession) throw new Error('ONLINE_DESKTOP_SESSION_REQUIRED');
            return client.listCloudSchedules({
              baseUrl: identityBaseUrl,
              currentSession,
            });
          },
          listCloudBusinessProjection: async () => {
            const currentSession = onlineSessionRef.current;
            if (!currentSession) throw new Error('ONLINE_DESKTOP_SESSION_REQUIRED');
            return client.listCloudBusinessProjection({
              baseUrl: identityBaseUrl,
              currentSession,
            });
          },
          listCloudQuestions: async () => {
            const currentSession = onlineSessionRef.current;
            if (!currentSession) throw new Error('ONLINE_DESKTOP_SESSION_REQUIRED');
            return client.listCloudQuestions({
              baseUrl: identityBaseUrl,
              currentSession,
            });
          },
          updateCloudSchedule: async (input: any) => {
            const currentSession = onlineSessionRef.current;
            if (!currentSession) throw new Error('ONLINE_DESKTOP_SESSION_REQUIRED');
            return client.updateCloudSchedule({
              ...input,
              baseUrl: identityBaseUrl,
              currentSession,
            });
          },
          updateCloudStudent: async (input: any) => {
            const currentSession = onlineSessionRef.current;
            if (!currentSession) throw new Error('ONLINE_DESKTOP_SESSION_REQUIRED');
            return client.updateCloudStudent({
              ...input,
              baseUrl: identityBaseUrl,
              currentSession,
            });
          },
          createCloudTeacher: async (input: any) => {
            const currentSession = onlineSessionRef.current;
            if (!currentSession) throw new Error('ONLINE_DESKTOP_SESSION_REQUIRED');
            return client.createCloudTeacher({ ...input, baseUrl: identityBaseUrl, currentSession });
          },
          updateCloudTeacher: async (input: any) => {
            const currentSession = onlineSessionRef.current;
            if (!currentSession) throw new Error('ONLINE_DESKTOP_SESSION_REQUIRED');
            return client.updateCloudTeacher({ ...input, baseUrl: identityBaseUrl, currentSession });
          },
          deleteCloudTeacher: async (input: any) => {
            const currentSession = onlineSessionRef.current;
            if (!currentSession) throw new Error('ONLINE_DESKTOP_SESSION_REQUIRED');
            return client.deleteCloudTeacher({ ...input, baseUrl: identityBaseUrl, currentSession });
          },
          createCloudRoom: async (input: any) => {
            const currentSession = onlineSessionRef.current;
            if (!currentSession) throw new Error('ONLINE_DESKTOP_SESSION_REQUIRED');
            return client.createCloudRoom({ ...input, baseUrl: identityBaseUrl, currentSession });
          },
          updateCloudRoom: async (input: any) => {
            const currentSession = onlineSessionRef.current;
            if (!currentSession) throw new Error('ONLINE_DESKTOP_SESSION_REQUIRED');
            return client.updateCloudRoom({ ...input, baseUrl: identityBaseUrl, currentSession });
          },
          deleteCloudRoom: async (input: any) => {
            const currentSession = onlineSessionRef.current;
            if (!currentSession) throw new Error('ONLINE_DESKTOP_SESSION_REQUIRED');
            return client.deleteCloudRoom({ ...input, baseUrl: identityBaseUrl, currentSession });
          },
          createCloudCourse: async (input: any) => {
            const currentSession = onlineSessionRef.current;
            if (!currentSession) throw new Error('ONLINE_DESKTOP_SESSION_REQUIRED');
            return client.createCloudCourse({ ...input, baseUrl: identityBaseUrl, currentSession });
          },
          updateCloudCourse: async (input: any) => {
            const currentSession = onlineSessionRef.current;
            if (!currentSession) throw new Error('ONLINE_DESKTOP_SESSION_REQUIRED');
            return client.updateCloudCourse({ ...input, baseUrl: identityBaseUrl, currentSession });
          },
          deleteCloudCourse: async (input: any) => {
            const currentSession = onlineSessionRef.current;
            if (!currentSession) throw new Error('ONLINE_DESKTOP_SESSION_REQUIRED');
            return client.deleteCloudCourse({ ...input, baseUrl: identityBaseUrl, currentSession });
          },
          updateCloudStudentRecord: async (input: any) => {
            const currentSession = onlineSessionRef.current;
            if (!currentSession) throw new Error('ONLINE_DESKTOP_SESSION_REQUIRED');
            return client.updateCloudStudentRecord({
              ...input,
              baseUrl: identityBaseUrl,
              currentSession,
            });
          },
          createCloudStudentRecord: async (input: any) => {
            const currentSession = onlineSessionRef.current;
            if (!currentSession) throw new Error('ONLINE_DESKTOP_SESSION_REQUIRED');
            return client.createCloudStudentRecord({ ...input, baseUrl: identityBaseUrl, currentSession });
          },
          deleteCloudStudent: async (input: any) => {
            const currentSession = onlineSessionRef.current;
            if (!currentSession) throw new Error('ONLINE_DESKTOP_SESSION_REQUIRED');
            return client.deleteCloudStudent({ ...input, baseUrl: identityBaseUrl, currentSession });
          },
          updateCloudScheduleStudentOverride: async (input: any) => {
            const currentSession = onlineSessionRef.current;
            if (!currentSession) throw new Error('ONLINE_DESKTOP_SESSION_REQUIRED');
            return client.updateCloudScheduleStudentOverride({
              ...input,
              baseUrl: identityBaseUrl,
              currentSession,
            });
          },
        };
        (window as any).desktopIdentitySessionProvider = installedProvider;
        setBaseUrl(identityBaseUrl);
        if (vaultStatus.state === 'empty') {
          setGateState({ kind: 'registration-required' });
          return;
        }
        if (vaultStatus.legacyUpgradeRequired || vaultStatus.state === 'legacy_upgrade_required') {
          setGateState({ kind: 'upgrade-required' });
          return;
        }
        if (['registration_pending', 'password_reset_pending', 'unified_online_recovery_pending'].includes(vaultStatus.state)) {
          setGateState({ kind: vaultStatus.state === 'unified_online_recovery_pending'
            ? 'registration-interrupted'
            : vaultStatus.state === 'password_reset_pending'
              ? 'password-reset-interrupted'
              : 'registration-interrupted' });
          return;
        }
        if (vaultStatus.state === 'sealed') {
          try {
            const resumed = await client.resume({ baseUrl: identityBaseUrl, online: browserOnline() });
            if (!cancelled) acceptRuntime(resumed);
          } catch (caught) {
            if (!cancelled) {
              const next = resolveDesktopGateState({ vaultStatus, online: browserOnline(), now: new Date() });
              setGateState(next.kind === 'locked' ? { kind: 'online-authentication-required' } : next);
              setError(messageForError(caught));
            }
          }
          return;
        }
        const next = resolveDesktopGateState({ vaultStatus, online: browserOnline(), onlineSession: null, now: new Date() });
        setGateState(next);
      } catch (caught) {
        if (!cancelled) setError(messageForError(caught));
      }
    })();
    return () => {
      cancelled = true;
      if ((window as any).desktopIdentitySessionProvider === installedProvider) {
        delete (window as any).desktopIdentitySessionProvider;
      }
    };
  }, [acceptRuntime, suspendBusinessMemory]);

  const pollRegistration = useCallback(async () => {
    if (!pending || pollingRef.current || !clientRef.current) return;
    const flowId = registrationFlowRef.current;
    pollingRef.current = true;
    setPolling(true);
    try {
      const next = pending?.pairingId
        ? await clientRef.current.pollUnifiedOnlineRegistration(pending)
        : await clientRef.current.pollRegistration(pending);
      if (registrationFlowRef.current === flowId) setPending(next);
      setError('');
    } catch (caught) {
      setError(messageForError(caught));
    } finally {
      pollingRef.current = false;
      setPolling(false);
    }
  }, [pending]);

  useEffect(() => {
    const status = pending?.pairingId ? pending?.status : pending?.challenge?.status;
    const waitingForVerification = pending?.pairingId
      ? status === 'awaiting_online_verification'
      : status === 'pending_phone';
    if (!waitingForVerification) return undefined;
    const timer = window.setInterval(() => { void pollRegistration(); }, 3000);
    return () => window.clearInterval(timer);
  }, [pending?.pairingId, pending?.status, pending?.challenge?.status, pollRegistration]);

  useEffect(() => {
    const remaining = desktopIdentityExpiryDelay(gateState, new Date());
    if (remaining === null) return undefined;
    const expiredState = gateState.kind === 'offline-unlocked'
      ? { kind: 'offline-blocked' }
      : { kind: 'online-authentication-required' };
    const expire = () => {
      void secureRelock(expiredState).catch(caught => setError(messageForError(caught)));
    };
    if (remaining <= 0) {
      expire();
      return undefined;
    }
    const timer = window.setTimeout(expire, Math.min(remaining, 2_147_000_000));
    return () => window.clearTimeout(timer);
  }, [gateState.expiresAt, gateState.kind, secureRelock]);

  const beginRegistration = async () => {
    registrationFlowRef.current += 1;
    setBusy(true);
    setError('');
    try {
      if (gateState.kind === 'registration-interrupted') await clientRef.current.lock();
      const randomPart = window.crypto?.randomUUID?.() || (String(Date.now()) + '-' + String(Math.random()));
      const started = await clientRef.current.beginUnifiedOnlineRegistration({
        baseUrl,
        idempotencyKey: 'desktop-registration-' + randomPart,
      });
      setPending(started);
      setGateState({ kind: 'registration-active' });
    } catch (caught) {
      try { await clientRef.current?.lock(); } catch (_cleanupError) { /* best effort */ }
      setPending(null);
      setError(messageForError(caught));
    } finally {
      setBusy(false);
    }
  };

  const beginPasswordVerification = async () => {
    registrationFlowRef.current += 1;
    setBusy(true);
    setError('');
    try {
      if (gateState.kind === 'registration-interrupted') await clientRef.current.lock();
      const randomPart = window.crypto?.randomUUID?.() || (String(Date.now()) + '-' + String(Math.random()));
      const started = await clientRef.current.beginPasswordVerification({
        baseUrl,
        idempotencyKey: 'desktop-password-verification-' + randomPart,
        loginType: accountLoginType,
        login: accountLogin,
        password: accountPassword,
      });
      setAccountPassword('');
      setPending(started);
      setGateState({ kind: 'registration-active' });
    } catch (caught) {
      setAccountPassword('');
      try { await clientRef.current?.lock(); } catch (_cleanupError) { /* best effort */ }
      setPending(null);
      setError(messageForError(caught));
    } finally {
      setBusy(false);
    }
  };

  const completeRegistration = async () => {
    const passwordEnrollmentRequested = Boolean(cloudLoginName || cloudPassword || cloudPasswordAgain);
    const canEnrollCloudPassword = pending?.pairingId && pending?.status === 'verified' && pending?.recovery !== true;
    if (passwordEnrollmentRequested && !canEnrollCloudPassword) {
      setError('\u5f53\u524d\u8eab\u4efd\u9a8c\u8bc1\u4e0d\u80fd\u8bbe\u7f6e\u4e91\u7aef\u8d26\u53f7\u5bc6\u7801\u3002');
      return;
    }
    if (passwordEnrollmentRequested && (!cloudPassword || cloudPassword !== cloudPasswordAgain)) {
      setError('\u4e24\u6b21\u8f93\u5165\u7684\u4e91\u7aef\u8d26\u53f7\u5bc6\u7801\u4e0d\u4e00\u81f4\u3002');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const verifiedPending = passwordEnrollmentRequested
        ? await clientRef.current.enrollPasswordForVerifiedRegistration({ pending, loginName: cloudLoginName || null, password: cloudPassword })
        : pending;
      const result = await clientRef.current.completeUnifiedOnlineRegistration({ pending: verifiedPending });
      setCloudLoginName('');
      setCloudPassword('');
      setCloudPasswordAgain('');
      acceptRuntime(result);
    } catch (caught) {
      console.error('[desktop-identity:registration]', String((caught as any)?.code || 'DESKTOP_IDENTITY_REGISTRATION_FAILED'));
      setError(messageForError(caught));
    } finally {
      setCloudPassword('');
      setCloudPasswordAgain('');
      setBusy(false);
    }
  };

  const resume = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await clientRef.current.resume({ baseUrl, online: browserOnline() });
      acceptRuntime(result);
    } catch (caught: any) {
      if (isDesktopIdentityNetworkFailure(caught)) {
        try {
          const vaultStatus = await clientRef.current.status();
          const fallback = resolveDesktopGateState({ vaultStatus, online: false, now: new Date() });
          if (canStartBusinessRuntime({ gateState: fallback })) {
            acceptRuntime({ gateState: fallback });
            return;
          }
        } catch (_fallbackError) {
          // Show the original network failure below.
        }
      }
      setError(messageForError(caught));
    } finally {
      setBusy(false);
    }
  };

  const lock = async () => {
    setBusy(true);
    try {
      await secureRelock({ kind: 'locked' });
      setError('');
    } catch (caught) {
      setError(messageForError(caught));
    } finally {
      setBusy(false);
    }
  };

  const returnToPasswordLogin = async () => {
    registrationFlowRef.current += 1;
    setBusy(true);
    setError('');
    try {
      await secureRelock({ kind: 'registration-required' });
      setPending(null);
    } catch (caught) {
      setError(messageForError(caught));
    } finally {
      setBusy(false);
    }
  };
  const performRoleSwitch = async (activeRole: string) => {
    const previousPartition = currentPartitionRef.current;
    setBusy(true);
    setError('');
    try {
      const switched = await clientRef.current.switchRole({
        baseUrl,
        currentSession: onlineSession,
        activeRole,
      });
      const vaultStatus = await clientRef.current.status();
      const next = resolveDesktopGateState({
        vaultStatus,
        online: true,
        onlineSession: switched,
        now: new Date(),
      });
      installIdentityContext(next);
      setOnlineSession(switched);
      setGateState(next);
      setRuntimeSuspended(false);
    } catch (caught) {
      if (previousPartition) {
        (window as any).dbService?.switchIdentityPartition?.(previousPartition);
      }
      setRuntimeSuspended(false);
      setError(messageForError(caught));
    } finally {
      setBusy(false);
    }
  };

  const renderRegistration = () => {
    if (!pending) {
      return (
        <>
          <Paragraph className="desktop-identity-copy">{'\u9996\u6b21\u767b\u5f55\u9700\u8981\u8054\u7f51\u3002\u8bf7\u9009\u62e9\u5fae\u4fe1\u767b\u5f55\uff0c\u6216\u4f7f\u7528\u624b\u673a\u53f7\u3001\u8d26\u53f7\u540d\u548c\u5bc6\u7801\u767b\u5f55\u3002'}</Paragraph>
          <Button icon={<WechatOutlined />} loading={busy} onClick={beginRegistration} block>{'\u5fae\u4fe1\u767b\u5f55'}</Button>
          <Divider plain>{'\u6216\u4f7f\u7528\u8d26\u53f7\u5bc6\u7801'}</Divider>
          <Select<'phone' | 'account_name'> value={accountLoginType} onChange={setAccountLoginType} options={[
            { value: 'phone', label: '\u624b\u673a\u53f7' },
            { value: 'account_name', label: '\u8d26\u53f7\u540d' },
          ]} />
          <Input value={accountLogin} onChange={event => setAccountLogin(event.target.value)} placeholder={accountLoginType === 'phone' ? '\u8f93\u5165\u624b\u673a\u53f7' : '\u8f93\u5165\u8d26\u53f7\u540d'} />
          <Input.Password value={accountPassword} onChange={event => setAccountPassword(event.target.value)} placeholder={'\u8f93\u5165\u5bc6\u7801'} onPressEnter={beginPasswordVerification} />
          <Button type="primary" loading={busy} onClick={beginPasswordVerification} block>{'\u5bc6\u7801\u767b\u5f55'}</Button>
        </>
      );
    }
    if (pending?.status === 'verified' && pending?.verificationToken) {
      const canEnrollCloudPassword = pending?.pairingId && pending?.recovery !== true;
      return (
        <>
          <Alert type="success" showIcon message={'\u767b\u5f55\u6210\u529f'} description={'\u6b63\u5728\u51c6\u5907\u5de5\u4f5c\u53f0\uff0c\u8bf7\u7a0d\u5019\u3002'} />
          {canEnrollCloudPassword && (
            <>
              <Input value={cloudLoginName} onChange={event => setCloudLoginName(event.target.value)} placeholder={'\u8bbe\u7f6e\u8d26\u53f7\u540d\uff08\u53ef\u9009\uff09'} maxLength={64} />
              <Input.Password prefix={<SafetyCertificateOutlined />} visibilityToggle value={cloudPassword} onChange={event => setCloudPassword(event.target.value)} placeholder={'\u8bbe\u7f6e\u767b\u5f55\u5bc6\u7801'} />
              <Input.Password prefix={<SafetyCertificateOutlined />} visibilityToggle value={cloudPasswordAgain} onChange={event => setCloudPasswordAgain(event.target.value)} placeholder={'\u518d\u6b21\u8f93\u5165\u767b\u5f55\u5bc6\u7801'} />
            </>
          )}
          <Button type="primary" loading={busy} onClick={completeRegistration} block>{'\u8fdb\u5165\u683c\u7269\u5de5\u574a'}</Button>
        </>
      );
    }
    return (
      <>
        <Paragraph className="desktop-identity-copy">{'\u8bf7\u5728\u5fae\u4fe1\u4e2d\u786e\u8ba4\u767b\u5f55\u3002'}</Paragraph>
        {pending.qrImageDataUrl ? <div className="desktop-identity-qr"><img src={pending.qrImageDataUrl} width={196} height={196} alt="identity verification code" /></div>
          : pending.qrValue ? <div className="desktop-identity-qr"><QRCode value={pending.qrValue} size={196} bordered={false} /></div> : null}
        <Button icon={<ReloadOutlined />} loading={polling} onClick={pollRegistration} block>{'\u5237\u65b0\u767b\u5f55\u72b6\u6001'}</Button>
        <Button loading={busy} onClick={returnToPasswordLogin} block>{'\u8fd4\u56de\u5bc6\u7801\u767b\u5f55'}</Button>
      </>
    );
  };
  if (canStartBusinessRuntime({ gateState })) {
    const eligibleRoles = onlineSession?.session?.eligibleRoles || gateState.eligibleRoles || [];
    const canElevate = gateState.kind === 'online-unlocked'
      && eligibleRoles.includes('super_admin')
      && gateState.activeRole !== 'super_admin';
    const canReturnTeacher = gateState.kind === 'online-unlocked'
      && eligibleRoles.includes('teacher')
      && gateState.activeRole !== 'teacher';
    const offlineRuntime = gateState.kind === 'offline-unlocked';
    return (
      <div className={`desktop-identity-runtime${offlineRuntime ? ' desktop-identity-runtime--offline' : ''}`}>
        {offlineRuntime && (
          <Alert
            className="desktop-identity-offline-banner"
            type="warning"
            banner
            showIcon
            message="当前为离线身份租约：可继续编辑本角色缓存，但不能同步、审核设备或执行主机写操作。"
          />
        )}
        <div className="desktop-identity-runtime-bar">
          <Space size={8} wrap>
            <SafetyCertificateOutlined />
            <Text>{onlineSession?.profile?.user?.name || '当前身份'}</Text>
            <Tag color={gateState.activeRole === 'super_admin' ? 'gold' : 'blue'}>
              {roleLabel(gateState.activeRole)}
            </Tag>
            {canElevate && <Button size="small" onClick={() => void performRoleSwitch('super_admin')} loading={busy}>{'\u5207\u6362\u4e3a\u8d85\u7ea7\u7ba1\u7406\u5458'}</Button>}
            {canReturnTeacher && <Button size="small" onClick={() => void performRoleSwitch('teacher')} loading={busy}>{'\u5207\u6362\u4e3a\u8001\u5e08'}</Button>}
            <Button size="small" icon={<LockOutlined />} onClick={lock} loading={busy}>{'\u9501\u5b9a'}</Button>
          </Space>
        </div>
        {error && <Alert className="desktop-identity-runtime-error" type="error" showIcon message={error} closable onClose={() => setError('')} />}
        {runtimeSuspended ? (
          <div className="desktop-identity-business-loading"><Spin tip="正在切换身份分区…" /></div>
        ) : (
          <Suspense fallback={<div className="desktop-identity-business-loading"><Spin tip="正在加载工作台…" /></div>}>
            <BusinessApp key={gateState.partitionKey} />
          </Suspense>
        )}
      </div>
    );
  }

  const locked = ['locked', 'online-authentication-required', 'offline-blocked'].includes(gateState.kind);
  return (
    <main className="desktop-identity-shell">
      <Card className="desktop-identity-card" bordered={false}>
        <header className="desktop-identity-header">
          <div className="desktop-identity-mark" aria-hidden="true">
            <SafetyCertificateOutlined />
          </div>
          <Title level={2} className="desktop-identity-title">{'\u767b\u5f55\u683c\u7269\u5de5\u574a'}</Title>
        </header>
        <Divider />
        <Space direction="vertical" size={16} className="desktop-identity-form">
          {gateState.kind === 'loading' && <Spin tip="正在检查本机身份…" />}
          {gateState.kind === 'upgrade-required' && (
            <Alert type="warning" showIcon message="需要升级旧版桌面授权" description="旧版配对信息不会自动迁移，请重新通过微信核验本人手机号。" />
          )}
          {[
            'registration-required', 'registration-active', 'registration-interrupted', 'upgrade-required',
            'password-reset-active', 'password-reset-interrupted',
          ].includes(gateState.kind)
            && renderRegistration()}
          {locked && (
            <>
              <Paragraph className="desktop-identity-copy">{'\u6b63\u5728\u6062\u590d\u53d7\u7cfb\u7edf\u4fdd\u62a4\u7684\u4e91\u7aef\u4f1a\u8bdd\u3002\u5982\u679c\u4f1a\u8bdd\u5931\u6548\uff0c\u8bf7\u8054\u7f51\u540e\u4f7f\u7528\u4e91\u7aef\u8d26\u53f7\u91cd\u65b0\u6838\u9a8c\u3002'}</Paragraph>
              <Button type="primary" loading={busy} onClick={resume} block>{'\u6062\u590d\u4f1a\u8bdd'}</Button>
            </>
          )}          {gateState.kind === 'offline-blocked' && (
            <Alert
              type="error"
              showIcon
              message="离线身份租约已过期"
              description={'\u8bf7\u8054\u7f51\u540e\u91cd\u65b0\u6838\u9a8c\u4e91\u7aef\u8d26\u53f7\u3002'}
            />
          )}
          {error && <Alert type="error" showIcon message={error} />}
        </Space>
      </Card>
    </main>
  );
};

export default DesktopIdentityGate;
