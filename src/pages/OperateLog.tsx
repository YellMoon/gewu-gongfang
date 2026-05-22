import React, { useEffect, useMemo, useState } from 'react';
import { Table, Button, DatePicker, Space, Tag, Card, message, Empty, Input, Select as AntSelect } from 'antd';
import { FileTextOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import logger, { OperateLogEntry } from '../services/operateLogger';
import AutoCloseSelect from '../components/AutoCloseSelect';

const Select = AutoCloseSelect as typeof AntSelect;

interface AuditLogEntry {
  id: string;
  tenant_id?: string;
  actor?: string;
  audit_type?: 'operation' | 'sync' | 'local';
  action: string;
  table_name?: string | null;
  record_id?: string | null;
  client_id?: string | null;
  resolution?: string | null;
  status: string;
  detail?: string | null;
  created_at: string;
}

const ACTION_TYPE_COLORS: Record<string, string> = {
  create: 'green',
  update: 'blue',
  delete: 'red',
  import: 'gold',
  push: 'cyan',
  pull: 'cyan',
  sync: 'cyan',
};

const STATUS_COLORS: Record<string, string> = {
  success: 'green',
  conflict: 'red',
  error: 'volcano',
  partial: 'orange',
  not_found: 'default',
};

function localLogToAudit(log: OperateLogEntry): AuditLogEntry {
  return {
    id: log.id,
    actor: log.user,
    audit_type: 'local',
    action: log.actionType,
    table_name: log.source,
    status: 'success',
    detail: log.detail,
    created_at: log.timestamp,
  };
}

function parseDetail(detail?: string | null): string {
  if (!detail) return '';
  try {
    const parsed = JSON.parse(detail);
    return JSON.stringify(parsed);
  } catch {
    return detail;
  }
}

const OperateLog: React.FC = () => {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterDate, setFilterDate] = useState<[dayjs.Dayjs | null, dayjs.Dayjs | null]>([null, null]);
  const [filterAction, setFilterAction] = useState<string | undefined>();
  const [filterStatus, setFilterStatus] = useState<string | undefined>();
  const [searchText, setSearchText] = useState('');

  const loadLogs = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/ops/audit?limit=300');
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || '审计日志加载失败');
      }
      setLogs(payload.logs || []);
    } catch (err: any) {
      setLogs(logger.getAll().map(localLogToAudit));
      message.warning(err?.message || '后端审计不可用，已显示本地日志');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLogs();
  }, []);

  const filteredLogs = useMemo(() => logs.filter(log => {
    if (filterDate[0] && filterDate[1]) {
      const logDate = dayjs(log.created_at);
      if (logDate.isBefore(filterDate[0].startOf('day')) || logDate.isAfter(filterDate[1].endOf('day'))) return false;
    }
    if (filterAction && log.action !== filterAction) return false;
    if (filterStatus && log.status !== filterStatus) return false;
    if (searchText) {
      const s = searchText.toLowerCase();
      const haystack = [
        log.actor,
        log.action,
        log.table_name,
        log.record_id,
        log.status,
        log.audit_type,
        parseDetail(log.detail),
      ].filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(s)) return false;
    }
    return true;
  }), [filterAction, filterDate, filterStatus, logs, searchText]);

  const allActions = Array.from(new Set(logs.map(l => l.action))).filter(Boolean);
  const allStatuses = Array.from(new Set(logs.map(l => l.status))).filter(Boolean);

  const columns: ColumnsType<AuditLogEntry> = [
    {
      title: '时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 190,
      sorter: (a, b) => dayjs(b.created_at).unix() - dayjs(a.created_at).unix(),
      defaultSortOrder: 'descend',
      render: (value: string) => dayjs(value).format('YYYY-MM-DD HH:mm:ss'),
    },
    {
      title: '类型',
      dataIndex: 'audit_type',
      key: 'audit_type',
      width: 100,
      render: (type: string) => <Tag color={type === 'sync' ? 'cyan' : 'blue'}>{type || 'operation'}</Tag>,
    },
    {
      title: '操作',
      dataIndex: 'action',
      key: 'action',
      width: 100,
      render: (action: string) => <Tag color={ACTION_TYPE_COLORS[action] || 'default'}>{action}</Tag>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: string) => <Tag color={STATUS_COLORS[status] || 'default'}>{status}</Tag>,
    },
    {
      title: '对象',
      key: 'target',
      width: 220,
      render: (_, record) => (
        <span>{record.table_name || '-'}{record.record_id ? ` / ${record.record_id}` : ''}</span>
      ),
    },
    {
      title: '操作者',
      key: 'actor',
      width: 140,
      render: (_, record) => record.actor || record.client_id || '-',
    },
    {
      title: '详情',
      dataIndex: 'detail',
      key: 'detail',
      render: (detail: string | null, record) => (
        <span style={{ fontSize: 13 }}>
          {record.resolution ? `[${record.resolution}] ` : ''}{parseDetail(detail)}
        </span>
      ),
    },
  ];

  return (
    <div style={{ padding: 16 }}>
      <Card
        title={<span><FileTextOutlined style={{ marginRight: 8 }} />操作审计 <Tag color="blue">{logs.length}条</Tag></span>}
        extra={
          <Space>
            <DatePicker.RangePicker
              onChange={(dates) => setFilterDate(dates && dates[0] && dates[1] ? [dates[0], dates[1]] : [null, null])}
              placeholder={['开始日期', '结束日期']}
              size="small"
            />
            <Button icon={<ReloadOutlined />} onClick={loadLogs} size="small">刷新</Button>
          </Space>
        }
      >
        <div style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Select placeholder="操作" allowClear style={{ width: 130 }} value={filterAction} onChange={setFilterAction} size="small">
            {allActions.map(t => <Select.Option key={t} value={t}>{t}</Select.Option>)}
          </Select>
          <Select placeholder="状态" allowClear style={{ width: 130 }} value={filterStatus} onChange={setFilterStatus} size="small">
            {allStatuses.map(t => <Select.Option key={t} value={t}>{t}</Select.Option>)}
          </Select>
          <Input.Search
            placeholder="搜索对象/详情"
            allowClear
            prefix={<SearchOutlined />}
            style={{ width: 220 }}
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            size="small"
          />
          {filteredLogs.length !== logs.length && <Tag color="processing">筛选结果 {filteredLogs.length} 条</Tag>}
        </div>

        {filteredLogs.length === 0 ? (
          <Empty description={logs.length === 0 ? '暂无审计记录' : '没有匹配的审计记录'} />
        ) : (
          <Table
            loading={loading}
            dataSource={filteredLogs}
            columns={columns}
            rowKey="id"
            pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (total) => `共 ${total} 条审计` }}
            size="middle"
          />
        )}
      </Card>
    </div>
  );
};

export default OperateLog;
