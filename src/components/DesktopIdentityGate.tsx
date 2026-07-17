import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Divider,
  Input,
  QRCode,
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
import { resolveManagedSyncConfig } from '../services/managedSyncConfig.mjs';
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
  const code = String(error?.code || error?.message || 'DESKTOP_IDENTITY_FAILED');
  return ({
    DESKTOP_IDENTITY_VAULT_UNLOCK_FAILED: '本机密码不正确，请重试。',
    DESKTOP_PHONE_REVERIFICATION_REQUIRED: '该设备需要重新通过微信核验手机号。',
    DESKTOP_DEVICE_NOT_ACTIVE: '该设备授权已被撤销或停用。',
    DESKTOP_SESSION_CHALLENGE_SIGNATURE_INVALID: '本机设备签名验证失败。',
    DESKTOP_REGISTRATION_NOT_APPROVED: '设备尚未获得审核通过。',
    PAIRING_API_BASE_REQUIRED: '尚未配置阿里云身份服务地址。',
  } as Record<string, string>)[code] || `身份验证未完成（${code}）`;
}

const DesktopIdentityGate: React.FC = () => {
  const [gateState, setGateState] = useState<GateState>({ kind: 'loading' });
  const [pending, setPending] = useState<any>(null);
  const [onlineSession, setOnlineSession] = useState<any>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [password, setPassword] = useState('');
  const [passwordAgain, setPasswordAgain] = useState('');
  const [elevationPassword, setElevationPassword] = useState('');
  const [showElevation, setShowElevation] = useState(false);
  const [busy, setBusy] = useState(false);
  const [polling, setPolling] = useState(false);
  const [runtimeSuspended, setRuntimeSuspended] = useState(false);
  const [error, setError] = useState('');
  const clientRef = useRef<any>(null);
  const currentPartitionRef = useRef<string | null>(null);
  const pollingRef = useRef(false);

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
    setOnlineSession(result.token ? {
      token: result.token,
      expiresAt: result.expiresAt,
      session: result.session,
      profile: result.profile,
    } : null);
    setGateState(next);
    setRuntimeSuspended(false);
    setError('');
  }, [installIdentityContext]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!window.desktopIdentity) throw new Error('DESKTOP_IDENTITY_BRIDGE_REQUIRED');
        const config = await getRuntimeConfig();
        const managed = resolveManagedSyncConfig(config);
        const identityBaseUrl = String(managed.cloudBaseUrl || '').replace(/\/+$/, '');
        if (!identityBaseUrl) throw new Error('PAIRING_API_BASE_REQUIRED');
        const client = createDesktopIdentityClient({
          desktopIdentity: window.desktopIdentity,
          clearRoleCache: suspendBusinessMemory,
        });
        const vaultStatus = await client.status();
        if (cancelled) return;
        clientRef.current = client;
        setBaseUrl(identityBaseUrl);
        setDeviceName(String((config as any).deviceName || config.deviceId || '这台电脑'));
        if (vaultStatus.state === 'registration_pending') {
          setGateState({ kind: 'registration-interrupted' });
          return;
        }
        const next = resolveDesktopGateState({
          vaultStatus,
          online: browserOnline(),
          onlineSession: null,
          now: new Date(),
        });
        if (canStartBusinessRuntime({ gateState: next })) {
          acceptRuntime({ gateState: next });
        } else {
          setGateState(next);
        }
      } catch (caught) {
        if (!cancelled) setError(messageForError(caught));
      }
    })();
    return () => { cancelled = true; };
  }, [acceptRuntime, suspendBusinessMemory]);

  const pollRegistration = useCallback(async () => {
    if (!pending || pollingRef.current || !clientRef.current) return;
    pollingRef.current = true;
    setPolling(true);
    try {
      const next = await clientRef.current.pollRegistration(pending);
      setPending(next);
      setError('');
    } catch (caught) {
      setError(messageForError(caught));
    } finally {
      pollingRef.current = false;
      setPolling(false);
    }
  }, [pending]);

  useEffect(() => {
    const status = pending?.challenge?.status;
    if (!['pending_phone', 'identity_verified_pending_approval'].includes(status)) return undefined;
    const timer = window.setInterval(() => { void pollRegistration(); }, 3000);
    return () => window.clearInterval(timer);
  }, [pending?.challenge?.status, pollRegistration]);

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
    setBusy(true);
    setError('');
    try {
      if (gateState.kind === 'registration-interrupted') await clientRef.current.lock();
      const started = await clientRef.current.beginRegistration({ baseUrl, deviceName });
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

  const completeRegistration = async () => {
    if (password !== passwordAgain) {
      setError('两次输入的本机密码不一致。');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await clientRef.current.completeRegistration({ pending, password });
      setPassword('');
      setPasswordAgain('');
      acceptRuntime(result);
    } catch (caught) {
      setError(messageForError(caught));
    } finally {
      setBusy(false);
    }
  };

  const unlock = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await clientRef.current.unlock({ baseUrl, password, online: browserOnline() });
      setPassword('');
      acceptRuntime(result);
    } catch (caught: any) {
      if (isDesktopIdentityNetworkFailure(caught)) {
        try {
          const vaultStatus = await clientRef.current.status();
          const fallback = resolveDesktopGateState({
            vaultStatus,
            online: false,
            now: new Date(),
          });
          if (canStartBusinessRuntime({ gateState: fallback })) {
            setPassword('');
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

  const retryRegistration = async () => {
    setBusy(true);
    setError('');
    try {
      await secureRelock({ kind: 'registration-required' });
      setPending(null);
      setPassword('');
      setPasswordAgain('');
    } catch (caught) {
      setError(messageForError(caught));
    } finally {
      setBusy(false);
    }
  };

  const performRoleSwitch = async (activeRole: string, rolePassword?: string) => {
    const previousPartition = currentPartitionRef.current;
    setBusy(true);
    setError('');
    try {
      const switched = await clientRef.current.switchRole({
        baseUrl,
        currentSession: onlineSession,
        activeRole,
        ...(rolePassword ? { password: rolePassword } : {}),
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
      setElevationPassword('');
      setShowElevation(false);
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
          <Paragraph className="desktop-identity-copy">
            首次在这台电脑使用时，需要用微信扫码并重新核验本人手机号。申请只绑定这台设备，
            不会让电脑自行选择账号或角色。
          </Paragraph>
          <Input
            value={deviceName}
            onChange={event => setDeviceName(event.target.value)}
            placeholder="设备名称，例如：办公室主机"
            maxLength={128}
          />
          <Button type="primary" icon={<WechatOutlined />} loading={busy} onClick={beginRegistration} block>
            {gateState.kind === 'registration-interrupted' ? '重新开始微信身份注册' : '开始微信身份注册'}
          </Button>
        </>
      );
    }
    const view = registrationViewForChallenge(pending.challenge);
    if (view.kind === 'password-setup-required') {
      return (
        <>
          <Alert type="success" showIcon message="设备审核已通过" description="请为这台电脑设置独立的本机密码。" />
          <Input.Password
            prefix={<LockOutlined />}
            value={password}
            onChange={event => setPassword(event.target.value)}
            placeholder="至少 6 个字符"
            onPressEnter={completeRegistration}
          />
          <Input.Password
            prefix={<LockOutlined />}
            value={passwordAgain}
            onChange={event => setPasswordAgain(event.target.value)}
            placeholder="再次输入本机密码"
            onPressEnter={completeRegistration}
          />
          <Text type="secondary">密码只用于解锁这台电脑，不上传、不跨电脑同步。</Text>
          <Button type="primary" loading={busy} onClick={completeRegistration} block>
            保存本机密码并进入
          </Button>
        </>
      );
    }
    if (['registration-rejected', 'registration-expired'].includes(view.kind)) {
      const expired = view.kind === 'registration-expired';
      return (
        <>
          <Alert
            type="error"
            showIcon
            message={expired ? '设备申请已过期' : '设备申请未通过'}
            description={expired ? '本次二维码已失效，请重新发起申请。' : '请确认申请信息或联系超级管理员后重新申请。'}
          />
          <Button icon={<ReloadOutlined />} loading={busy} onClick={retryRegistration} block>
            重新发起微信身份注册
          </Button>
        </>
      );
    }
    return (
      <>
        {pending.qrValue ? (
          <div className="desktop-identity-qr">
            <QRCode value={pending.qrValue} size={196} bordered={false} />
          </div>
        ) : (
          <Alert type="info" showIcon message="微信扫码入口尚未配置" description="可先在小程序中输入下方设备码；正式扫码入口将在小程序授权页启用。" />
        )}
        {pending.challenge?.shortCode && (
          <div className="desktop-identity-code" aria-label="设备申请码">
            {pending.challenge.shortCode}
          </div>
        )}
        {view.kind === 'phone-verification-required' ? (
          <Paragraph>请在微信小程序中完成手机号核验。本机不会读取或保存手机号。</Paragraph>
        ) : (
          <Alert
            type="warning"
            showIcon
            message="等待另一台已授权设备审核"
            description="审核人只能确认或拒绝这次申请，不能替你选择其他账号。"
          />
        )}
        <Button icon={<ReloadOutlined />} loading={polling} onClick={pollRegistration} block>
          刷新申请状态
        </Button>
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
    return (
      <div className="desktop-identity-runtime">
        {gateState.kind === 'offline-unlocked' && (
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
            {canElevate && (
              <Button size="small" onClick={() => setShowElevation(value => !value)}>
                切换为超级管理员
              </Button>
            )}
            {canReturnTeacher && (
              <Button size="small" onClick={() => void performRoleSwitch('teacher')} loading={busy}>
                切换为老师
              </Button>
            )}
            <Button size="small" icon={<LockOutlined />} onClick={lock} loading={busy}>锁定</Button>
          </Space>
          {showElevation && (
            <Space.Compact className="desktop-identity-elevation">
              <Input.Password
                value={elevationPassword}
                onChange={event => setElevationPassword(event.target.value)}
                placeholder="再次输入本机密码"
                onPressEnter={() => void performRoleSwitch('super_admin', elevationPassword)}
              />
              <Button
                type="primary"
                loading={busy}
                onClick={() => void performRoleSwitch('super_admin', elevationPassword)}
              >
                验证并切换
              </Button>
            </Space.Compact>
          )}
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
        <div className="desktop-identity-mark"><SafetyCertificateOutlined /></div>
        <Title level={2}>格物工坊身份验证</Title>
        <Paragraph type="secondary">
          同一个人可以同时拥有超级管理员和老师身份；每台电脑分别注册、分别撤销。
        </Paragraph>
        <Divider />
        <Space direction="vertical" size={16} className="desktop-identity-form">
          {gateState.kind === 'loading' && <Spin tip="正在检查本机身份…" />}
          {gateState.kind === 'upgrade-required' && (
            <Alert type="warning" showIcon message="需要升级旧版桌面授权" description="旧版配对信息不会自动迁移，请重新通过微信核验本人手机号。" />
          )}
          {['registration-required', 'registration-active', 'registration-interrupted', 'upgrade-required'].includes(gateState.kind)
            && renderRegistration()}
          {locked && (
            <>
              <Paragraph className="desktop-identity-copy">
                请输入本机密码。联网时将同时完成设备私钥挑战；断网时只在有效离线身份租约内进入。
              </Paragraph>
              <Input.Password
                prefix={<LockOutlined />}
                value={password}
                onChange={event => setPassword(event.target.value)}
                placeholder="请输入本机密码"
                onPressEnter={unlock}
                autoFocus
              />
              <Button type="primary" loading={busy} onClick={unlock} block>验证并进入</Button>
              <Text type="secondary">这不是云端通用密码；另一台电脑需要设置自己的本机密码。</Text>
            </>
          )}
          {gateState.kind === 'offline-blocked' && (
            <Alert
              type="error"
              showIcon
              message="离线身份租约已过期"
              description="请连接网络后重新输入本机密码，完成设备签名验证。"
            />
          )}
          {error && <Alert type="error" showIcon message={error} />}
        </Space>
      </Card>
    </main>
  );
};

export default DesktopIdentityGate;
