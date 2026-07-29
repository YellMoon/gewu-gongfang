import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Descriptions, Space, Statistic, Tag } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';

type HostRuntimeStatus = {
  ready?: boolean;
  worker?: { running?: boolean };
  projections?: { running?: boolean };
  cloud?: { state?: string; lastError?: string | null };
  queue?: { lastProcessed?: number; lastCompletedAt?: string | null; inFlight?: boolean; retry?: unknown };
};

function renderTimestamp(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

const HostAuthorityExecutionMonitor: React.FC = () => {
  const [status, setStatus] = useState<HostRuntimeStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorCode, setErrorCode] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await window.primaryHostRuntime?.runtimeStatus?.();
      if (!next) throw Object.assign(new Error('PRIMARY_HOST_RUNTIME_UNAVAILABLE'), { code: 'PRIMARY_HOST_RUNTIME_UNAVAILABLE' });
      setStatus(next as HostRuntimeStatus);
      setErrorCode('');
    } catch (error: any) {
      setErrorCode(String(error?.code || error?.message || 'PRIMARY_HOST_RUNTIME_STATUS_FAILED'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const queue = status?.queue || {};
  const healthy = status?.ready === true && status?.worker?.running === true && status?.projections?.running === true;
  return (
    <Card
      title={'\u4e3b\u673a\u63a5\u6536\u4e0e\u6267\u884c\u76d1\u63a7'}
      extra={<Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={() => void refresh()}>{'\u5237\u65b0'}</Button>}
    >
      <Alert
        type={healthy ? 'success' : 'warning'}
        showIcon
        message={healthy ? '\u6743\u5a01\u4e3b\u673a\u6b63\u5728\u63a5\u6536\u3001\u6267\u884c\u5e76\u53d1\u5e03\u6295\u5f71' : '\u4e3b\u673a\u6267\u884c\u94fe\u8def\u5c1a\u672a\u5c31\u7eea'}
        description={'\u4e3b\u673a\u4e0d\u4f1a\u5411\u81ea\u5df1\u53d1\u8d77\u540c\u6b65\u547d\u4ee4\uff1b\u53ea\u8d23\u4ef7\u88c1\u5ba2\u6237\u7aef\u5df2\u786e\u8ba4\u7684\u547d\u4ee4\u5e76\u53d1\u5e03\u8303\u56f4\u6295\u5f71\u3002'}
        style={{ marginBottom: 16 }}
      />
      {errorCode && <Alert type="error" showIcon message={errorCode} style={{ marginBottom: 16 }} />}
      <Space size="large" wrap style={{ marginBottom: 16 }}>
        <Statistic title={'\u5df2\u5904\u7406\u547d\u4ee4'} value={Number(queue.lastProcessed || 0)} />
        <Statistic title={'\u6b63\u5728\u6267\u884c'} value={queue.inFlight ? 1 : 0} />
      </Space>
      <Descriptions bordered size="small" column={1}>
        <Descriptions.Item label={'\u547d\u4ee4 worker'}><Tag color={status?.worker?.running ? 'success' : 'default'}>{status?.worker?.running ? '\u8fd0\u884c\u4e2d' : '\u672a\u8fd0\u884c'}</Tag></Descriptions.Item>
        <Descriptions.Item label={'\u6295\u5f71\u53d1\u5e03'}><Tag color={status?.projections?.running ? 'success' : 'default'}>{status?.projections?.running ? '\u8fd0\u884c\u4e2d' : '\u672a\u8fd0\u884c'}</Tag></Descriptions.Item>
        <Descriptions.Item label={'\u4e0a\u6b21\u5b8c\u6210'}>{renderTimestamp(queue.lastCompletedAt)}</Descriptions.Item>
        <Descriptions.Item label={'\u4e91\u4e2d\u7ee7'}>{status?.cloud?.state || '-'}</Descriptions.Item>
        <Descriptions.Item label={'\u91cd\u8bd5\u4fe1\u606f'}>{queue.retry ? JSON.stringify(queue.retry) : '-'}</Descriptions.Item>
      </Descriptions>
    </Card>
  );
};

export default HostAuthorityExecutionMonitor;
