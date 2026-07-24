import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Descriptions, Empty, Input, Modal, QRCode, Space, Spin, Table, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { getRuntimeConfig } from '../services/runtimeConfigClient';
import { readDesktopAuthorizationSession } from '../services/desktopAuthorizationSession.mjs';
import { resolveDesktopIdentityBaseUrl } from '../services/managedSyncConfig.mjs';
import { publishCloudHeartbeat } from '../services/cloudRelayHostApi';
import {
  approveDesktopChallenge,
  activatePrimaryHostTransfer,
  beginPrimaryHostTransfer,
  bootstrapPrimaryHost,
  buildApprovalBody,
  buildRejectionBody,
  buildRevocationBody,
  identityDeviceCenterErrorMessage,
  loadIdentityDeviceCenter,
  readPrimaryHostOperationChallenge,
  recoverPrimaryHost,
  rejectDesktopChallenge,
  revokeDesktopDevice,
  startPrimaryHostOperation,
} from '../services/identityDeviceCenterPolicy.mjs';
import './IdentityDeviceCenter.css';

type ViewState = 'loading' | 'ready' | 'empty' | 'offline' | 'expired' | 'conflict' | 'concurrent' | 'revoked' | 'error';

const roleLabels: Record<string, string> = {
  super_admin: '超级管理员', admin: '普通管理员', teacher: '老师', student: '学生', parent: '家长',
};
const deviceStatusLabels: Record<string, string> = {
  active: '可信', revoked: '已撤销', replaced: '已被替换', retired: '已退役', pending: '待处理',
};

function localTime(value?: string | null): string {
  if (!value) return '--';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { hour12: false }) : '--';
}

function stateForError(error: any): ViewState {
  const code = String(error?.code || '');
  if (globalThis.navigator?.onLine === false || error?.name === 'TypeError') return 'offline';
  if (code.includes('EXPIRED')) return 'expired';
  if (code.includes('CONFLICT')) return 'conflict';
  if (code.includes('STALE') || code.includes('VERSION')) return 'concurrent';
  if (code.includes('REVOKED') || code === 'DESKTOP_DEVICE_NOT_ACTIVE') return 'revoked';
  return 'error';
}

