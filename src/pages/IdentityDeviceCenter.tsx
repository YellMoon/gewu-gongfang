import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Empty, Modal, Space, Table, Tag, message } from 'antd';
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
      ? <Tag color="blue">\u5f53\u524d\u8bbe\u5907</Tag>
      : row.canRevoke ? <Button danger size="small" loading={operationKey === row.deviceId} onClick={() => confirmRevocation(row)}>\u64a4\u9500</Button>
        : '--' },
  ];

  return (
    <div className="identity-device-center">
      <Card title={'\u6211\u7684\u5df2\u767b\u8bb0\u8bbe\u5907'} extra={<Button loading={loading} onClick={() => void load()}>\u5237\u65b0</Button>}>
        <Alert type="info" showIcon style={{ marginBottom: 16 }} message={'\u65b0\u7535\u8111\u767b\u5f55'} description={'\u65b0\u8bbe\u5907\u9996\u6b21\u767b\u5f55\u5fc5\u987b\u8054\u7f51\u5b8c\u6210\u8d26\u53f7\u9a8c\u8bc1\uff0c\u6210\u529f\u540e\u7531\u4e91\u7aef\u9759\u9ed8\u767b\u8bb0\u3002\u65e0\u9700\u4eba\u5de5\u8bbe\u5907\u5ba1\u6279\u3001\u65e7\u8bbe\u5907\u786e\u8ba4\u6216\u4e3b\u673a\u653e\u884c\u3002'} />
        {errorCode && <Alert type="error" showIcon style={{ marginBottom: 16 }} message={identityDeviceCenterErrorMessage(errorCode)} />}
        {loading ? <div className="identity-device-center__loading">\u6b63\u5728\u8bfb\u53d6\u4e91\u7aef\u8bbe\u5907\u8bb0\u5f55\u2026</div>
          : (snapshot?.mine || []).length ? <Table rowKey="deviceId" columns={columns} dataSource={snapshot.mine} pagination={false} scroll={{ x: 720 }} />
            : <Empty description={'\u6682\u65e0\u5df2\u767b\u8bb0\u8bbe\u5907'} />}
      </Card>
      {snapshot?.access?.canReview && <Card title={'\u8d26\u53f7\u6743\u9650\u7533\u8bf7'} style={{ marginTop: 16 }}><AuthorityRoleApplicationsPanel /></Card>}
      <Space size="small" style={{ marginTop: 12 }}><Tag>\u4e91\u7aef\u88c1\u51b3</Tag><span>\u672c\u673a\u53ea\u4fdd\u5b58\u53ef\u786e\u8ba4\u63d0\u4ea4\u7684\u79bb\u7ebf\u8349\u7a3f\u3002</span></Space>
    </div>
  );
};

export default IdentityDeviceCenter;
