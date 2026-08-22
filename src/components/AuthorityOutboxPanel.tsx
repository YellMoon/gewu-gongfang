import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Descriptions, Empty, Modal, Space, Statistic, Table, Tag, message } from 'antd';
import { CheckCircleOutlined, ReloadOutlined, SafetyCertificateOutlined, SyncOutlined } from '@ant-design/icons';
import { readDesktopAuthorizationSession } from '../services/desktopAuthorizationSession.mjs';

type AuthorityOutboxItem = {
  id: string;
  type: string;
  preview?: Record<string, unknown>;
  status: 'awaiting_confirmation' | 'confirmed' | 'submitted' | 'completed' | 'conflict';
  submission?: { transportUsed?: string } | null;
  receipt?: { projectionVersion?: number } | null;
  conflict?: { code?: string } | null;
};

type Props = {
  compact?: boolean;
  focus?: 'issues' | 'pending';
};

const copy = {
  title: '\u4e91\u7aef\u6743\u5a01\u6570\u636e\u540c\u6b65',
  refresh: '\u5237\u65b0',
  waitConfirm: '\u7b49\u5f85\u786e\u8ba4',
  confirmed: '\u5df2\u786e\u8ba4\uff0c\u5f85\u53d1\u9001',
  waitReceipt: '\u7b49\u5f85\u4e91\u7aef\u56de\u6267',
  completed: '\u5df2\u5b8c\u6210',
  issue: '\u9700\u8981\u5904\u7406',
  modalTitle: '\u786e\u8ba4\u63d0\u4ea4\u5230\u4e91\u7aef\u6743\u5a01\u6570\u636e',
  commandType: '\u547d\u4ee4\u7c7b\u578b',
  preview: '\u5f71\u54cd\u9884\u89c8',
  safety: '\u5b89\u5168\u8bf4\u660e',
  safetyText: '\u786e\u8ba4\u540e\u624d\u4f1a\u53d1\u9001\uff1b\u4e91\u7aef\u5c06\u91cd\u65b0\u6821\u9a8c\u684c\u9762\u4f1a\u8bdd\u3001\u8bbe\u5907\u3001\u89d2\u8272\u548c\u5b57\u6bb5\u8303\u56f4\u3002',
  confirm: '\u786e\u8ba4\u5e76\u53d1\u9001',
  keep: '\u7ee7\u7eed\u4fdd\u7559\u8349\u7a3f',
  retry: '\u91cd\u8bd5\u540c\u4e00\u547d\u4ee4',
  retained: '\u4fdd\u7559\uff0c\u7b49\u5f85\u5904\u7406',
  state: '\u72b6\u6001',
  transport: '\u4f20\u8f93 / \u6295\u5f71',
  actions: '\u64cd\u4f5c',
  authorityMessage: '\u9002\u7528\u4e1a\u52a1\u6570\u636e\u4e0e\u9898\u5e93\u6587\u5b57\u5199\u5165\u5747\u7531\u4e91\u7aef\u88c1\u51b3',
  conflictMessage: '\u5b58\u5728\u56de\u6267\u51b2\u7a81\uff0c\u8349\u7a3f\u5df2\u4fdd\u7559',
  authorityDescription: '\u79bb\u7ebf\u7f16\u8f91\u5148\u8fdb\u5165\u672c\u673a\u52a0\u5bc6\u8349\u7a3f\u7bb1\uff1b\u53ea\u6709\u660e\u786e\u786e\u8ba4\u4e14\u5728\u7ebf\u65f6\uff0c\u624d\u4f1a\u63d0\u4ea4\u4e91\u7aef\u88c1\u51b3\u3002\u9898\u5e93\u547d\u4ee4\u4f7f\u7528\u5f53\u6b21\u684c\u9762\u4f1a\u8bdd\uff0c\u4e0d\u4f1a\u5199\u5165\u8349\u7a3f\u6216 NAS\u3002',
  empty: '\u5f53\u524d\u6ca1\u6709\u7b26\u5408\u6761\u4ef6\u7684\u6743\u5a01\u547d\u4ee4',
  wsTitle: '\u4e91\u7aef\u63d0\u4ea4\u4e0d\u4f9d\u8d56\u5c40\u57df\u7f51\u4e3b\u673a',
  wsDescription: '\u4efb\u610f\u7535\u8111\u4e0a\u7684\u7edf\u4e00\u684c\u9762\u7aef\u90fd\u53ef\u4fdd\u7559\u79bb\u7ebf\u8349\u7a3f\uff1b\u4e0a\u7ebf\u540e\u9700\u8981\u4f60\u786e\u8ba4\uff0c\u4e0d\u4f1a\u9759\u9ed8\u63a8\u9001\u3002',
};

