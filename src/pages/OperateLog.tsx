import React, { useEffect, useState } from 'react';
import { Alert, Button, DatePicker, Descriptions, Empty, Input, Modal, Space, Tag, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import Table from '../components/NumberedTable';
import AutoCloseSelect from '../components/AutoCloseSelect';
import DataPageLayout from '../layout/DataPageLayout';
import { getRuntimeConfig } from '../services/runtimeConfigClient';
import { readDesktopAuthorizationSession } from '../services/desktopAuthorizationSession.mjs';
import { resolveDesktopIdentityBaseUrl } from '../services/managedSyncConfig.mjs';
import { loadOperationAudits, auditErrorMessage, auditActionLabels, auditStatusLabels, auditResourceLabels, auditFieldLabel } from '../services/operationAuditClient.mjs';

interface AuditLogEntry {
  id: string; createdAt: string; actorName?: string; actorId: string; deviceId?: string;
  action: string; resourceType: string; resourceId?: string; status: string; summary?: string; detail?: Record<string, unknown>;
}
const label = (labels: Record<string, string>, value: string) => labels[value] || value || '—';
const localTime = (value: string) => value && dayjs(value).isValid() ? dayjs(value).format('YYYY-MM-DD HH:mm:ss') : '—';
const statusColor: Record<string, string> = { success: 'green', conflict: 'orange', error: 'red', rejected: 'volcano', unknown: 'default' };

function DetailValue({ value }: { value: unknown }): React.ReactElement {
  if (Array.isArray(value)) return <span>{value.length ? value.map((item, index) => <div key={index}><DetailValue value={item} /></div>) : '无'}</span>;
  if (value && typeof value === 'object') return <Descriptions size="small" column={1} bordered>{Object.entries(value).map(([key, item]) => <Descriptions.Item key={key} label={auditFieldLabel(key)}><DetailValue value={item} /></Descriptions.Item>)}</Descriptions>;
  return <span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{value === null || value === undefined ? '—' : typeof value === 'boolean' ? (value ? '是' : '否') : value === '[redacted]' ? '已隐藏' : value === 'submitted-fields-only' ? '仅记录提交字段' : String(value)}</span>;
}

const OperateLog: React.FC = () => {
  const [snapshot, setSnapshot] = useState<{ items: AuditLogEntry[]; total: number; scope: string }>({ items: [], total: 0, scope: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ page: 1, pageSize: 20, q: '', action: '', status: '', from: '', to: '' });
  const [search, setSearch] = useState('');
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<AuditLogEntry | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setSelected(null);
    const load = async () => {
      try {
        const config = await getRuntimeConfig();
        let session;
        try { session = readDesktopAuthorizationSession(); } catch (error) {
          const provider = (window as any).desktopIdentitySessionProvider;
          if (!provider?.ensureOnline) throw error;
          await provider.ensureOnline();
          session = readDesktopAuthorizationSession();
        }
        if (controller.signal.aborted) return;
        const data = await loadOperationAudits({ baseUrl: resolveDesktopIdentityBaseUrl(config), session, filters, signal: controller.signal });
        if (!controller.signal.aborted) {
          if (filters.page > 1 && !data.items.length && data.total <= (filters.page - 1) * filters.pageSize) {
            setFilters(previous => ({ ...previous, page: Math.max(1, Math.ceil(data.total / previous.pageSize)) }));
          } else setSnapshot(data);
        }
      } catch (error: any) {
        if (!controller.signal.aborted) { setSnapshot({ items: [], total: 0, scope: '' }); setError(auditErrorMessage(error?.code)); }
      } finally { if (!controller.signal.aborted) setLoading(false); }
    };
    void load();
    return () => controller.abort();
  }, [filters, revision]);

  const columns: ColumnsType<AuditLogEntry> = [
    { title: '时间', dataIndex: 'createdAt', width: 172, render: localTime },
    { title: '操作者', key: 'actor', width: 130, render: (_, row) => <span title={row.actorId}>{row.actorName || row.actorId || '—'}</span> },
    { title: '操作', dataIndex: 'action', width: 88, render: (value: string) => label(auditActionLabels, value) },
    { title: '结果', dataIndex: 'status', width: 110, render: (value: string) => <Tag color={statusColor[value]}>{label(auditStatusLabels, value)}</Tag> },
    { title: '对象', key: 'resource', width: 210, render: (_, row) => <><div>{label(auditResourceLabels, row.resourceType)}</div><Typography.Text type="secondary" style={{ fontSize: 12, overflowWrap: 'anywhere' }}>{row.resourceId || '—'}</Typography.Text></> },
    { title: '操作摘要', key: 'summary', render: (_, row) => row.summary || `${label(auditActionLabels, row.action)}${label(auditResourceLabels, row.resourceType)}` },
    { title: '详情', key: 'detail', width: 90, fixed: 'right', render: (_, row) => <Button type="link" size="small" onClick={() => setSelected(row)}>查看详情</Button> },
  ];

  return <>
    <DataPageLayout toolbar={<Space direction="vertical" style={{ width: '100%' }}>
      <Space wrap>
        <Tag color="blue">云端操作日志 · {snapshot.scope === 'tenant' ? '全部操作者' : snapshot.scope === 'self' ? '我的操作' : error ? '连接失败' : '加载中'}</Tag>
        <DatePicker.RangePicker size="small" onChange={dates => setFilters(previous => ({ ...previous, page: 1, from: dates?.[0]?.startOf('day').toISOString() || '', to: dates?.[1]?.endOf('day').toISOString() || '' }))} />
        <AutoCloseSelect placeholder="全部操作" allowClear style={{ width: 120 }} size="small" value={filters.action || undefined} options={Object.entries(auditActionLabels).map(([value, text]) => ({ value, label: text }))} onChange={(value: string | undefined) => setFilters(previous => ({ ...previous, page: 1, action: value || '' }))} />
        <AutoCloseSelect placeholder="全部结果" allowClear style={{ width: 135 }} size="small" value={filters.status || undefined} options={Object.entries(auditStatusLabels).map(([value, text]) => ({ value, label: text }))} onChange={(value: string | undefined) => setFilters(previous => ({ ...previous, page: 1, status: value || '' }))} />
        <Input.Search placeholder="搜索操作者、对象、摘要" allowClear maxLength={160} style={{ width: 250 }} size="small" value={search} onChange={event => { setSearch(event.target.value); if (!event.target.value) setFilters(previous => ({ ...previous, page: 1, q: '' })); }} onSearch={q => setFilters(previous => ({ ...previous, page: 1, q: q.trim() }))} />
        <Button size="small" loading={loading} icon={<ReloadOutlined />} onClick={() => setRevision(value => value + 1)}>刷新</Button>
      </Space>
      <Typography.Text type="secondary">按时间从新到旧展示云端收到的操作。离线草稿在确认提交后记录；未曾留存的历史操作无法补录。</Typography.Text>
      {error && <Alert type="error" showIcon message={error} action={<Button size="small" onClick={() => setRevision(value => value + 1)}>重试</Button>} />}
    </Space>} table={<Table loading={loading} dataSource={snapshot.items} columns={columns} rowKey="id" size="middle" scroll={{ x: 1040 }} locale={{ emptyText: <Empty description={error ? '日志加载失败' : '暂无符合条件的云端操作记录'} /> }} pagination={{ current: filters.page, pageSize: filters.pageSize, total: snapshot.total, showSizeChanger: true, pageSizeOptions: [20, 50, 100], showTotal: total => `共 ${total} 条`, onChange: (page, pageSize) => setFilters(previous => ({ ...previous, page: pageSize === previous.pageSize ? page : 1, pageSize })) }} />} />
    <Modal title="操作详情" open={!!selected} onCancel={() => setSelected(null)} footer={<Button onClick={() => setSelected(null)}>关闭</Button>} width={760}>
      {selected && <Space direction="vertical" style={{ width: '100%' }}>
        {selected.status === 'unknown' && <Alert showIcon type="warning" message="云端已收到操作，但尚无最终结果。请刷新日志并核对业务记录，避免重复提交。" />}
        <Descriptions size="small" column={1} bordered>
          <Descriptions.Item label="时间">{localTime(selected.createdAt)}</Descriptions.Item>
          <Descriptions.Item label="操作者">{selected.actorName || selected.actorId}</Descriptions.Item>
          <Descriptions.Item label="设备">{selected.deviceId || '未提供设备信息'}</Descriptions.Item>
          <Descriptions.Item label="操作对象">{label(auditResourceLabels, selected.resourceType)} / {selected.resourceId || '—'}</Descriptions.Item>
          <Descriptions.Item label="结果">{label(auditStatusLabels, selected.status)}</Descriptions.Item>
          <Descriptions.Item label="日志编号">{selected.id}</Descriptions.Item>
        </Descriptions>
        <Typography.Text type="secondary">以下为云端记录的安全字段摘要，不包含凭据和完整原始内容，也不代表修改前的完整快照。</Typography.Text>
        <DetailValue value={selected.detail || {}} />
      </Space>}
    </Modal>
  </>;
};
export default OperateLog;