const IdentityDeviceCenter: React.FC = () => {
  const [snapshot, setSnapshot] = useState<any>(null);
  const [viewState, setViewState] = useState<ViewState>('loading');
  const [errorCode, setErrorCode] = useState('');
  const [operationKey, setOperationKey] = useState('');
  const [hostOperation, setHostOperation] = useState<any>(null);
  const [hostPassword, setHostPassword] = useState('');
  const [factorId, setFactorId] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [hostOperationError, setHostOperationError] = useState('');
  const [pendingRecoveryDelivery, setPendingRecoveryDelivery] = useState<any>(null);
  const [revealedRecoveryPackage, setRevealedRecoveryPackage] = useState<any>(null);
  const [runtimeConfigState, setRuntimeConfigState] = useState<any>(null);
  const [singleUserPairingGrant, setSingleUserPairingGrant] = useState<any>(null);
  const [pairingSecondsRemaining, setPairingSecondsRemaining] = useState(0);
  const operationRef = useRef('');
  const requestContextRef = useRef<any>(null);

  const load = useCallback(async () => {
    setViewState('loading');
    setErrorCode('');
    try {
      const runtimeConfig = await getRuntimeConfig();
      setRuntimeConfigState(runtimeConfig);
      const session = readDesktopAuthorizationSession();
      const baseUrl = resolveDesktopIdentityBaseUrl(runtimeConfig);
      const primaryHostRuntime = (window as any).primaryHostRuntime;
      let hostRuntimeStatus = null;
      try {
        hostRuntimeStatus = primaryHostRuntime?.status
          ? await primaryHostRuntime.status()
          : null;
      } catch (_error) { /* cloud state remains readable when local runtime status is unavailable */ }
      requestContextRef.current = { runtimeConfig, session, baseUrl };
      const next = await loadIdentityDeviceCenter({ runtimeConfig, session, baseUrl, hostRuntimeStatus });
      const localRecoveryDelivery = hostRuntimeStatus?.credential?.recoveryDelivery;
      if (localRecoveryDelivery?.pending) {
        setPendingRecoveryDelivery(localRecoveryDelivery);
      } else {
        setPendingRecoveryDelivery(null);
        setRevealedRecoveryPackage(null);
      }
      setSnapshot(next);
      setViewState(next.mine.length || next.pending.length || next.all.length ? 'ready' : 'empty');
      window.dispatchEvent(new CustomEvent('identity-device-center-updated', {
        detail: { pendingCount: next.pending.length },
      }));
    } catch (error: any) {
      setErrorCode(error?.code || 'DESKTOP_DEVICE_CENTER_REQUEST_FAILED');
      setViewState(stateForError(error));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!singleUserPairingGrant?.expiresAt) {
      setPairingSecondsRemaining(0);
      return undefined;
    }
    const update = () => setPairingSecondsRemaining(Math.max(
      0,
      Math.ceil((Date.parse(singleUserPairingGrant.expiresAt) - Date.now()) / 1000)
    ));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [singleUserPairingGrant?.expiresAt]);

  const runOperation = async (key: string, work: () => Promise<any>, successText: string) => {
    if (operationRef.current) return;
    operationRef.current = key;
    setOperationKey(key);
    setErrorCode('');
    try {
      await work();
      message.success(successText);
      await load();
    } catch (error: any) {
      setErrorCode(error?.code || 'DESKTOP_DEVICE_CENTER_REQUEST_FAILED');
      setViewState(stateForError(error));
      throw error;
    } finally {
      operationRef.current = '';
      setOperationKey('');
    }
  };

  const issueSingleUserPairingCode = async () => {
    if (operationRef.current) return;
    operationRef.current = 'single-user:pairing:issue';
    setOperationKey(operationRef.current);
    setErrorCode('');
    try {
      const singleUserRuntime = (window as any).singleUserRuntime;
      if (!singleUserRuntime?.issuePairingCode) throw Object.assign(new Error('SINGLE_USER_MODE_DISABLED'), { code: 'SINGLE_USER_MODE_DISABLED' });
      const response = await singleUserRuntime.issuePairingCode();
      setSingleUserPairingGrant(response.grant);
      let cloudPublished = false;
      try {
        const heartbeat = await publishCloudHeartbeat();
        cloudPublished = heartbeat?.success !== false;
      } catch (_cloudError) {
        cloudPublished = false;
      }
      if (cloudPublished) {
        message.success('\u4e00\u6b21\u6027\u914d\u5bf9\u7801\u5df2\u751f\u6210\uff0c\u4e91\u4e2d\u7ee7\u5df2\u5c31\u7eea');
      } else {
        message.warning('\u914d\u5bf9\u7801\u5df2\u751f\u6210\uff0c\u4f46\u4e91\u4e2d\u7ee7\u6682\u672a\u5c31\u7eea\uff1b\u5c40\u57df\u7f51\u53ef\u76f4\u63a5\u4f7f\u7528\uff0c\u4e91\u7aef\u5c06\u81ea\u52a8\u91cd\u8bd5');
      }
    } catch (error: any) {
      setErrorCode(error?.code || 'DESKTOP_PAIRING_GRANT_FAILED');
    } finally {
      operationRef.current = '';
      setOperationKey('');
    }
  };

  const revokeSingleUserPairingCode = async () => {
    if (operationRef.current || !singleUserPairingGrant?.id) return;
    operationRef.current = 'single-user:pairing:revoke';
    setOperationKey(operationRef.current);
    try {
      const singleUserRuntime = (window as any).singleUserRuntime;
      if (!singleUserRuntime?.revokePairingCode) throw Object.assign(new Error('SINGLE_USER_MODE_DISABLED'), { code: 'SINGLE_USER_MODE_DISABLED' });
      await singleUserRuntime.revokePairingCode({ grantId: singleUserPairingGrant.id });
      setSingleUserPairingGrant(null);
      message.success('\u5f53\u524d\u914d\u5bf9\u7801\u5df2\u64a4\u9500');
    } catch (error: any) {
      setErrorCode(error?.code || 'DESKTOP_PAIRING_GRANT_REVOKE_FAILED');
    } finally {
      operationRef.current = '';
      setOperationKey('');
    }
  };

  const copySingleUserPairingCode = async () => {
    if (!singleUserPairingGrant?.code) return;
    await navigator.clipboard.writeText(singleUserPairingGrant.code);
    message.success('\u914d\u5bf9\u7801\u5df2\u590d\u5236');
  };

  const confirmApproval = (row: any) => {
    Modal.confirm({
      title: `\u6279\u51c6 ${row.deviceName}`,
      content: <div>
        <p>{'\u7533\u8bf7\u4eba\u5df2\u7531\u672c\u6b21\u5fae\u4fe1\u624b\u673a\u53f7\u9a8c\u8bc1\u56fa\u5b9a\u4e3a\uff1a'}{row.claimant.name}{'\uff08'}{row.claimant.maskedPhone || '\u624b\u673a\u53f7\u5df2\u8131\u654f'}{'\uff09\u3002'}</p>
        {row.sameClaimantAndReviewer && <p className="identity-device-center__same-owner">{'\u7533\u8bf7\u4eba\u4e0e\u5ba1\u6279\u4eba\u76f8\u540c\uff0c\u4f46\u5ba1\u6279\u6765\u81ea\u53e6\u4e00\u53f0\u53ef\u4fe1\u8bbe\u5907\u3002'}</p>}
        {row.purpose === 'password_reset'
          ? <p>{'\u8fd9\u662f\u540c\u4e00\u53f0\u7535\u8111\u7684\u672c\u673a\u5bc6\u7801\u91cd\u8bbe\u7533\u8bf7\u3002\u6279\u51c6\u540e\u53ea\u8f6e\u6362\u8bbe\u5907\u5bc6\u94a5\uff0c\u4e0d\u5220\u9664\u672c\u673a\u4e1a\u52a1\u6570\u636e\u6216\u5f85\u540c\u6b65\u53d8\u66f4\u3002'}</p>
          : <p>{'\u6279\u51c6\u540e\uff0c\u65b0\u7535\u8111\u4ecd\u9700\u8bbe\u7f6e\u81ea\u5df1\u7684\u672c\u673a\u5bc6\u7801\uff0c\u4e0d\u80fd\u53d6\u5f97\u5f53\u524d\u4e3b\u673a\u5bc6\u7801\u3002'}</p>}
      </div>,
      okText: '\u6279\u51c6\u6b64\u8bbe\u5907', cancelText: '\u53d6\u6d88',
      async onOk() {
        const context = requestContextRef.current;
        await runOperation(`approve:${row.id}`, () => approveDesktopChallenge({
          ...context, request: buildApprovalBody(row),
        }), '\u8bbe\u5907\u7533\u8bf7\u5df2\u6279\u51c6');
      },
    });
  };

  const confirmRejection = (row: any) => {
    Modal.confirm({
      title: `\u62d2\u7edd ${row.deviceName}`,
      content: '\u62d2\u7edd\u540e\uff0c\u8fd9\u6b21\u7533\u8bf7\u4e0d\u80fd\u7ee7\u7eed\u4ea4\u6362\u8bbe\u5907\u51ed\u636e\uff0c\u9700\u8981\u5728\u7533\u8bf7\u7535\u8111\u4e0a\u91cd\u65b0\u53d1\u8d77\u3002',
      okText: '\u786e\u8ba4\u62d2\u7edd', okButtonProps: { danger: true }, cancelText: '\u53d6\u6d88',
      async onOk() {
        const context = requestContextRef.current;
        await runOperation(`reject:${row.id}`, () => rejectDesktopChallenge({
          ...context, request: buildRejectionBody(row, '\u7ba1\u7406\u5458\u6838\u5bf9\u540e\u62d2\u7edd'),
        }), '\u8bbe\u5907\u7533\u8bf7\u5df2\u62d2\u7edd');
      },
    });
  };

  const confirmRevocation = (device: any, replacementDeviceId?: string) => {
    const replacement = snapshot?.mine.find((item: any) => item.deviceId === replacementDeviceId);
    Modal.confirm({
      title: replacement
        ? `\u786e\u8ba4\u7531 ${replacement.deviceName} \u66ff\u6362`
        : `\u64a4\u9500 ${device.deviceName}`,
      content: replacement
        ? `\u64a4\u9500\u65e7\u7535\u8111\u540e\u4f1a\u4fdd\u7559\u201c${device.deviceName} -> ${replacement.deviceName}\u201d\u6362\u673a\u5173\u7cfb\uff1b\u5f53\u524d\u6570\u636e\u4e3b\u673a\u548c\u5176\u4ed6\u7535\u8111\u4e0d\u53d7\u5f71\u54cd\u3002`
        : '\u64a4\u9500\u540e\u8be5\u7535\u8111\u7684\u4f1a\u8bdd\u3001\u79bb\u7ebf\u79df\u7ea6\u548c\u8bbe\u5907\u5bc6\u94a5\u7acb\u5373\u5931\u6548\uff1b\u5f53\u524d\u6570\u636e\u4e3b\u673a\u548c\u5176\u4ed6\u7535\u8111\u4e0d\u53d7\u5f71\u54cd\u3002',
      okText: replacement ? '\u786e\u8ba4\u6362\u673a' : '\u786e\u8ba4\u64a4\u9500',
      okButtonProps: { danger: true },
      cancelText: '\u53d6\u6d88',
      async onOk() {
        const context = requestContextRef.current;
        const options = replacement
          ? { reason: 'replaced', replacementDeviceId }
          : { reason: 'user_request' };
        await runOperation(`revoke:${device.deviceId}`, () => revokeDesktopDevice({
          ...context, request: buildRevocationBody(device, options),
        }), replacement
          ? '\u6362\u673a\u5173\u7cfb\u5df2\u4fdd\u5b58\uff0c\u65e7\u7535\u8111\u5df2\u64a4\u9500'
          : '\u8bbe\u5907\u5df2\u64a4\u9500');
      },
    });
  };

  const startHostBootstrap = async () => {
    if (operationRef.current || !snapshot?.host?.canBootstrap) return;
    operationRef.current = 'primary-host:bootstrap:start';
    setOperationKey(operationRef.current);
    setHostOperationError('');
    setRevealedRecoveryPackage(null);
    try {
      const context = requestContextRef.current;
      const data = await startPrimaryHostOperation({
        ...context,
        request: { operation: 'bootstrap', targetDeviceId: snapshot.host.deviceId },
      });
      setHostOperation({ operation: 'bootstrap', challenge: data.challenge });
    } catch (error: any) {
      setHostOperationError(error?.code || 'PRIMARY_HOST_OPERATION_FAILED');
      message.error(identityDeviceCenterErrorMessage(error?.code));
    } finally {
      operationRef.current = '';
      setOperationKey('');
    }
  };

  const refreshHostOperation = async () => {
    if (!hostOperation?.challenge?.id || operationRef.current) return;
    operationRef.current = 'primary-host:challenge:refresh';
    setOperationKey(operationRef.current);
    setHostOperationError('');
    try {
      const context = requestContextRef.current;
      const data = await readPrimaryHostOperationChallenge({
        baseUrl: context.baseUrl,
        challengeId: hostOperation.challenge.id,
      });
      setHostOperation((current: any) => ({
        ...current,
        challenge: { ...current.challenge, ...data.challenge },
      }));
    } catch (error: any) {
      setHostOperationError(error?.code || 'PRIMARY_HOST_OPERATION_FAILED');
    } finally {
      operationRef.current = '';
      setOperationKey('');
    }
  };

  const completeHostBootstrap = async () => {
    if (operationRef.current || hostOperation?.challenge?.status !== 'identity_verified') return;
    operationRef.current = 'primary-host:bootstrap:complete';
    setOperationKey(operationRef.current);
    setHostOperationError('');
    try {
      if (!hostPassword) throw Object.assign(new Error('DESKTOP_IDENTITY_LOCAL_PASSWORD_REQUIRED'), { code: 'DESKTOP_IDENTITY_LOCAL_PASSWORD_REQUIRED' });
      const desktopIdentity = (window as any).desktopIdentity;
      const primaryHostRuntime = (window as any).primaryHostRuntime;
      if (!desktopIdentity?.unlock || !primaryHostRuntime?.prepareOperation || !primaryHostRuntime?.adopt) {
        throw Object.assign(new Error('PRIMARY_HOST_DESKTOP_RUNTIME_REQUIRED'), { code: 'PRIMARY_HOST_DESKTOP_RUNTIME_REQUIRED' });
      }
      await desktopIdentity.unlock({ password: hostPassword });
      const context = requestContextRef.current;
      const prepared = await primaryHostRuntime.prepareOperation({
        operation: 'bootstrap',
        challengeId: hostOperation.challenge.id,
        targetGeneration: 1,
        authorization: context.session.authorization,
        physicalConfirmation: 'I_AM_PHYSICALLY_AT_THIS_DEVICE',
      });
      const result = await bootstrapPrimaryHost({
        ...context,
        request: {
          challengeId: hostOperation.challenge.id,
          expectedChallengeRowVersion: hostOperation.challenge.rowVersion,
          localReceipt: prepared.localReceipt,
          operationManifest: prepared.operationManifest,
          recoveryDeliveryKey: prepared.recoveryDeliveryKey,
        },
      });
      const adopted = await primaryHostRuntime.adopt({
        authorization: context.session.authorization,
        epoch: result.epoch,
        credentialStageId: prepared.credentialStage.id,
        recoveryDelivery: result.recoveryDelivery,
      });
      setHostPassword('');
      setPendingRecoveryDelivery(adopted.recoveryDelivery);
      setRevealedRecoveryPackage(null);
      setHostOperation(null);
      await load();
    } catch (error: any) {
      setHostOperationError(error?.code || 'PRIMARY_HOST_OPERATION_FAILED');
    } finally {
      operationRef.current = '';
      setOperationKey('');
    }
  };

  const resumeHostRuntimeAdoption = async () => {
    if (operationRef.current || !snapshot?.host?.canResumeRuntimeAdoption) return;
    operationRef.current = 'primary-host:runtime-adoption:resume';
    setOperationKey(operationRef.current);
    setHostOperationError('');
    try {
      const context = requestContextRef.current;
      const primaryHostRuntime = (window as any).primaryHostRuntime;
      const stage = snapshot.host.pendingCredentialStage;
      const recoveryDelivery = snapshot.host.recoveryDelivery;
      if (!primaryHostRuntime?.adopt || !stage?.stageId || !recoveryDelivery?.id) {
        throw Object.assign(new Error('PRIMARY_HOST_DESKTOP_RUNTIME_REQUIRED'), { code: 'PRIMARY_HOST_DESKTOP_RUNTIME_REQUIRED' });
      }
      const adopted = await primaryHostRuntime.adopt({
        authorization: context.session.authorization,
        epoch: snapshot.host.activeEpoch,
        credentialStageId: stage.stageId,
        recoveryDelivery,
      });
      setPendingRecoveryDelivery(adopted.recoveryDelivery);
      setRevealedRecoveryPackage(null);
      message.success('\u4e3b\u673a\u51ed\u636e\u548c\u52a0\u5bc6\u6062\u590d\u5305\u5df2\u6062\u590d\uff0c\u8bf7\u5148\u5b8c\u6210\u79bb\u7ebf\u4fdd\u5b58');
      await load();
    } catch (error: any) {
      setHostOperationError(error?.code || 'PRIMARY_HOST_OPERATION_FAILED');
      message.error(identityDeviceCenterErrorMessage(error?.code));
    } finally {
      operationRef.current = '';
      setOperationKey('');
    }
  };

  const demoteStaleHostRuntime = async () => {
    if (operationRef.current || !snapshot?.host?.requiresRuntimeDemotion) return;
    operationRef.current = 'primary-host:runtime:demote';
    setOperationKey(operationRef.current);
    setHostOperationError('');
    try {
      const primaryHostRuntime = (window as any).primaryHostRuntime;
      if (!primaryHostRuntime?.demote || !primaryHostRuntime?.restart || !snapshot.host.runtimeEpochId) {
        throw Object.assign(new Error('PRIMARY_HOST_DESKTOP_RUNTIME_REQUIRED'), { code: 'PRIMARY_HOST_DESKTOP_RUNTIME_REQUIRED' });
      }
      await primaryHostRuntime.demote({ expectedEpochId: snapshot.host.runtimeEpochId });
      message.success('\u65e7\u4e3b\u673a\u51ed\u636e\u5df2\u6e05\u7406\uff0c\u6b63\u5728\u4ee5\u666e\u901a\u684c\u9762\u5ba2\u6237\u7aef\u91cd\u542f');
      await primaryHostRuntime.restart();
    } catch (error: any) {
      setHostOperationError(error?.code || 'PRIMARY_HOST_OPERATION_FAILED');
      message.error(identityDeviceCenterErrorMessage(error?.code));
    } finally {
      operationRef.current = '';
      setOperationKey('');
    }
  };

  const startHostTransfer = async (targetDevice: any) => {
    if (operationRef.current || !snapshot?.host?.canStartTransfer || targetDevice?.status !== 'active') return;
    operationRef.current = 'primary-host:transfer:start';
    setOperationKey(operationRef.current);
    setHostOperationError('');
    setRevealedRecoveryPackage(null);
    try {
      const context = requestContextRef.current;
      const data = await startPrimaryHostOperation({
        ...context,
        request: { operation: 'transfer', targetDeviceId: targetDevice.deviceId },
      });
      setHostOperation({ operation: 'transfer', targetDevice, challenge: data.challenge });
    } catch (error: any) {
      setHostOperationError(error?.code || 'PRIMARY_HOST_OPERATION_FAILED');
      message.error(identityDeviceCenterErrorMessage(error?.code));
    } finally {
      operationRef.current = '';
      setOperationKey('');
    }
  };

  const completeHostTransfer = async () => {
    if (operationRef.current || hostOperation?.operation !== 'transfer'
      || hostOperation?.challenge?.status !== 'identity_verified') return;
    operationRef.current = 'primary-host:transfer:complete';
    setOperationKey(operationRef.current);
    setHostOperationError('');
    try {
      const context = requestContextRef.current;
      await beginPrimaryHostTransfer({
        ...context,
        request: {
          challengeId: hostOperation.challenge.id,
          expectedChallengeRowVersion: hostOperation.challenge.rowVersion,
          expectedActiveEpochRowVersion: snapshot.host.activeEpoch.rowVersion,
        },
      });
      message.success('\u8ba1\u5212\u8fc1\u79fb\u5df2\u521b\u5efa\uff0c\u8bf7\u5230\u76ee\u6807\u7535\u8111\u5b8c\u6210\u672c\u5730\u6821\u9a8c\u4e0e\u6fc0\u6d3b');
      setHostOperation(null);
      await load();
    } catch (error: any) {
      setHostOperationError(error?.code || 'PRIMARY_HOST_OPERATION_FAILED');
    } finally {
      operationRef.current = '';
      setOperationKey('');
    }
  };

  const openHostTransferActivation = () => {
    const transfer = snapshot?.host?.incomingTransfer;
    if (!transfer || operationRef.current) return;
    setHostOperationError('');
    setRevealedRecoveryPackage(null);
    setHostOperation({
      operation: 'transfer-activation',
      transfer,
      challenge: { id: transfer.challengeId, status: 'identity_verified' },
    });
  };

  const activateHostTransfer = async () => {
    const transfer = hostOperation?.transfer;
    if (operationRef.current || hostOperation?.operation !== 'transfer-activation' || !transfer) return;
    operationRef.current = 'primary-host:transfer:activate';
    setOperationKey(operationRef.current);
    setHostOperationError('');
    try {
      if (!hostPassword) throw Object.assign(new Error('DESKTOP_IDENTITY_LOCAL_PASSWORD_REQUIRED'), { code: 'DESKTOP_IDENTITY_LOCAL_PASSWORD_REQUIRED' });
      const desktopIdentity = (window as any).desktopIdentity;
      const primaryHostRuntime = (window as any).primaryHostRuntime;
      if (!desktopIdentity?.unlock || !primaryHostRuntime?.prepareOperation || !primaryHostRuntime?.adopt) {
        throw Object.assign(new Error('PRIMARY_HOST_DESKTOP_RUNTIME_REQUIRED'), { code: 'PRIMARY_HOST_DESKTOP_RUNTIME_REQUIRED' });
      }
      await desktopIdentity.unlock({ password: hostPassword });
      const context = requestContextRef.current;
      const prepared = await primaryHostRuntime.prepareOperation({
        operation: 'transfer',
        challengeId: transfer.challengeId,
        transferId: transfer.id,
        sourceEpochId: transfer.sourceEpochId,
        sourceGeneration: transfer.sourceGeneration,
        targetGeneration: transfer.targetGeneration,
        authorization: context.session.authorization,
        physicalConfirmation: 'I_AM_PHYSICALLY_AT_THIS_DEVICE',
      });
      const result = await activatePrimaryHostTransfer({
        ...context,
        transferId: transfer.id,
        request: {
          expectedTransferRowVersion: transfer.rowVersion,
          localReceipt: prepared.localReceipt,
          validationManifest: prepared.operationManifest,
          preflightProof: prepared.preflightProof,
          recoveryDeliveryKey: prepared.recoveryDeliveryKey,
        },
      });
      const adopted = await primaryHostRuntime.adopt({
        authorization: context.session.authorization,
        epoch: result.epoch,
        credentialStageId: prepared.credentialStage.id,
        recoveryDelivery: result.recoveryDelivery,
      });
      setHostPassword('');
      setPendingRecoveryDelivery(adopted.recoveryDelivery);
      setRevealedRecoveryPackage(null);
      setHostOperation(null);
      await load();
    } catch (error: any) {
      setHostOperationError(error?.code || 'PRIMARY_HOST_OPERATION_FAILED');
    } finally {
      operationRef.current = '';
      setOperationKey('');
    }
  };

  const startHostRecovery = async () => {
    if (operationRef.current || !snapshot?.host?.canRecover) return;
    operationRef.current = 'primary-host:recovery:start';
    setOperationKey(operationRef.current);
    setHostOperationError('');
    setRevealedRecoveryPackage(null);
    try {
      const context = requestContextRef.current;
      const data = await startPrimaryHostOperation({
        ...context,
        request: { operation: 'recovery', targetDeviceId: snapshot.host.deviceId },
      });
      setHostOperation({ operation: 'recovery', challenge: data.challenge });
    } catch (error: any) {
      setHostOperationError(error?.code || 'PRIMARY_HOST_OPERATION_FAILED');
      message.error(identityDeviceCenterErrorMessage(error?.code));
    } finally {
      operationRef.current = '';
      setOperationKey('');
    }
  };

  const completeHostRecovery = async () => {
    if (operationRef.current || hostOperation?.operation !== 'recovery'
      || hostOperation?.challenge?.status !== 'identity_verified') return;
    operationRef.current = 'primary-host:recovery:complete';
    setOperationKey(operationRef.current);
    setHostOperationError('');
    try {
      if (!hostPassword) throw Object.assign(new Error('DESKTOP_IDENTITY_LOCAL_PASSWORD_REQUIRED'), { code: 'DESKTOP_IDENTITY_LOCAL_PASSWORD_REQUIRED' });
      if (!factorId.trim() || !recoveryCode.trim()) {
        throw Object.assign(new Error('PRIMARY_HOST_RECOVERY_FACTOR_REQUIRED'), { code: 'PRIMARY_HOST_RECOVERY_FACTOR_REQUIRED' });
      }
      const desktopIdentity = (window as any).desktopIdentity;
      const primaryHostRuntime = (window as any).primaryHostRuntime;
      if (!desktopIdentity?.unlock || !primaryHostRuntime?.prepareOperation || !primaryHostRuntime?.adopt) {
        throw Object.assign(new Error('PRIMARY_HOST_DESKTOP_RUNTIME_REQUIRED'), { code: 'PRIMARY_HOST_DESKTOP_RUNTIME_REQUIRED' });
      }
      await desktopIdentity.unlock({ password: hostPassword });
      const context = requestContextRef.current;
      const sourceGeneration = Number(snapshot.host.activeEpoch.generation);
      const prepared = await primaryHostRuntime.prepareOperation({
        operation: 'recovery',
        challengeId: hostOperation.challenge.id,
        sourceGeneration,
        targetGeneration: sourceGeneration + 1,
        authorization: context.session.authorization,
        physicalConfirmation: 'I_AM_PHYSICALLY_AT_THIS_DEVICE',
      });
      const result = await recoverPrimaryHost({
        ...context,
        request: {
          challengeId: hostOperation.challenge.id,
          expectedChallengeRowVersion: hostOperation.challenge.rowVersion,
          factorId: factorId.trim(),
          recoveryCode: recoveryCode.trim(),
          localReceipt: prepared.localReceipt,
          evidence: prepared.operationManifest,
          preflightProof: prepared.preflightProof,
          recoveryDeliveryKey: prepared.recoveryDeliveryKey,
        },
      });
      const adopted = await primaryHostRuntime.adopt({
        authorization: context.session.authorization,
        epoch: result.epoch,
        credentialStageId: prepared.credentialStage.id,
        recoveryDelivery: result.recoveryDelivery,
      });
      setHostPassword('');
      setFactorId('');
      setRecoveryCode('');
      setPendingRecoveryDelivery(adopted.recoveryDelivery);
      setRevealedRecoveryPackage(null);
      setHostOperation(null);
      await load();
    } catch (error: any) {
      setHostOperationError(error?.code || 'PRIMARY_HOST_OPERATION_FAILED');
    } finally {
      operationRef.current = '';
      setOperationKey('');
    }
  };

  const revealRecoveryPackage = async () => {
    if (!pendingRecoveryDelivery?.deliveryId) return;
    const primaryHostRuntime = (window as any).primaryHostRuntime;
    if (!primaryHostRuntime?.revealRecoveryPackage) {
      setHostOperationError('PRIMARY_HOST_DESKTOP_RUNTIME_REQUIRED');
      return;
    }
    try {
      const revealed = await primaryHostRuntime.revealRecoveryPackage({
        deliveryId: pendingRecoveryDelivery.deliveryId,
      });
      setRevealedRecoveryPackage(revealed.recoveryPackage);
    } catch (error: any) {
      setHostOperationError(error?.code || 'PRIMARY_HOST_RECOVERY_DELIVERY_PENDING');
    }
  };

  const copyRecoveryPackage = async () => {
    if (!revealedRecoveryPackage) return;
    await navigator.clipboard.writeText(JSON.stringify(revealedRecoveryPackage, null, 2));
    message.success('\u6062\u590d\u5305\u5df2\u590d\u5236\uff0c\u8bf7\u4fdd\u5b58\u5230\u5b89\u5168\u7684\u79bb\u7ebf\u4f4d\u7f6e');
  };

  const acknowledgeRecoveryPackageAndRestart = async () => {
    if (operationRef.current || !revealedRecoveryPackage
      || !pendingRecoveryDelivery?.deliveryId || !pendingRecoveryDelivery?.rowVersion) return;
    operationRef.current = 'primary-host:recovery-package:acknowledge';
    setOperationKey(operationRef.current);
    setHostOperationError('');
    try {
      const context = requestContextRef.current;
      const primaryHostRuntime = (window as any).primaryHostRuntime;
      if (!primaryHostRuntime?.acknowledgeRecoveryPackage || !primaryHostRuntime?.restart) {
        throw Object.assign(new Error('PRIMARY_HOST_DESKTOP_RUNTIME_REQUIRED'), { code: 'PRIMARY_HOST_DESKTOP_RUNTIME_REQUIRED' });
      }
      await primaryHostRuntime.acknowledgeRecoveryPackage({
        authorization: context.session.authorization,
        deliveryId: pendingRecoveryDelivery.deliveryId,
        expectedRowVersion: pendingRecoveryDelivery.rowVersion,
      });
      setPendingRecoveryDelivery(null);
      setRevealedRecoveryPackage(null);
      message.success('\u6062\u590d\u5305\u4ea4\u4ed8\u5df2\u786e\u8ba4\uff0c\u6b63\u5728\u91cd\u542f\u5e94\u7528');
      await primaryHostRuntime.restart();
    } catch (error: any) {
      setHostOperationError(error?.code || 'PRIMARY_HOST_RECOVERY_DELIVERY_ACK_REJECTED');
      message.error(identityDeviceCenterErrorMessage(error?.code));
    } finally {
      operationRef.current = '';
      setOperationKey('');
    }
  };

  const pendingColumns: ColumnsType<any> = [
    { title: '\u7533\u8bf7\u7c7b\u578b', render: (_, row) => row.purpose === 'password_reset'
      ? <Tag color="orange">{'\u91cd\u8bbe\u672c\u673a\u5bc6\u7801'}</Tag>
      : <Tag>{'\u65b0\u8bbe\u5907\u6ce8\u518c'}</Tag> },
    { title: '\u7533\u8bf7\u8bbe\u5907', render: (_, row) => <div><strong>{row.deviceName}</strong><div className="identity-device-center__muted">{row.deviceId}</div></div> },
    { title: '\u5bc6\u94a5\u6307\u7eb9', dataIndex: 'keyFingerprintSummary' },
    { title: '\u5df2\u9a8c\u8bc1\u7533\u8bf7\u4eba', render: (_, row) => <div><strong>{row.claimant.name}</strong><div className="identity-device-center__muted">{row.claimant.maskedPhone} · {row.claimant.eligibleRoles.map((role: string) => roleLabels[role] || role).join(' / ')}</div></div> },
    { title: '\u8fc7\u671f\u65f6\u95f4', render: (_, row) => localTime(row.expiresAt) },
    { title: '\u64cd\u4f5c', render: (_, row) => <Space wrap>
      <Button type="primary" disabled={Boolean(operationKey) || row.isRequestingDevice} onClick={() => confirmApproval(row)}>{'\u6279\u51c6'}</Button>
      <Button danger disabled={Boolean(operationKey)} onClick={() => confirmRejection(row)}>{'\u62d2\u7edd'}</Button>
    </Space> },
  ];

  const deviceColumns: ColumnsType<any> = [
    { title: '\u8bbe\u5907', render: (_, row) => <div><Space wrap><strong>{row.deviceName}</strong>{row.isHost && <Tag color="blue">{'\u6570\u636e\u4e3b\u673a'}</Tag>}{row.isCurrent && <Tag color="green">{'\u5f53\u524d\u7535\u8111'}</Tag>}</Space><div className="identity-device-center__muted">{row.deviceId}</div></div> },
    { title: '\u72b6\u6001', render: (_, row) => <div>
      <Tag color={row.status === 'active' ? 'green' : row.status === 'replaced' ? 'gold' : 'default'}>{deviceStatusLabels[row.status] || row.status}</Tag>
      {row.replacedByName && <div className="identity-device-center__relation">{'\u5df2\u7531 '}{row.replacedByName}{' \u66ff\u6362'}</div>}
      {row.replacesDeviceIds.length > 0 && <div className="identity-device-center__relation">{'\u66ff\u6362\u65e7\u8bbe\u5907\uff1a'}{row.replacesDeviceIds.join(' / ')}</div>}
    </div> },
    { title: '\u5bc6\u94a5\u6307\u7eb9', dataIndex: 'keyFingerprintSummary', responsive: ['lg'] },
    { title: '\u6700\u8fd1\u6d3b\u52a8', render: (_, row) => localTime(row.lastSeenAt || row.updatedAt) },
    { title: '\u64cd\u4f5c', render: (_, row) => row.canRevoke ? <Space direction="vertical" size={4}>
      <Button danger size="small" disabled={Boolean(operationKey)} onClick={() => confirmRevocation(row)}>{'\u64a4\u9500\u6b64\u8bbe\u5907'}</Button>
      {snapshot.mine.filter((item: any) => item.status === 'active'
        && item.deviceId !== row.deviceId
        && Date.parse(item.createdAt) > Date.parse(row.createdAt))
        .map((replacement: any) => <Button key={replacement.deviceId} size="small" disabled={Boolean(operationKey)} onClick={() => confirmRevocation(row, replacement.deviceId)}>{'\u6807\u8bb0\u7531 '}{replacement.deviceName}{' \u66ff\u6362'}</Button>)}
    </Space> : <span className="identity-device-center__muted">{row.isCurrent ? '\u5f53\u524d\u7535\u8111\u4e0d\u53ef\u81ea\u64a4\u9500' : '\u65e0\u53ef\u7528\u64cd\u4f5c'}</span> },
  ];

  const allDeviceColumns: ColumnsType<any> = deviceColumns.map(column => column.title === '\u64cd\u4f5c'
    ? { title: '\u6240\u5c5e\u8eab\u4efd', render: (_, row: any) => row.ownerId || '--' }
    : column);

  return <main className="identity-device-center">
    <div className="identity-device-center__heading">
      <div>
        <Typography.Title level={2}>{'\u8eab\u4efd\u4e0e\u8bbe\u5907'}</Typography.Title>
        <Typography.Paragraph type="secondary">{'\u4e00\u4e2a\u771f\u5b9e\u8eab\u4efd\u53ef\u4ee5\u540c\u65f6\u62e5\u6709\u591a\u4e2a\u89d2\u8272\uff1b\u6bcf\u53f0\u7535\u8111\u72ec\u7acb\u6ce8\u518c\u3001\u72ec\u7acb\u64a4\u9500\uff0c\u6362\u673a\u4e0d\u4f1a\u521b\u5efa\u7b2c\u4e8c\u4e2a\u8001\u5e08\u6863\u6848\u3002'}</Typography.Paragraph>
      </div>
      <Button onClick={() => void load()} loading={viewState === 'loading'}>{'\u5237\u65b0\u72b6\u6001'}</Button>
    </div>

    {errorCode && <Alert className="identity-device-center__alert" showIcon type="error" message={identityDeviceCenterErrorMessage(errorCode)} action={<Button onClick={() => void load()}>{'\u91cd\u8bd5'}</Button>} />}
    {viewState === 'offline' && <Alert className="identity-device-center__alert" showIcon type="warning" message={'\u4e3b\u673a\u8fde\u63a5\u5df2\u79bb\u7ebf'} description={'\u5df2\u767b\u5f55\u8bbe\u5907\u53ef\u6309\u79bb\u7ebf\u79df\u7ea6\u7ee7\u7eed\u4f7f\u7528\uff0c\u4f46\u8bbe\u5907\u5ba1\u6279\u3001\u64a4\u9500\u548c\u6362\u673a\u5173\u7cfb\u5fc5\u987b\u8054\u7f51\u540e\u5b8c\u6210\u3002'} />}
    {viewState === 'expired' && <Alert className="identity-device-center__alert" showIcon type="warning" message={'\u7533\u8bf7\u5df2\u8fc7\u671f'} />}
    {viewState === 'conflict' && <Alert className="identity-device-center__alert" showIcon type="error" message={'\u8eab\u4efd\u6216\u8bbe\u5907\u5f52\u5c5e\u51b2\u7a81'} />}
    {viewState === 'concurrent' && <Alert className="identity-device-center__alert" showIcon type="info" message={'\u72b6\u6001\u5df2\u88ab\u53e6\u4e00\u9879\u64cd\u4f5c\u66f4\u65b0\uff0c\u8bf7\u5237\u65b0'} />}
    {viewState === 'revoked' && <Alert className="identity-device-center__alert" showIcon type="error" message={'\u5f53\u524d\u8bbe\u5907\u6388\u6743\u5df2\u64a4\u9500\uff0c\u8bf7\u91cd\u65b0\u8fdb\u5165\u767b\u5f55\u6d41\u7a0b'} />}

    {runtimeConfigState?.buildFlavor === 'primary-host'
      && runtimeConfigState?.desktopIdentityMode === 'single-user' && (
      <Card className="identity-device-center__section" title={'\u666e\u901a\u684c\u9762\u7aef\u4e00\u6b21\u6027\u914d\u5bf9'}>
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Typography.Paragraph type="secondary">
            {'\u6bcf\u6b21\u53ea\u751f\u6210\u4e00\u4e2a 10 \u5206\u949f\u6709\u6548\u7684\u914d\u5bf9\u7801\uff1b\u65b0\u7801\u4f1a\u64a4\u9500\u65e7\u7801\u3002\u666e\u901a\u7aef\u914d\u5bf9\u6210\u529f\u540e\u4ecd\u9700\u624b\u52a8\u53d1\u8d77\u540c\u6b65\u3002'}
          </Typography.Paragraph>
          {singleUserPairingGrant && pairingSecondsRemaining > 0 ? (
            <>
              <Typography.Title level={3} copyable={false} style={{ margin: 0, letterSpacing: 3 }}>
                {String(singleUserPairingGrant.code).match(/.{1,4}/g)?.join('-')}
              </Typography.Title>
              <Tag color="orange">{Math.floor(pairingSecondsRemaining / 60)}:{String(pairingSecondsRemaining % 60).padStart(2, '0')} {'\u540e\u8fc7\u671f'}</Tag>
              <Space wrap>
                <Button onClick={() => void copySingleUserPairingCode()}>{'\u590d\u5236\u914d\u5bf9\u7801'}</Button>
                <Button danger loading={operationKey === 'single-user:pairing:revoke'} onClick={() => void revokeSingleUserPairingCode()}>{'\u64a4\u9500\u5f53\u524d\u914d\u5bf9\u7801'}</Button>
              </Space>
            </>
          ) : (
            <Button type="primary" loading={operationKey === 'single-user:pairing:issue'} onClick={() => void issueSingleUserPairingCode()}>
              {'\u751f\u6210\u4e00\u6b21\u6027\u914d\u5bf9\u7801'}
            </Button>
          )}
        </Space>
      </Card>
    )}

    {viewState === 'loading' && !snapshot && <Card className="identity-device-center__loading"><Spin /><span>{'\u6b63\u5728\u8bfb\u53d6\u8eab\u4efd\u4e0e\u8bbe\u5907\u72b6\u6001\u2026'}</span></Card>}
    {viewState === 'empty' && <Card><Empty description={'\u6ca1\u6709\u53ef\u663e\u793a\u7684\u8bbe\u5907\u8bb0\u5f55'} /></Card>}

    {snapshot && <>
      <Card className="identity-device-center__identity" title={'\u5f53\u524d\u8eab\u4efd'}>
        <Descriptions column={{ xs: 1, md: 2 }}>
          <Descriptions.Item label={'\u5f53\u524d\u89d2\u8272'}>{roleLabels[snapshot.identity.activeRole] || snapshot.identity.activeRole}</Descriptions.Item>
          <Descriptions.Item label={'\u5168\u90e8\u89d2\u8272'}><Space wrap>{snapshot.identity.eligibleRoles.map((role: string) => <Tag key={role}>{roleLabels[role] || role}</Tag>)}</Space></Descriptions.Item>
          <Descriptions.Item label={'\u8001\u5e08\u6863\u6848 teacher_id'}>{snapshot.identity.teacherId || '\u5f53\u524d\u8eab\u4efd\u672a\u7ed1\u5b9a\u8001\u5e08\u6863\u6848'}</Descriptions.Item>
          <Descriptions.Item label={'\u8eab\u4efd\u89c4\u5219'}>{'\u5207\u6362\u89d2\u8272\u4e0d\u4f1a\u66f4\u6362\u7528\u6237\uff0c\u4e5f\u4e0d\u4f1a\u590d\u5236 teacher_id'}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Card className="identity-device-center__section" title={`${'\u5f85\u5ba1\u8bbe\u5907\u7533\u8bf7'}${snapshot.access.canReview ? ` (${snapshot.pending.length})` : ''}`}>
        {!snapshot.access.canReview
          ? <Alert showIcon type="info" message={'\u5f53\u524d\u8eab\u4efd\u4e0d\u663e\u793a\u5ba1\u6279\u64cd\u4f5c'} description={snapshot.access.isPrimaryHost
            ? '\u8bf7\u5207\u6362\u5230\u8d85\u7ea7\u7ba1\u7406\u5458\u89d2\u8272\uff1b\u8001\u5e08\u6216\u666e\u901a\u7ba1\u7406\u5458\u89d2\u8272\u53ea\u67e5\u770b\u672c\u4eba\u8bbe\u5907\u3002'
            : '\u8bbe\u5907\u5ba1\u6279\u53ea\u5728\u672c\u5730\u6570\u636e\u4e3b\u673a\u7684\u8d85\u7ea7\u7ba1\u7406\u5458\u8eab\u4efd\u4e2d\u663e\u793a\u3002'} />
          : <Table rowKey="id" dataSource={snapshot.pending} columns={pendingColumns} pagination={false} locale={{ emptyText: <Empty description={'\u6682\u65e0\u5df2\u5b8c\u6210\u624b\u673a\u53f7\u9a8c\u8bc1\u7684\u5f85\u5ba1\u7533\u8bf7'} /> }} />}
      </Card>

      <Card className="identity-device-center__section" title={'\u6211\u7684\u8bbe\u5907'}>
        <Table rowKey="deviceId" dataSource={snapshot.mine} columns={deviceColumns} pagination={false} locale={{ emptyText: <Empty description={'\u6682\u65e0\u672c\u4eba\u8bbe\u5907'} /> }} />
      </Card>

      {snapshot.access.canViewAllDevices && <Card className="identity-device-center__section" title={'\u5168\u90e8\u8bbe\u5907'}>
        <Table rowKey="deviceId" dataSource={snapshot.all} columns={allDeviceColumns} pagination={false} locale={{ emptyText: <Empty description={'\u6682\u65e0\u8bbe\u5907\u8bb0\u5f55'} /> }} />
      </Card>}

      <Card className="identity-device-center__section" title={'\u672c\u5730\u6570\u636e\u4e3b\u673a'}>
        <Descriptions column={{ xs: 1, md: 2 }}>
          <Descriptions.Item label={'\u8fd0\u884c\u89d2\u8272'}>{snapshot.host.isPrimaryHost ? '\u5f53\u524d\u7535\u8111\u662f\u6307\u5b9a\u6570\u636e\u4e3b\u673a' : '\u5f53\u524d\u7535\u8111\u662f\u666e\u901a\u79bb\u7ebf\u5ba2\u6237\u7aef'}</Descriptions.Item>
          <Descriptions.Item label={'\u8bbe\u5907 ID'}>{snapshot.host.deviceId || '--'}</Descriptions.Item>
          <Descriptions.Item label={'\u4e3b\u673a\u5730\u5740'}>{snapshot.host.hostBaseUrl || '--'}</Descriptions.Item>
          <Descriptions.Item label={'\u6743\u5a01\u804c\u8d23'}>{'\u5ba1\u6279\u3001\u5168\u91cf\u6570\u636e\u4e0e\u540c\u6b65\u6700\u7ec8\u786e\u8ba4\u7531\u6307\u5b9a\u6570\u636e\u4e3b\u673a\u627f\u62c5'}</Descriptions.Item>
          <Descriptions.Item label={'\u4e3b\u673a\u4ee3\u6b21'}>{snapshot.host.activeEpoch ? `#${snapshot.host.activeEpoch.generation}` : '\u5c1a\u672a\u5efa\u7acb\u53d7\u7ba1\u4e3b\u673a\u8eab\u4efd'}</Descriptions.Item>
          <Descriptions.Item label={'\u8eab\u4efd\u72b6\u6001'}>{snapshot.host.runtimeMatchesActiveEpoch ? '\u672c\u673a\u51ed\u636e\u4e0e\u4e91\u7aef\u4e3b\u673a\u4ee3\u6b21\u4e00\u81f4' : snapshot.host.controlAvailable ? '\u7b49\u5f85\u5b8c\u6210\u4e3b\u673a\u8eab\u4efd\u64cd\u4f5c' : '\u65e0\u6cd5\u8bfb\u53d6\u4e3b\u673a\u63a7\u5236\u9762'}</Descriptions.Item>
        </Descriptions>
        {snapshot.host.blocksHighRiskOperations && <Alert
          style={{ marginTop: 16 }}
          type="error"
          showIcon
          message={'\u6062\u590d\u5305\u5c1a\u672a\u786e\u8ba4\u4ea4\u4ed8'}
          description={'\u5fc5\u987b\u5148\u5728\u76ee\u6807\u7535\u8111\u4e0a\u663e\u793a\u5e76\u79bb\u7ebf\u4fdd\u5b58\u4e00\u6b21\u6027\u6062\u590d\u5305\uff0c\u518d\u5b8c\u6210\u7b7e\u540d\u786e\u8ba4\u3002\u6b64\u524d\u4e0d\u80fd\u7ee7\u7eed bootstrap\u3001\u8ba1\u5212\u6362\u673a\u6216\u7d27\u6025\u6062\u590d\u3002'}
        />}
        {snapshot.host.requiresRuntimeDemotion && <Alert
          style={{ marginTop: 16 }}
          type="error"
          showIcon
          message={'\u672c\u673a\u4e3b\u673a\u4ee3\u6b21\u5df2\u9000\u5f79'}
          description={'\u4e91\u7aef\u5df2\u7531\u5176\u4ed6\u7535\u8111\u63a5\u7ba1\u6570\u636e\u4e3b\u673a\u3002\u8bf7\u6e05\u7406\u672c\u673a\u65e7\u51ed\u636e\uff0c\u5e76\u4ee5\u666e\u901a\u79bb\u7ebf\u5ba2\u6237\u7aef\u91cd\u542f\u3002'}
          action={<Button
            danger
            loading={operationKey === 'primary-host:runtime:demote'}
            onClick={() => void demoteStaleHostRuntime()}
          >{'\u6e05\u7406\u65e7\u51ed\u636e\u5e76\u91cd\u542f'}</Button>}
        />}
        {snapshot.host.canResumeRuntimeAdoption && <Alert
          style={{ marginTop: 16 }}
          type="warning"
          showIcon
          message={'\u68c0\u6d4b\u5230\u672a\u5b8c\u6210\u7684\u4e3b\u673a\u51ed\u636e\u6536\u53e3'}
          description={'\u4e91\u7aef\u5df2\u6fc0\u6d3b\u5f53\u524d\u4e3b\u673a\u4ee3\u6b21\uff0c\u4f46\u5e94\u7528\u5728\u5199\u5165\u672c\u673a\u8fd0\u884c\u914d\u7f6e\u524d\u4e2d\u65ad\u3002\u5df2\u52a0\u5bc6\u6682\u5b58\u7684\u51ed\u636e\u4ecd\u53ef\u5b89\u5168\u9a8c\u8bc1\u5e76\u6062\u590d\u3002'}
          action={<Button
            type="primary"
            loading={operationKey === 'primary-host:runtime-adoption:resume'}
            onClick={() => void resumeHostRuntimeAdoption()}
          >{'\u6062\u590d\u4e3b\u673a\u51ed\u636e\u4e0e\u6062\u590d\u5305'}</Button>}
        />}
        {snapshot.host.canBootstrap && <Alert
          style={{ marginTop: 16 }}
          type="warning"
          showIcon
          message={'\u5f53\u524d\u662f\u65e7\u7248\u672c\u5730\u6570\u636e\u4e3b\u673a\uff0c\u9700\u8981\u5efa\u7acb\u53d7\u7ba1\u4e3b\u673a\u8eab\u4efd'}
          description={'\u9700\u8981\u5fae\u4fe1\u626b\u7801\u9a8c\u8bc1\u672c\u4eba\u624b\u673a\u53f7\u3001\u672c\u673a\u5bc6\u7801\uff0c\u5e76\u6838\u9a8c\u5f53\u524d\u6570\u636e\u5e93\u4e0e\u79fb\u52a8\u9898\u5e93\u7ed1\u5b9a\u3002'}
          action={<Button type="primary" loading={operationKey === 'primary-host:bootstrap:start'} onClick={() => void startHostBootstrap()}>{'\u5f00\u59cb\u5efa\u7acb\u4e3b\u673a\u8eab\u4efd'}</Button>}
        />}
        {snapshot.host.canStartTransfer && <Alert
          style={{ marginTop: 16 }}
          type="info"
          showIcon
          message={'\u8ba1\u5212\u6362\u673a'}
          description={<Space direction="vertical" size="small">
            <span>{'\u5148\u4e3a\u540c\u4e00\u7528\u6237\u7684\u5df2\u6fc0\u6d3b\u76ee\u6807\u7535\u8111\u521b\u5efa generation+1 \u5f85\u9a8c\u8bc1\u8fc1\u79fb\uff0c\u518d\u5230\u76ee\u6807\u7535\u8111\u5b8c\u6210\u672c\u5730\u5907\u4efd\u4e0e\u9898\u5e93\u7ed1\u5b9a\u6821\u9a8c\u3002'}</span>
            <Space wrap>{snapshot.mine.filter((device: any) => device.status === 'active'
              && !device.isCurrent
              && device.ownerId === snapshot.identity.userId)
              .map((device: any) => <Button
                key={device.deviceId}
                loading={operationKey === 'primary-host:transfer:start'}
                onClick={() => void startHostTransfer(device)}
              >{'\u8fc1\u79fb\u5230 '}{device.deviceName}</Button>)}</Space>
          </Space>}
        />}
        {snapshot.host.canActivateTransfer && <Alert
          style={{ marginTop: 16 }}
          type="warning"
          showIcon
          message={`\u5df2\u6536\u5230 generation #${snapshot.host.incomingTransfer.targetGeneration} \u8ba1\u5212\u8fc1\u79fb`}
          description={'\u53ea\u6709\u5f53\u524d\u76ee\u6807\u7535\u8111\u7684 SQLite\u3001schema\u3001\u79fb\u52a8\u9898\u5e93\u7ed1\u5b9a\u3001\u4e91\u7aef\u5065\u5eb7\u4e0e\u540c\u6b65 dry-run \u5168\u90e8\u901a\u8fc7\u540e\u624d\u4f1a\u539f\u5b50\u6fc0\u6d3b\u3002'}
          action={<Button type="primary" onClick={openHostTransferActivation}>{'\u6821\u9a8c\u672c\u673a\u5e76\u6fc0\u6d3b'}</Button>}
        />}
        {snapshot.host.canRecover && <Alert
          style={{ marginTop: 16 }}
          type="error"
          showIcon
          message={'\u7d27\u6025\u6062\u590d'}
          description={'\u4ec5\u5728\u65e7\u4e3b\u673a\u6301\u7eed\u79bb\u7ebf\u4e14\u4f60\u6301\u6709\u672a\u4f7f\u7528\u7684\u6062\u590d\u56e0\u5b50\u548c\u6743\u5a01\u5907\u4efd\u65f6\u4f7f\u7528\u3002'}
          action={<Button danger loading={operationKey === 'primary-host:recovery:start'} onClick={() => void startHostRecovery()}>{'\u5f00\u59cb\u7d27\u6025\u6062\u590d'}</Button>}
        />}
      </Card>
    </>}

    <Modal
      open={Boolean(hostOperation)}
      title={hostOperation?.operation === 'bootstrap'
        ? '\u5efa\u7acb\u53d7\u7ba1\u672c\u5730\u6570\u636e\u4e3b\u673a'
        : hostOperation?.operation === 'transfer'
          ? '\u521b\u5efa\u8ba1\u5212\u6362\u673a'
          : hostOperation?.operation === 'transfer-activation'
            ? '\u6821\u9a8c\u5e76\u6fc0\u6d3b\u65b0\u4e3b\u673a'
            : '\u7d27\u6025\u6062\u590d\u672c\u5730\u6570\u636e\u4e3b\u673a'}
      footer={null}
      maskClosable={false}
      onCancel={() => {
        setHostOperation(null);
        setHostPassword('');
        setFactorId('');
        setRecoveryCode('');
      }}
    >
      {hostOperation && <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Alert
          showIcon
          type="warning"
          message={'\u8fd9\u662f\u9ad8\u98ce\u9669\u4e3b\u673a\u8eab\u4efd\u64cd\u4f5c'}
          description={hostOperation.operation === 'transfer-activation'
            ? '\u5fc5\u987b\u5728\u8fd9\u53f0\u76ee\u6807\u7535\u8111\u4e0a\u5b8c\u6210\u6743\u5a01\u5907\u4efd\u3001SQLite \u5b8c\u6574\u6027\u3001schema \u548c\u9898\u5e93\u7ed1\u5b9a\u6821\u9a8c\u3002'
            : '\u8bf7\u7528\u5fae\u4fe1\u626b\u7801\uff0c\u5728\u5c0f\u7a0b\u5e8f\u4e2d\u6bcf\u6b21\u91cd\u65b0\u6388\u6743\u624b\u673a\u53f7\u3002\u5fae\u4fe1\u5b8c\u6210\u540e\u56de\u5230\u672c\u9875\u5237\u65b0\u3002'}
        />
        {hostOperation.challenge.qrImageDataUrl
          ? <div style={{ display: 'flex', justifyContent: 'center' }}><img src={hostOperation.challenge.qrImageDataUrl} width={220} height={220} alt={'\u5fae\u4fe1\u5c0f\u7a0b\u5e8f\u4e3b\u673a\u8eab\u4efd\u6838\u9a8c\u7801'} /></div>
          : hostOperation.challenge.qrValue && <div style={{ display: 'flex', justifyContent: 'center' }}><QRCode value={hostOperation.challenge.qrValue} size={220} /></div>}
        <Descriptions size="small" column={1}>
          <Descriptions.Item label={'\u64cd\u4f5c\u8bbe\u5907'}>{hostOperation.challenge.deviceName || snapshot?.host?.deviceId}</Descriptions.Item>
          <Descriptions.Item label={'\u5fae\u4fe1\u9a8c\u8bc1'}>{hostOperation.challenge.status === 'identity_verified' ? '\u5df2\u901a\u8fc7' : '\u7b49\u5f85\u626b\u7801'}</Descriptions.Item>
        </Descriptions>
        {hostOperation.operation !== 'transfer-activation' && hostOperation.challenge.status !== 'identity_verified'
          && <Button onClick={() => void refreshHostOperation()} loading={operationKey === 'primary-host:challenge:refresh'}>{'\u6211\u5df2\u5728\u5fae\u4fe1\u5b8c\u6210\uff0c\u5237\u65b0\u72b6\u6001'}</Button>}
        {hostOperation.operation === 'bootstrap' && hostOperation.challenge.status === 'identity_verified' && <>
          <Input.Password value={hostPassword} onChange={event => setHostPassword(event.target.value)} placeholder={'\u8f93\u5165\u8fd9\u53f0\u7535\u8111\u7684\u672c\u673a\u5bc6\u7801'} autoComplete="current-password" />
          <Alert type="info" showIcon message={'\u786e\u8ba4\u4f60\u6b63\u5728\u8fd9\u53f0\u7535\u8111\u524d\uff0c\u4e14\u79fb\u52a8\u9898\u5e93\u76d8\u5df2\u63a5\u5165'} />
          <Button type="primary" block loading={operationKey === 'primary-host:bootstrap:complete'} onClick={() => void completeHostBootstrap()}>{'\u6838\u9a8c\u672c\u673a\u5e76\u542f\u7528\u4e3b\u673a\u8eab\u4efd'}</Button>
        </>}
        {hostOperation.operation === 'transfer' && hostOperation.challenge.status === 'identity_verified' && <>
          <Alert type="info" showIcon message={'\u624b\u673a\u53f7\u5df2\u9a8c\u8bc1\uff1b\u786e\u8ba4\u540e\u53ea\u521b\u5efa\u5f85\u6821\u9a8c\u8fc1\u79fb\uff0c\u4e0d\u4f1a\u7acb\u5373\u5207\u6362\u4e3b\u673a\u3002'} />
          <Button type="primary" block loading={operationKey === 'primary-host:transfer:complete'} onClick={() => void completeHostTransfer()}>{'\u521b\u5efa generation+1 \u5f85\u6821\u9a8c\u8fc1\u79fb'}</Button>
        </>}
        {hostOperation.operation === 'transfer-activation' && <>
          <Input.Password value={hostPassword} onChange={event => setHostPassword(event.target.value)} placeholder={'\u8f93\u5165\u8fd9\u53f0\u7535\u8111\u7684\u672c\u673a\u5bc6\u7801'} autoComplete="current-password" />
          <Alert type="info" showIcon message={'\u786e\u8ba4\u79fb\u52a8\u9898\u5e93\u76d8\u5df2\u63a5\u5165\uff0c\u4e14\u5f53\u524d\u672c\u5730\u6570\u636e\u5e93\u662f\u6743\u5a01\u5907\u4efd\u7684\u76ee\u6807\u5b9e\u4f8b'} />
          <Button type="primary" block loading={operationKey === 'primary-host:transfer:activate'} onClick={() => void activateHostTransfer()}>{'\u5f00\u59cb\u6821\u9a8c\u5e76\u539f\u5b50\u6fc0\u6d3b'}</Button>
        </>}
        {hostOperation.operation === 'recovery' && hostOperation.challenge.status === 'identity_verified' && <>
          <Input value={factorId} onChange={event => setFactorId(event.target.value)} placeholder={'\u6062\u590d\u56e0\u5b50 ID'} autoComplete="off" />
          <Input.Password value={recoveryCode} onChange={event => setRecoveryCode(event.target.value)} placeholder={'\u4e00\u6b21\u6027\u6062\u590d\u7801'} autoComplete="off" />
          <Input.Password value={hostPassword} onChange={event => setHostPassword(event.target.value)} placeholder={'\u8f93\u5165\u8fd9\u53f0\u7535\u8111\u7684\u672c\u673a\u5bc6\u7801'} autoComplete="current-password" />
          <Alert type="error" showIcon message={'\u6062\u590d\u56e0\u5b50\u53ea\u80fd\u4f7f\u7528\u4e00\u6b21\uff1b\u65e7\u4e3b\u673a\u5fc5\u987b\u5df2\u6301\u7eed\u5931\u8054\u81f3\u5c11 15 \u5206\u949f'} />
          <Button danger type="primary" block loading={operationKey === 'primary-host:recovery:complete'} onClick={() => void completeHostRecovery()}>{'\u6821\u9a8c\u8bc1\u636e\u5e76\u6267\u884c\u7d27\u6025\u6062\u590d'}</Button>
        </>}
        {hostOperationError && <Alert type="error" showIcon message={identityDeviceCenterErrorMessage(hostOperationError)} />}
      </Space>}
    </Modal>

    <Modal
      open={Boolean(pendingRecoveryDelivery)}
      title={'\u4fdd\u5b58\u4e00\u6b21\u6027\u6062\u590d\u5305'}
      footer={null}
      closable={false}
      maskClosable={false}
      keyboard={false}
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Alert
          type="warning"
          showIcon
          message={'\u6062\u590d\u5305\u5c1a\u672a\u786e\u8ba4\u4ea4\u4ed8'}
          description={'\u8be5\u6062\u590d\u5305\u53ea\u5b58\u5728\u672c\u673a\u52a0\u5bc6\u5b58\u50a8\u4e2d\u3002\u8bf7\u663e\u793a\u540e\u590d\u5236\u5230\u79bb\u7ebf\u4ecb\u8d28\uff0c\u786e\u8ba4\u6210\u529f\u524d\u4e0d\u4f1a\u5220\u9664\u672c\u5730\u526f\u672c\u6216\u79c1\u94a5\u3002'}
        />
        {!revealedRecoveryPackage
          ? <Button type="primary" block onClick={() => void revealRecoveryPackage()}>{'\u663e\u793a\u4e00\u6b21\u6027\u6062\u590d\u5305'}</Button>
          : <>
            <div className="recovery-delivery-secret">
              <pre>{JSON.stringify(revealedRecoveryPackage, null, 2)}</pre>
            </div>
            <Button block onClick={() => void copyRecoveryPackage()}>{'\u590d\u5236\u6062\u590d\u5305\u5230\u526a\u8d34\u677f'}</Button>
            <Button
              type="primary"
              block
              loading={operationKey === 'primary-host:recovery-package:acknowledge'}
              onClick={() => void acknowledgeRecoveryPackageAndRestart()}
            >{'\u6211\u5df2\u79bb\u7ebf\u4fdd\u5b58\uff0c\u786e\u8ba4\u4ea4\u4ed8\u5e76\u91cd\u542f'}</Button>
          </>}
        {hostOperationError && <Alert type="error" showIcon message={identityDeviceCenterErrorMessage(hostOperationError)} />}
      </Space>
    </Modal>
  </main>;
};

export default IdentityDeviceCenter;
