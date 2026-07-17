import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Descriptions, Empty, Modal, Space, Spin, Table, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { getRuntimeConfig } from '../services/runtimeConfigClient';
import { readDesktopAuthorizationSession } from '../services/desktopAuthorizationSession.mjs';
import { resolvePairingApiBase } from '../services/pairingApiBase.mjs';
import {
  approveDesktopChallenge,
  buildApprovalBody,
  buildRejectionBody,
  buildRevocationBody,
  identityDeviceCenterErrorMessage,
  loadIdentityDeviceCenter,
  rejectDesktopChallenge,
  revokeDesktopDevice,
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
  const operationRef = useRef('');
  const requestContextRef = useRef<any>(null);

  const load = useCallback(async () => {
    setViewState('loading');
    setErrorCode('');
    try {
      const runtimeConfig = await getRuntimeConfig();
      const session = readDesktopAuthorizationSession();
      const baseUrl = resolvePairingApiBase(runtimeConfig, window.location);
      requestContextRef.current = { runtimeConfig, session, baseUrl };
      const next = await loadIdentityDeviceCenter({ runtimeConfig, session, baseUrl });
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

  const confirmApproval = (row: any) => {
    Modal.confirm({
      title: `\u6279\u51c6 ${row.deviceName}`,
      content: <div>
        <p>{'\u7533\u8bf7\u4eba\u5df2\u7531\u672c\u6b21\u5fae\u4fe1\u624b\u673a\u53f7\u9a8c\u8bc1\u56fa\u5b9a\u4e3a\uff1a'}{row.claimant.name}{'\uff08'}{row.claimant.maskedPhone || '\u624b\u673a\u53f7\u5df2\u8131\u654f'}{'\uff09\u3002'}</p>
        {row.sameClaimantAndReviewer && <p className="identity-device-center__same-owner">{'\u7533\u8bf7\u4eba\u4e0e\u5ba1\u6279\u4eba\u76f8\u540c\uff0c\u4f46\u5ba1\u6279\u6765\u81ea\u53e6\u4e00\u53f0\u53ef\u4fe1\u8bbe\u5907\u3002'}</p>}
        <p>{'\u6279\u51c6\u540e\uff0c\u65b0\u7535\u8111\u4ecd\u9700\u8bbe\u7f6e\u81ea\u5df1\u7684\u672c\u673a\u5bc6\u7801\uff0c\u4e0d\u80fd\u53d6\u5f97\u5f53\u524d\u4e3b\u673a\u5bc6\u7801\u3002'}</p>
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

  const pendingColumns: ColumnsType<any> = [
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
        </Descriptions>
      </Card>
    </>}
  </main>;
};

export default IdentityDeviceCenter;
