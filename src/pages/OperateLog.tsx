import React, { useState, useEffect, useCallback } from 'react';
import { Table, Button, DatePicker, Space, Tag, Card, message, Modal, Empty, Input, Select as AntSelect } from 'antd';
import { FileTextOutlined, DeleteOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import logger, { OperateLogEntry } from '../services/operateLogger';
import AutoCloseSelect from '../components/AutoCloseSelect';

const Select = AutoCloseSelect as typeof AntSelect;

const ACTION_TYPE_COLORS: Record<string, string> = {
  '创建': 'green',
  '修改': 'blue',
  '删除': 'red',
  '登录': 'purple',
  '导出': 'orange',
  '同步': 'cyan',
  '设置': 'geekblue',
  '导入': 'gold',
  '移动': 'lime',
  '复制': 'volcano',
};

const OperateLog: React.FC = () => {
  const [logs, setLogs] = useState<OperateLogEntry[]>([]);
  const [filterDate, setFilterDate] = useState<[dayjs.Dayjs | null, dayjs.Dayjs | null]>([null, null]);
  const [filterActionType, setFilterActionType] = useState<string | undefined>();
  const [filterUser, setFilterUser] = useState<string | undefined>();
  const [searchText, setSearchText] = useState('');

  // 加载日志（从真实数据源）
  useEffect(() => {
    setLogs(logger.getAll());
  }, []);

  // 重新读取
  const handleRefresh = () => {
    setLogs(logger.getAll());
    message.success('已刷新');
  };

  // 清空日志
  const handleClear = () => {
    Modal.confirm({
      title: '清空操作日志',
      content: '确定要清空所有操作日志吗？此操作不可恢复。',
      okText: '确定清空',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => {
        logger.clear();
        setLogs([]);
        message.success('操作日志已清空');
      },
    });
  };

  // 多条件筛选
  const filteredLogs = logs.filter(log => {
    // 按日期范围筛选
    if (filterDate[0] && filterDate[1]) {
      const logDate = dayjs(log.timestamp);
      if (!logDate.isAfter(filterDate[0].startOf('day')) || !logDate.isBefore(filterDate[1].endOf('day'))) return false;
    }
    // 按操作类型筛选
    if (filterActionType && log.actionType !== filterActionType) return false;
    // 按用户筛选
    if (filterUser && log.user !== filterUser) return false;
    // 搜索框
    if (searchText) {
      const s = searchText.toLowerCase();
      if (!log.detail.toLowerCase().includes(s) && !log.actionType.toLowerCase().includes(s) && !log.user.toLowerCase().includes(s)) return false;
    }
    return true;
  });

  // 获取所有出现的操作类型和用户（用于下拉框）
  const allActionTypes = Array.from(new Set(logs.map(l => l.actionType)));
  const allUsers = Array.from(new Set(logs.map(l => l.user)));

  const columns: ColumnsType<OperateLogEntry> = [
    {
      title: '时间',
      dataIndex: 'timestamp',
      key: 'timestamp',
      width: 180,
      sorter: (a, b) => dayjs(b.timestamp).unix() - dayjs(a.timestamp).unix(),
      defaultSortOrder: 'descend',
    },
    {
      title: '用户',
      dataIndex: 'user',
      key: 'user',
      width: 100,
    },
    {
      title: '操作类型',
      dataIndex: 'actionType',
      key: 'actionType',
      width: 100,
      render: (type: string) => (
        <Tag color={ACTION_TYPE_COLORS[type] || 'default'}>{type}</Tag>
      ),
    },
    {
      title: '操作详情',
      dataIndex: 'detail',
      key: 'detail',
      render: (detail: string) => (
        <span style={{ fontSize: 13 }}>{detail}</span>
      ),
    },
    {
      title: '来源',
      dataIndex: 'source',
      key: 'source',
      width: 140,
      render: (source: string) => (
        <span style={{ color: '#999', fontSize: 12 }}>{source}</span>
      ),
    },
  ];

  return (
    <div style={{ padding: 16 }}>
      <Card
        title={<span><FileTextOutlined style={{ marginRight: 8 }} />操作日志 <Tag color="blue">{logs.length}条</Tag></span>}
        extra={
          <Space>
            <DatePicker.RangePicker
              onChange={(dates) => {
                if (dates && dates[0] && dates[1]) {
                  setFilterDate([dates[0], dates[1]]);
                } else {
                  setFilterDate([null, null]);
                }
              }}
              placeholder={['开始日期', '结束日期']}
              size="small"
            />
            <Button icon={<ReloadOutlined />} onClick={handleRefresh} size="small">刷新</Button>
            <Button danger icon={<DeleteOutlined />} onClick={handleClear} size="small">清空日志</Button>
          </Space>
        }
      >
        {/* 筛选行 */}
        <div style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Select
            placeholder="操作类型"
            allowClear
            style={{ width: 120 }}
            value={filterActionType}
            onChange={setFilterActionType}
            size="small"
          >
            {allActionTypes.map(t => (
              <Select.Option key={t} value={t}>{t}</Select.Option>
            ))}
          </Select>
          <Select
            placeholder="用户"
            allowClear
            style={{ width: 120 }}
            value={filterUser}
            onChange={setFilterUser}
            size="small"
          >
            {allUsers.map(u => (
              <Select.Option key={u} value={u}>{u}</Select.Option>
            ))}
          </Select>
          <Input.Search
            placeholder="搜索..."
            allowClear
            style={{ width: 200 }}
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            size="small"
          />
          {filteredLogs.length !== logs.length && (
            <Tag color="processing">筛选结果 {filteredLogs.length} 条</Tag>
          )}
        </div>

        {filteredLogs.length === 0 ? (
          <Empty description={logs.length === 0 ? '暂无操作日志，进行操作后会自动记录' : '没有匹配的日志'} />
        ) : (
          <Table
            dataSource={filteredLogs}
            columns={columns}
            rowKey="id"
            pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (total) => `共 ${total} 条日志` }}
            size="middle"
          />
        )}
      </Card>
    </div>
  );
};

export default OperateLog;
