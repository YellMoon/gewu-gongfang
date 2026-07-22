import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Divider,
  Input,
  Modal,
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
import {
  discoverPairingCapability,
  normalizePairingCode,
  pollPairingResult,
  submitPairingRequest,
} from '../services/singleUserPairingClient.mjs';
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

function localPasswordValid(value: string): boolean {
  const bytes = new TextEncoder().encode(value || '').byteLength;
  return bytes >= 6 && bytes <= 1024;
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
  const passwordResetMessage = ({
    DESKTOP_PASSWORD_RESET_IDENTITY_MISMATCH: '\u5fae\u4fe1\u6838\u9a8c\u8eab\u4efd\u4e0e\u8fd9\u53f0\u7535\u8111\u539f\u6709\u8eab\u4efd\u4e0d\u4e00\u81f4\uff0c\u4e0d\u80fd\u91cd\u8bbe\u5bc6\u7801\u3002',
    DESKTOP_PASSWORD_RESET_DEVICE_NOT_ACTIVE: '\u8fd9\u53f0\u7535\u8111\u7684\u539f\u6388\u6743\u5df2\u5931\u6548\uff0c\u4e0d\u80fd\u901a\u8fc7\u5bc6\u7801\u91cd\u8bbe\u6062\u590d\u3002',
    DESKTOP_IDENTITY_PASSWORD_RESET_UNAVAILABLE: '\u5f53\u524d\u684c\u9762\u7248\u672c\u4e0d\u652f\u6301\u5b89\u5168\u91cd\u8bbe\u672c\u673a\u5bc6\u7801\u3002',
  } as Record<string, string>)[code];
  if (passwordResetMessage) return passwordResetMessage;
  return ({
    DESKTOP_IDENTITY_VAULT_UNLOCK_FAILED: '本机密码不正确，请重试。',
    DESKTOP_PHONE_REVERIFICATION_REQUIRED: '该设备需要重新通过微信核验手机号。',
    DESKTOP_DEVICE_NOT_ACTIVE: '该设备授权已被撤销或停用。',
    DESKTOP_SESSION_CHALLENGE_SIGNATURE_INVALID: '本机设备签名验证失败。',
    DESKTOP_REGISTRATION_NOT_APPROVED: '设备尚未获得审核通过。',
    PAIRING_API_BASE_REQUIRED: '尚未配置阿里云身份服务地址。',
    PAIRING_CODE_INVALID: '一次性配对码格式不正确，请检查后重试。',
    PAIRING_CODE_EXPIRED: '一次性配对码已过期，请在数据主机上重新生成。',
    PAIRING_CODE_USED: '一次性配对码已经使用，请在数据主机上重新生成。',
    PAIRING_CODE_LOCKED: '配对码尝试次数过多，已锁定，请在数据主机上重新生成。',
    PAIRING_HOST_OFFLINE: '暂时无法连接数据主机，请确认主机在线后重试。',
    PAIRING_CAPABILITY_STALE: '数据主机配对能力已过期，请重新生成配对码。',
    DESKTOP_DEVICE_FINGERPRINT_MISMATCH: '设备密钥指纹不一致，请取消本次配对并重新开始。',
    SINGLE_USER_MODE_DISABLED: '数据主机尚未启用临时单人模式。',
    DESKTOP_SINGLE_USER_MODE_DISABLED: '数据主机尚未启用临时单人模式。',
    LOCAL_BACKUP_FAILED: '初始化前本地备份失败，未修改身份或业务数据。',
    PRIMARY_HOST_LOCAL_BACKUP_FAILED: '初始化前本地备份失败，未修改身份或业务数据。',
  } as Record<string, string>)[code] || `身份验证未完成（${code}）`;
}