function requireBridge() {
  if (!window.desktopAuthority) throw new Error('DESKTOP_AUTHORITY_BRIDGE_UNAVAILABLE');
  return window.desktopAuthority;
}

function statusTag(item: AuthorityOutboxItem) {
  if (item.status === 'awaiting_confirmation') return <Tag color="gold">{copy.waitConfirm}</Tag>;
  if (item.status === 'confirmed') return <Tag color="blue">{copy.confirmed}</Tag>;
  if (item.status === 'submitted') return <Tag color="processing">{copy.waitReceipt}</Tag>;
  if (item.status === 'completed') return <Tag color="success">{copy.completed}</Tag>;
  return <Tag color="error">{copy.issue}</Tag>;
}

function previewText(item: AuthorityOutboxItem) {
  const preview = item.preview || {};
  return String(preview.title || preview.summary || item.type);
}

function cloudQuestionSubmissionInput(item: AuthorityOutboxItem) {
  if (!/^question\.(create|update|delete)\.v\d+$/.test(item.type)) return undefined;
  const authorization = readDesktopAuthorizationSession().authorization;
  const match = /^Bearer (.+)$/.exec(authorization);
  if (!match) throw new Error('DESKTOP_CLOUD_SESSION_REQUIRED');
  return { sessionToken: match[1] };
}

