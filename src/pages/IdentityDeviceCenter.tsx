import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Empty, Modal, Table, Tag, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { getRuntimeConfig } from '../services/runtimeConfigClient';
import { readDesktopAuthorizationSession } from '../services/desktopAuthorizationSession.mjs';
import { resolveDesktopIdentityBaseUrl } from '../services/managedSyncConfig.mjs';
import { deviceStatusPresentation } from '../services/deviceStatusPresentation.mjs';
import {
  buildRevocationBody,
  identityDeviceCenterErrorMessage,
  loadIdentityDeviceCenter,
  revokeDesktopDevice,
} from '../services/identityDeviceCenterPolicy.mjs';
import AuthorityRoleApplicationsPanel from '../components/AuthorityRoleApplicationsPanel';
import './IdentityDeviceCenter.css';

function localTime(value?: string | null): string {
  if (!value) return '--';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { hour12: false }) : '--';
}

const IdentityDeviceCenter: React.FC = () => {
  const [snapshot, setSnapshot] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [errorCode, setErrorCode] = useState('');
  const [operationKey, setOperationKey] = useState('');
  const requestContextRef = useRef<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErrorCode('');
    try {
      const runtimeConfig = await getRuntimeConfig();
      let session;
      try {
        session = readDesktopAuthorizationSession();
      } catch (sessionError) {
        const provider = (window as any).desktopIdentitySessionProvider;
        if (!provider?.ensureOnline) throw sessionError;
        await provider.ensureOnline();
        session = readDesktopAuthorizationSession();
      }
      const baseUrl = resolveDesktopIdentityBaseUrl(runtimeConfig);
      requestContextRef.current = { runtimeConfig, session, baseUrl };
      const next = await loadIdentityDeviceCenter({ runtimeConfig, session, baseUrl });
      setSnapshot(next);
      window.dispatchEvent(new CustomEvent('identity-device-center-updated', {
        detail: { pendingCount: 0 },
      }));
    } catch (error: any) {
      setErrorCode(error?.code || 'DESKTOP_DEVICE_CENTER_REQUEST_FAILED');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const confirmRevocation = (device: any) => {
    Modal.confirm({
      title: `\u64a4\u9500 ${device.deviceName}`,
      content: '\u64a4\u9500\u540e\uff0c\u8be5\u7535\u8111\u7684\u4f1a\u8bdd\u3001\u79bb\u7ebf\u79df\u7ea6\u548c\u8bbe\u5907\u5bc6\u94a5\u4f1a\u7acb\u5373\u5931\u6548\u3002',
      okText: '\u786e\u8ba4\u64a4\u9500',
      cancelText: '\u53d6\u6d88',
      okButtonProps: { danger: true },
      async onOk() {
        const context = requestContextRef.current;
        if (!context || operationKey) return;
        setOperationKey(device.deviceId);
        try {
          await revokeDesktopDevice({
            ...context,
            request: buildRevocationBody(device, { reason: 'user_request' }),
          });
          message.success('\u8bbe\u5907\u5df2\u64a4\u9500');
          await load();
        } catch (error: any) {
          const code = error?.code || 'DESKTOP_DEVICE_REVOCATION_FAILED';
          setErrorCode(code);
          message.error(identityDeviceCenterErrorMessage(code));
        } finally {
          setOperationKey('');
        }
      },
    });
  };

  const columns: ColumnsType<any> = [
    { title: '\u8bbe\u5907\u540d\u79f0', dataIndex: 'deviceName', key: 'deviceName' },
    { title: '\u72b6\u6001', key: 'status', render: (_, row) => {
      const presentation = deviceStatusPresentation(row);
      return <Tag color={presentation.color}>{presentation.label}</Tag>;
    } },
    { title: '\u767b\u5f55\u65f6\u95f4', dataIndex: 'approvedAt', key: 'approvedAt', render: localTime },
    { title: '\u6700\u8fd1\u6d3b\u8dc3', dataIndex: 'lastSeenAt', key: 'lastSeenAt', render: localTime },
    { title: '\u64cd\u4f5c', key: 'action', render: (_, row) => row.isCurrent
      ? <Tag color="blue">当前设备</Tag>
      : row.canRevoke ? <Button danger size="small" loading={operationKey === row.deviceId} onClick={() => confirmRevocation(row)}>撤销</Button>
        : '--' },
  ];

  return (
    <div className="identity-device-center">
      {/* UTF-8: Login registration stays silent; manage existing devices here. */}
      <Card title={'我的登录设备'} extra={<Button loading={loading} onClick={() => void load()}>刷新</Button>}>
        {errorCode && <Alert type="error" showIcon style={{ marginBottom: 16 }} message={identityDeviceCenterErrorMessage(errorCode)} />}
        {loading ? <div className="identity-device-center__loading">正在读取设备信息…</div>
          : (snapshot?.mine || []).length ? <Table rowKey="deviceId" columns={columns} dataSource={snapshot.mine} pagination={{ pageSize: 5, showSizeChanger: false }} scroll={{ x: 720 }} />
            : <Empty description={'暂无登录设备'} />}
      </Card>
      {/* UTF-8: The review panel supplies its own heading; avoid nested duplicate cards. */}
      {snapshot?.access?.canReview && <div style={{ marginTop: 16 }}><AuthorityRoleApplicationsPanel /></div>}
    </div>
  );
};

export default IdentityDeviceCenter;
