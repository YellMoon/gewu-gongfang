import React from 'react';
import { Card, Table, Tag, Empty } from 'antd';
import type { ColumnsType } from 'antd/es/table';

interface SyncLogEntry {
  id: string;
  time: string;
  type: string;
  status: 'success' | 'failed' | 'pending';
  detail: string;
}

const columns: ColumnsType<SyncLogEntry> = [
  { title: '时间', dataIndex: 'time', key: 'time', width: 180 },
  { title: '类型', dataIndex: 'type', key: 'type', width: 120 },
  {
    title: '状态', dataIndex: 'status', key: 'status', width: 100,
    render: (status: string) => (
      <Tag color={status === 'success' ? 'green' : status === 'failed' ? 'red' : 'blue'}>
        {status === 'success' ? '成功' : status === 'failed' ? '失败' : '进行中'}
      </Tag>
    ),
  },
  { title: '详情', dataIndex: 'detail', key: 'detail' },
];

const SyncLog: React.FC = () => {
  return (
    <Card title="📋 同步日志" style={{ margin: 16 }}>
      <Table
        columns={columns}
        dataSource={[]}
        rowKey="id"
        locale={{ emptyText: <Empty description="暂无同步记录" /> }}
        pagination={{ pageSize: 20 }}
      />
    </Card>
  );
};

export default SyncLog;