const AuthorityOutboxPanel: React.FC<Props> = ({ compact = false, focus }) => {
  const [items, setItems] = useState<AuthorityOutboxItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorCode, setErrorCode] = useState('');
  const [busyId, setBusyId] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await requireBridge().list();
      setItems(Array.isArray(next) ? next : []);
      setErrorCode('');
    } catch (error: any) {
      setErrorCode(error?.code || error?.message || 'AUTHORITY_OUTBOX_LOAD_FAILED');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const counts = useMemo(() => ({
    confirmation: items.filter(item => item.status === 'awaiting_confirmation').length,
    pending: items.filter(item => ['confirmed', 'submitted'].includes(item.status)).length,
    issues: items.filter(item => item.status === 'conflict').length,
    completed: items.filter(item => item.status === 'completed').length,
  }), [items]);

  const confirmAndSubmit = (item: AuthorityOutboxItem) => {
    Modal.confirm({
      title: copy.modalTitle,
      width: 560,
      content: (
        <Descriptions column={1} size="small" bordered>
          <Descriptions.Item label={copy.commandType}>{item.type}</Descriptions.Item>
          <Descriptions.Item label={copy.preview}>{previewText(item)}</Descriptions.Item>
          <Descriptions.Item label={copy.safety}>{copy.safetyText}</Descriptions.Item>
        </Descriptions>
      ),
      okText: copy.confirm,
      cancelText: copy.keep,
      onOk: async () => {
        setBusyId(item.id);
        try {
          const result = await requireBridge().confirmAndSubmit(item.id, cloudQuestionSubmissionInput(item));
          if (result.receipt?.status === 'rejected') {
            message.error(result.receipt?.result?.error?.code || 'AUTHORITY_COMMAND_REJECTED');
          } else {
            message.success(`${copy.completed} (${result.transportUsed})`);
            await (window as any).dbService?.refreshAuthorityProjection?.({
              minSourceVersion: result.receipt?.projectionVersion || 0,
            });
          }
        } catch (error: any) {
          message.error(error?.code || error?.message || 'AUTHORITY_COMMAND_SUBMIT_FAILED');
        } finally {
          setBusyId('');
          await refresh();
        }
      },
    });
  };

  const retry = async (item: AuthorityOutboxItem) => {
    setBusyId(item.id);
    try {
      const result = await requireBridge().submit(item.id, cloudQuestionSubmissionInput(item));
      if (result) {
        if (result.receipt?.status === 'rejected') {
          message.error(result.receipt?.result?.error?.code || 'AUTHORITY_COMMAND_REJECTED');
        } else {
          message.success(`${copy.completed} (${result.transportUsed})`);
          await (window as any).dbService?.refreshAuthorityProjection?.({
            minSourceVersion: result.receipt?.projectionVersion || 0,
          });
        }
      }
    } catch (error: any) {
      message.error(error?.code || error?.message || 'AUTHORITY_COMMAND_RETRY_FAILED');
    } finally {
      setBusyId('');
      await refresh();
    }
  };

  const visibleItems = focus === 'issues'
    ? items.filter(item => item.status === 'conflict')
    : focus === 'pending'
      ? items.filter(item => item.status !== 'completed')
      : items;

  const columns = [
    { title: copy.state, width: 140, render: (_: unknown, item: AuthorityOutboxItem) => statusTag(item) },
    {
      title: copy.preview,
      render: (_: unknown, item: AuthorityOutboxItem) => (
        <div><div>{previewText(item)}</div><small>{item.type}</small></div>
      ),
    },
    {
      title: copy.transport,
      width: 180,
      render: (_: unknown, item: AuthorityOutboxItem) => (
        <div>
          <div>{item.submission?.transportUsed !== 'pending' ? item.submission?.transportUsed || '--' : '--'}</div>
          <small>{Number.isSafeInteger(item.receipt?.projectionVersion)
            ? `projection v${item.receipt?.projectionVersion}` : item.conflict?.code || ''}</small>
        </div>
      ),
    },
    {
      title: copy.actions,
      width: 170,
      render: (_: unknown, item: AuthorityOutboxItem) => {
        if (item.status === 'awaiting_confirmation') {
          return <Button type="primary" size="small" loading={busyId === item.id}
            onClick={() => confirmAndSubmit(item)}>{copy.preview}</Button>;
        }
        if (item.status === 'confirmed' || item.status === 'submitted') {
          return <Button size="small" loading={busyId === item.id}
            onClick={() => void retry(item)}>{copy.retry}</Button>;
        }
        return item.status === 'completed'
          ? <CheckCircleOutlined style={{ color: '#52c41a' }} />
          : <span style={{ color: '#cf1322' }}>{copy.retained}</span>;
      },
    },
  ];

  return (
    <Card title={<span><SafetyCertificateOutlined /> {copy.title}</span>}
      extra={<Button icon={<ReloadOutlined />} loading={loading}
        onClick={() => void refresh()}>{copy.refresh}</Button>}>
      <Alert type={errorCode ? 'error' : counts.issues ? 'warning' : 'info'} showIcon
        message={errorCode || (counts.issues ? copy.conflictMessage : copy.authorityMessage)}
        description={copy.authorityDescription} style={{ marginBottom: 16 }} />
      <Space size="large" wrap style={{ marginBottom: 20 }}>
        <Statistic title={copy.waitConfirm} value={counts.confirmation} />
        <Statistic title={copy.waitReceipt} value={counts.pending} />
        <Statistic title={copy.issue} value={counts.issues} />
        {!compact && <Statistic title={copy.completed} value={counts.completed} />}
      </Space>
      {visibleItems.length === 0
        ? <Empty description={copy.empty} />
        : <Table rowKey="id" size={compact ? 'small' : 'middle'}
          pagination={{ pageSize: compact ? 5 : 10 }} columns={columns} dataSource={visibleItems} />}
      <Alert type="success" showIcon icon={<SyncOutlined />} message={copy.wsTitle}
        description={copy.wsDescription} style={{ marginTop: 16 }} />
    </Card>
  );
};

export default AuthorityOutboxPanel;