const DesktopIdentityGate: React.FC = () => {
  const [gateState, setGateState] = useState<GateState>({ kind: 'loading' });
  const [pending, setPending] = useState<any>(null);
  const [pairingPending, setPairingPending] = useState<any>(null);
  const [runtimeConfig, setRuntimeConfig] = useState<any>(null);
  const [hostIdentityStatus, setHostIdentityStatus] = useState<any>(null);
  const [pairingCode, setPairingCode] = useState('');
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
        setRuntimeConfig(config);
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
        if (config.buildFlavor === 'primary-host' && config.desktopIdentityMode === 'full') {
          setGateState({ kind: 'single-user-mode-offer' });
          return;
        }
        if (config.buildFlavor === 'primary-host' && config.desktopIdentityMode === 'single-user') {
          if (!window.singleUserRuntime?.status) throw new Error('SINGLE_USER_MODE_DISABLED');
          const status = await window.singleUserRuntime.status();
          if (cancelled) return;
          setHostIdentityStatus(status);
        }
        if (vaultStatus.state === 'empty') {
          setGateState({
            kind: config.buildFlavor === 'primary-host'
              ? 'single-user-host-bootstrap-required'
              : 'single-user-pairing-required',
          });
          return;
        }
        if ((vaultStatus.legacyUpgradeRequired || vaultStatus.state === 'legacy_upgrade_required')
          && config.buildFlavor === 'desktop-client') {
          setGateState({ kind: 'single-user-pairing-required' });
          return;
        }
        if (['registration_pending', 'password_reset_pending'].includes(vaultStatus.state)) {
          setGateState(config.buildFlavor === 'desktop-client'
            ? { kind: 'single-user-pairing-required' }
            : { kind: vaultStatus.state === 'password_reset_pending'
              ? 'password-reset-interrupted'
              : 'registration-interrupted' });
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

  const hostProfileFor = (result: any) => ({
    userId: result.actor.userId,
    user: { id: result.actor.userId, name: '\u672c\u673a\u6240\u6709\u8005' },
    eligibleRoles: result.actor.eligibleRoles,
    activeRole: result.actor.activeRole,
    teacherId: null,
    studentId: null,
  });

  const enableSingleUserMode = () => {
    Modal.confirm({
      title: '\u542f\u7528\u4e34\u65f6\u5355\u4eba\u6a21\u5f0f',
      content: '\u5f53\u524d\u4ec5\u7531\u4f60\u672c\u4eba\u4f7f\u7528\u684c\u9762\u7aef\u3002\u542f\u7528\u540e\uff0c\u666e\u901a\u684c\u9762\u7aef\u53ef\u51ed\u6570\u636e\u4e3b\u673a\u751f\u6210\u7684\u4e00\u6b21\u6027\u914d\u5bf9\u7801\u81ea\u52a8\u83b7\u6279\uff1b\u4e0d\u4f1a\u66f4\u6539\u5fae\u4fe1\u5c0f\u7a0b\u5e8f\u3002\u5e94\u7528\u9700\u8981\u91cd\u542f\u3002',
      okText: '\u786e\u8ba4\u542f\u7528\u5e76\u91cd\u542f',
      cancelText: '\u53d6\u6d88',
      async onOk() {
        setBusy(true);
        setError('');
        try {
          if (!window.singleUserRuntime?.enableMode) throw new Error('SINGLE_USER_MODE_DISABLED');
          await window.singleUserRuntime.enableMode({ confirmation: 'ENABLE_SINGLE_USER_MODE' });
          await window.api?.invoke('primary-host:restart');
        } catch (caught) {
          setError(messageForError(caught));
          setBusy(false);
          throw caught;
        }
      },
    });
  };

  const initializeSingleUserHost = async () => {
    if (!localPasswordValid(password)) {
      setError('\u672c\u673a\u5bc6\u7801\u81f3\u5c11\u9700\u8981 6 \u4e2a\u5b57\u7b26\u3002');
      return;
    }
    if (password !== passwordAgain) {
      setError('\u4e24\u6b21\u8f93\u5165\u7684\u672c\u673a\u5bc6\u7801\u4e0d\u4e00\u81f4\u3002');
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (!window.desktopIdentity?.beginSingleUserEnrollment || !window.singleUserRuntime?.bootstrap) {
        throw new Error('SINGLE_USER_MODE_DISABLED');
      }
      await clientRef.current?.lock();
      const publicIdentity = await window.desktopIdentity.beginSingleUserEnrollment({ deviceName });
      const initialized = await window.singleUserRuntime.bootstrap({
        publicIdentity,
        confirmation: 'SET_LOCAL_PASSWORD_CONFIRMED',
        operationManifest: { operation: 'single-user-bootstrap', requestedAt: new Date().toISOString() },
      });
      await window.desktopIdentity.completeRegistration({
        password,
        authorization: initialized.authorization,
        profile: hostProfileFor(initialized),
        offlineLease: null,
      });
      const result = await clientRef.current.unlock({
        baseUrl: String(runtimeConfig?.hostBaseUrl || 'http://127.0.0.1:3001'),
        password,
        online: true,
      });
      setPassword('');
      setPasswordAgain('');
      acceptRuntime(result);
    } catch (caught) {
      try { await clientRef.current?.lock(); } catch (_cleanupError) { /* best effort */ }
      setError(messageForError(caught));
    } finally {
      setBusy(false);
    }
  };

  const resetSingleUserHostPassword = async () => {
    if (!localPasswordValid(password)) {
      setError('\u672c\u673a\u5bc6\u7801\u81f3\u5c11\u9700\u8981 6 \u4e2a\u5b57\u7b26\u3002');
      return;
    }
    if (password !== passwordAgain) {
      setError('\u4e24\u6b21\u8f93\u5165\u7684\u672c\u673a\u5bc6\u7801\u4e0d\u4e00\u81f4\u3002');
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (!window.desktopIdentity?.beginPasswordReset || !window.singleUserRuntime?.resetHostPassword) {
        throw new Error('SINGLE_USER_MODE_DISABLED');
      }
      const publicIdentity = await window.desktopIdentity.beginPasswordReset();
      const reset = await window.singleUserRuntime.resetHostPassword({
        publicIdentity,
        confirmation: 'RESET_LOCAL_PASSWORD_CONFIRMED',
        expectedCredentialVersion: hostIdentityStatus?.epoch?.credentialVersion,
      });
      await window.desktopIdentity.completePasswordReset({
        password,
        authorization: reset.authorization,
        profile: hostProfileFor(reset),
        offlineLease: null,
      });
      const result = await clientRef.current.unlock({
        baseUrl: String(runtimeConfig?.hostBaseUrl || 'http://127.0.0.1:3001'),
        password,
        online: true,
      });
      setPassword('');
      setPasswordAgain('');
      acceptRuntime(result);
    } catch (caught) {
      try { await clientRef.current?.lock(); } catch (_cleanupError) { /* old sealed vault remains */ }
      setError(messageForError(caught));
    } finally {
      setBusy(false);
    }
  };

  const finishSingleUserPairing = useCallback(async (completed: any) => {
    const result = await clientRef.current.completeSingleUserPairing({
      password,
      result: completed.result,
      baseUrl: completed.channel === 'direct' ? completed.baseUrl : undefined,
      online: completed.channel === 'direct',
    });
    setPairingPending(null);
    setPairingCode('');
    setPassword('');
    setPasswordAgain('');
    acceptRuntime(result);
  }, [acceptRuntime, password]);

  const beginSingleUserPairing = async () => {
    if (!localPasswordValid(password)) {
      setError('\u672c\u673a\u5bc6\u7801\u81f3\u5c11\u9700\u8981 6 \u4e2a\u5b57\u7b26\u3002');
      return;
    }
    if (password !== passwordAgain) {
      setError('\u4e24\u6b21\u8f93\u5165\u7684\u672c\u673a\u5bc6\u7801\u4e0d\u4e00\u81f4\u3002');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const code = normalizePairingCode(pairingCode);
      if (!window.desktopIdentity?.beginSingleUserEnrollment || !window.desktopIdentity?.createPairingEnvelope) {
        throw new Error('DESKTOP_IDENTITY_BRIDGE_REQUIRED');
      }
      await clientRef.current?.lock();
      await window.desktopIdentity.beginSingleUserEnrollment({ deviceName });
      const discovery = await discoverPairingCapability({
        lanBaseUrl: runtimeConfig?.hostBaseUrl,
        cloudBaseUrl: baseUrl,
      });
      const envelope = await window.desktopIdentity.createPairingEnvelope({
        capability: discovery.capability,
        pairingCode: code,
      });
      const submitted = await submitPairingRequest({ discovery, envelope });
      setPairingPending(submitted);
      if (submitted.status === 'completed') await finishSingleUserPairing(submitted);
    } catch (caught) {
      setError(messageForError(caught));
    } finally {
      setBusy(false);
    }
  };

  const pollSingleUserPairing = useCallback(async () => {
    if (!pairingPending || pairingPending.status === 'completed' || pollingRef.current) return;
    pollingRef.current = true;
    setPolling(true);
    try {
      const next = await pollPairingResult({ pending: pairingPending });
      setPairingPending(next);
      if (next.status === 'completed') await finishSingleUserPairing(next);
    } catch (caught) {
      setError(messageForError(caught));
    } finally {
      pollingRef.current = false;
      setPolling(false);
    }
  }, [finishSingleUserPairing, pairingPending]);

  useEffect(() => {
    if (!pairingPending || pairingPending.status === 'completed') return undefined;
    const timer = window.setInterval(() => { void pollSingleUserPairing(); }, 2500);
    return () => window.clearInterval(timer);
  }, [pairingPending?.requestId, pairingPending?.status, pollSingleUserPairing]);

  const beginPasswordReset = async () => {
    if (!browserOnline()) {
      setError('\u91cd\u8bbe\u672c\u673a\u5bc6\u7801\u5fc5\u987b\u8054\u7f51\u5b8c\u6210\u5fae\u4fe1\u8eab\u4efd\u6838\u9a8c\u548c\u8bbe\u5907\u5ba1\u6838\u3002');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await clientRef.current.lock();
      const started = await clientRef.current.beginPasswordReset({ baseUrl });
      setPending(started);
      setPassword('');
      setPasswordAgain('');
      setGateState({ kind: 'password-reset-active' });
    } catch (caught) {
      try { await clientRef.current?.lock(); } catch (_cleanupError) { /* best effort */ }
      setPending(null);
      setGateState({ kind: 'locked' });
      setError(messageForError(caught));
    } finally {
      setBusy(false);
    }
  };

  const beginRecoveryFlow = async () => {
    if (runtimeConfig?.buildFlavor === 'primary-host'
      && runtimeConfig?.desktopIdentityMode === 'single-user') {
      setPassword('');
      setPasswordAgain('');
      setError('');
      setGateState({ kind: 'single-user-host-reset' });
      return;
    }
    if (runtimeConfig?.buildFlavor === 'desktop-client') {
      try { await clientRef.current?.lock(); } catch (_error) { /* sealed vault remains unchanged */ }
      setPairingPending(null);
      setPairingCode('');
      setPassword('');
      setPasswordAgain('');
      setError('');
      setGateState({ kind: 'single-user-pairing-required' });
      return;
    }
    await beginPasswordReset();
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
    const passwordReset = pending?.challenge?.purpose === 'password_reset'
      || gateState.kind.startsWith('password-reset');
    setBusy(true);
    setError('');
    try {
      await secureRelock({ kind: passwordReset ? 'locked' : 'registration-required' });
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
    const passwordReset = pending?.challenge?.purpose === 'password_reset'
      || gateState.kind.startsWith('password-reset');
    if (!pending && passwordReset) {
      return (
        <>
          <Alert
            type="warning"
            showIcon
            message={'\u5bc6\u7801\u91cd\u8bbe\u6d41\u7a0b\u5df2\u4e2d\u65ad'}
            description={'\u65e7\u4fdd\u9669\u5e93\u548c\u672c\u673a\u6570\u636e\u5747\u672a\u6539\u52a8\u3002\u8bf7\u8fd4\u56de\u89e3\u9501\u9875\u540e\u91cd\u65b0\u53d1\u8d77\uff1b\u82e5\u670d\u52a1\u7aef\u4ecd\u6709\u5f85\u5ba1\u7533\u8bf7\uff0c\u53ef\u7b49\u5f85\u5176\u8fc7\u671f\u6216\u8bf7\u7ba1\u7406\u5458\u62d2\u7edd\u3002'}
          />
          <Button onClick={retryRegistration} block>{'\u8fd4\u56de\u672c\u673a\u5bc6\u7801\u89e3\u9501'}</Button>
        </>
      );
    }
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
      const resetNotice = passwordReset ? (
        <Alert
          type="warning"
          showIcon
          message={'\u540c\u4e00\u8bbe\u5907\u7684\u5bc6\u7801\u91cd\u8bbe\u5df2\u83b7\u6279\u51c6'}
          description={'\u4fdd\u5b58\u6210\u529f\u540e\u53ea\u8f6e\u6362\u8bbe\u5907\u5bc6\u94a5\u4e0e\u672c\u673a\u5bc6\u7801\uff0c\u4e0d\u4f1a\u5220\u9664\u672c\u673a\u6570\u636e\u6216\u5f85\u540c\u6b65\u53d8\u66f4\uff1b\u4fdd\u5b58\u6210\u529f\u524d\u65e7\u4fdd\u9669\u5e93\u4e0d\u4f1a\u88ab\u8986\u76d6\u3002'}
        />
      ) : null;
      return (
        <>
          {resetNotice}
          <Alert type="success" showIcon message="设备审核已通过" description="请为这台电脑设置独立的本机密码。" />
          <Input.Password
            prefix={<LockOutlined />}
            visibilityToggle
            value={password}
            onChange={event => setPassword(event.target.value)}
            placeholder="至少 6 个字符"
            onPressEnter={completeRegistration}
          />
          <Input.Password
            prefix={<LockOutlined />}
            visibilityToggle
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
        {pending.qrImageDataUrl ? (
          <div className="desktop-identity-qr">
            <img src={pending.qrImageDataUrl} width={196} height={196} alt="微信小程序身份核验码" />
          </div>
        ) : pending.qrValue ? (
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
          {gateState.kind === 'single-user-mode-offer' && (
            <>
              <Alert
                type="warning"
                showIcon
                message={'\u542f\u7528\u4e34\u65f6\u5355\u4eba\u6a21\u5f0f'}
                description={'\u6b64\u6a21\u5f0f\u4ec5\u9002\u7528\u4e8e\u5f53\u524d\u684c\u9762\u7aef\u53ea\u7531\u4f60\u672c\u4eba\u4f7f\u7528\u7684\u9636\u6bb5\u3002\u666e\u901a\u684c\u9762\u7aef\u4ecd\u9700\u4e00\u6b21\u6027\u914d\u5bf9\u7801\uff0c\u4e0d\u4f1a\u81ea\u52a8\u53d8\u6210\u6570\u636e\u4e3b\u673a\u3002'}
              />
              <Button type="primary" loading={busy} onClick={enableSingleUserMode} block>
                {'\u542f\u7528\u4e34\u65f6\u5355\u4eba\u6a21\u5f0f'}
              </Button>
            </>
          )}
          {gateState.kind === 'single-user-host-bootstrap-required' && (
            <>
              <Alert
                type="info"
                showIcon
                message={'\u5355\u4eba\u6a21\u5f0f\u521d\u59cb\u5316'}
                description={'\u521d\u59cb\u5316\u524d\u4f1a\u5907\u4efd\uff0c\u4e0d\u4f1a\u5220\u9664\u6570\u636e\u3002\u53ea\u4f1a\u4e3a\u5f53\u524d\u6570\u636e\u4e3b\u673a\u5efa\u7acb\u672c\u673a\u8eab\u4efd\u548c\u5bc6\u7801\u3002'}
              />
              <Input value={deviceName} onChange={event => setDeviceName(event.target.value)} placeholder={'\u6570\u636e\u4e3b\u673a\u540d\u79f0'} maxLength={128} />
              <Input.Password prefix={<LockOutlined />} visibilityToggle value={password} onChange={event => setPassword(event.target.value)} placeholder={'\u8bbe\u7f6e\u672c\u673a\u5bc6\u7801\uff08\u81f3\u5c11 6 \u4e2a\u5b57\u7b26\uff09'} />
              <Input.Password prefix={<LockOutlined />} visibilityToggle value={passwordAgain} onChange={event => setPasswordAgain(event.target.value)} placeholder={'\u518d\u6b21\u8f93\u5165\u672c\u673a\u5bc6\u7801'} onPressEnter={initializeSingleUserHost} />
              <Button type="primary" loading={busy} onClick={initializeSingleUserHost} block>{'\u5907\u4efd\u5e76\u5b8c\u6210\u521d\u59cb\u5316'}</Button>
            </>
          )}
          {gateState.kind === 'single-user-host-reset' && (
            <>
              <Alert
                type="warning"
                showIcon
                message={'\u91cd\u65b0\u6838\u9a8c\u8eab\u4efd\u5e76\u91cd\u8bbe\u5bc6\u7801'}
                description={'\u53ea\u8f6e\u6362\u5f53\u524d\u4e3b\u673a\u7684\u8bbe\u5907\u5bc6\u94a5\u4e0e\u672c\u673a\u5bc6\u7801\uff0c\u4e0d\u4f1a\u5220\u9664\u672c\u673a\u6570\u636e\u3001\u5f85\u540c\u6b65\u53d8\u66f4\u6216\u9898\u5e93\u3002'}
              />
              <Input.Password prefix={<LockOutlined />} visibilityToggle value={password} onChange={event => setPassword(event.target.value)} placeholder={'\u8bbe\u7f6e\u65b0\u7684\u672c\u673a\u5bc6\u7801'} />
              <Input.Password prefix={<LockOutlined />} visibilityToggle value={passwordAgain} onChange={event => setPasswordAgain(event.target.value)} placeholder={'\u518d\u6b21\u8f93\u5165\u65b0\u5bc6\u7801'} onPressEnter={resetSingleUserHostPassword} />
              <Button type="primary" loading={busy} onClick={resetSingleUserHostPassword} block>{'\u786e\u8ba4\u8eab\u4efd\u5e76\u91cd\u8bbe'}</Button>
              <Button onClick={() => setGateState({ kind: 'locked' })} block>{'\u8fd4\u56de\u89e3\u9501'}</Button>
            </>
          )}
          {gateState.kind === 'single-user-pairing-required' && (
            pairingPending ? (
              <>
                <Alert
                  type="info"
                  showIcon
                  message={pairingPending.status === 'completed'
                    ? '\u914d\u5bf9\u51ed\u636e\u5df2\u5b89\u5168\u53d6\u56de'
                    : '\u914d\u5bf9\u8bf7\u6c42\u5df2\u53d1\u51fa\uff0c\u6b63\u5728\u7b49\u5f85\u6570\u636e\u4e3b\u673a\u81ea\u52a8\u6279\u51c6'}
                  description={pairingPending.channel === 'direct' ? '\u5c40\u57df\u7f51\u76f4\u8fde' : '\u963f\u91cc\u4e91\u52a0\u5bc6\u4e2d\u7ee7'}
                />
                <Button
                  icon={<ReloadOutlined />}
                  loading={polling || busy}
                  onClick={() => void (pairingPending.status === 'completed'
                    ? finishSingleUserPairing(pairingPending)
                    : pollSingleUserPairing())}
                  block
                >
                  {pairingPending.status === 'completed'
                    ? '\u4fdd\u5b58\u672c\u673a\u51ed\u636e\u5e76\u8fdb\u5165'
                    : '\u7acb\u5373\u68c0\u67e5\u6279\u51c6\u7ed3\u679c'}
                </Button>
              </>
            ) : (
              <>
                <Paragraph className="desktop-identity-copy">
                  {'\u8f93\u5165\u6570\u636e\u4e3b\u673a\u751f\u6210\u7684\u4e00\u6b21\u6027\u914d\u5bf9\u7801\u3002\u672c\u673a\u5c06\u81ea\u884c\u751f\u6210\u8bbe\u5907\u5bc6\u94a5\uff0c\u5bc6\u94a5\u548c\u914d\u5bf9\u7801\u660e\u6587\u90fd\u4e0d\u4f1a\u4e0a\u4f20\u3002'}
                </Paragraph>
                <Input value={deviceName} onChange={event => setDeviceName(event.target.value)} placeholder={'\u8bbe\u5907\u540d\u79f0\uff0c\u4f8b\u5982\uff1a\u5bb6\u91cc\u7535\u8111'} maxLength={128} />
                <Input value={pairingCode} onChange={event => setPairingCode(event.target.value)} placeholder={'\u8f93\u5165\u4e00\u6b21\u6027\u914d\u5bf9\u7801'} maxLength={24} autoComplete="one-time-code" />
                <Input.Password prefix={<LockOutlined />} visibilityToggle value={password} onChange={event => setPassword(event.target.value)} placeholder={'\u4e3a\u8fd9\u53f0\u7535\u8111\u8bbe\u7f6e\u672c\u673a\u5bc6\u7801'} />
                <Input.Password prefix={<LockOutlined />} visibilityToggle value={passwordAgain} onChange={event => setPasswordAgain(event.target.value)} placeholder={'\u518d\u6b21\u8f93\u5165\u672c\u673a\u5bc6\u7801'} onPressEnter={beginSingleUserPairing} />
                <Text type="secondary">{'\u6bcf\u53f0\u7535\u8111\u7684\u672c\u673a\u5bc6\u7801\u76f8\u4e92\u72ec\u7acb\uff1b\u914d\u5bf9\u6210\u529f\u540e\u4e0d\u4f1a\u81ea\u52a8\u53d1\u8d77\u6570\u636e\u540c\u6b65\u3002'}</Text>
                <Button type="primary" loading={busy} onClick={beginSingleUserPairing} block>{'\u9a8c\u8bc1\u914d\u5bf9\u7801\u5e76\u8fdb\u5165'}</Button>
              </>
            )
          )}
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
              <Paragraph className="desktop-identity-copy">
                请输入本机密码。联网时将同时完成设备私钥挑战；断网时只在有效离线身份租约内进入。
              </Paragraph>
              <Input.Password
                prefix={<LockOutlined />}
                visibilityToggle
                value={password}
                onChange={event => setPassword(event.target.value)}
                placeholder="请输入本机密码"
                onPressEnter={unlock}
                autoFocus
              />
              <Text type="secondary">{'\u5bc6\u7801\u6846\u53f3\u4fa7\u7684\u773c\u775b\u6309\u94ae\u53ea\u663e\u793a\u672c\u6b21\u8f93\u5165\uff0c\u4e0d\u80fd\u663e\u793a\u5386\u53f2\u5bc6\u7801\u3002'}</Text>
              <Button type="link" loading={busy} onClick={() => void beginRecoveryFlow()} block>
                {'\u5fd8\u8bb0\u672c\u673a\u5bc6\u7801\uff1f\u91cd\u65b0\u6838\u9a8c\u8eab\u4efd\u5e76\u91cd\u8bbe'}
              </Button>
              <Text type="secondary">
                {runtimeConfig?.buildFlavor === 'desktop-client'
                  ? '\u5fd8\u8bb0\u5bc6\u7801\u65f6\u9700\u8981\u6570\u636e\u4e3b\u673a\u751f\u6210\u65b0\u7684\u4e00\u6b21\u6027\u914d\u5bf9\u7801\uff1b\u4e0d\u4f1a\u5220\u9664\u672c\u673a\u6570\u636e\u6216\u5f85\u540c\u6b65\u53d8\u66f4\u3002'
                  : runtimeConfig?.desktopIdentityMode === 'single-user'
                    ? '\u6570\u636e\u4e3b\u673a\u5c06\u5728\u672c\u673a\u91cd\u65b0\u6838\u9a8c\u5e76\u8f6e\u6362\u5bc6\u94a5\uff1b\u4e0d\u4f1a\u5220\u9664\u672c\u673a\u6570\u636e\u6216\u5f85\u540c\u6b65\u53d8\u66f4\u3002'
                    : '\u91cd\u8bbe\u9700\u8054\u7f51\u3001\u5fae\u4fe1\u9a8c\u8bc1\u672c\u4eba\u624b\u673a\u53f7\u5e76\u7531\u53e6\u4e00\u53f0\u5df2\u6388\u6743\u8bbe\u5907\u6279\u51c6\uff1b\u4e0d\u4f1a\u5220\u9664\u672c\u673a\u6570\u636e\u6216\u5f85\u540c\u6b65\u53d8\u66f4\u3002'}
              </Text>
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
