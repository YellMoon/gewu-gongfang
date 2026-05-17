import React, { useEffect, useMemo, useState } from 'react';
import { Button, Card, Empty, Space, Table, Tabs, Tag, Typography, message } from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  CloudUploadOutlined,
  StopOutlined,
  UndoOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { Question } from '../types';
import { normalizeQuestionType } from '../constants/questionTypes';

const { Text } = Typography;

type QuestionStatus = Question['status'];

const STATUS_TABS: Array<{ key: QuestionStatus; label: string; color: string }> = [
  { key: 'draft', label: '草稿', color: 'default' },
  { key: 'pending', label: '待审核', color: 'processing' },
  { key: 'published', label: '已发布', color: 'success' },
  { key: 'offline', label: '已下线', color: 'warning' },
  { key: 'deprecated', label: '已废弃', color: 'error' },
];

const statusLabel = (status?: string) => STATUS_TABS.find(item => item.key === status)?.label || '草稿';
const statusColor = (status?: string) => STATUS_TABS.find(item => item.key === status)?.color || 'default';

function normalizeQuestion(row: any): Question {
  return {
    ...row,
    subject: row.subject || '物理',
    type: normalizeQuestionType(row.type),
    content: row.content ?? row.stem ?? '',
    answer: row.answer || '',
    analysis: row.analysis ?? row.explanation ?? '',
    exam_type: row.exam_type || '其他',
    edit_status: row.edit_status || '未编辑',
    status: row.status || 'draft',
    has_image: !!row.has_image,
    has_formula: !!row.has_formula,
    created_by: row.created_by || '',
    knowledge_ids: row.knowledge_ids ?? row.knowledge_point_ids ?? [],
    model_ids: row.model_ids ?? row.model_point_ids ?? [],
  } as Question;
}

const AuditCenter: React.FC = () => {
  const [activeStatus, setActiveStatus] = useState<QuestionStatus>('draft');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  const dbService = (window as any).dbService;

  const loadData = () => {
    const rows = (dbService?.getAllQuestions?.() || []).map(normalizeQuestion);
    setQuestions(rows);
    setSelectedRowKeys([]);
  };

  useEffect(() => {
    loadData();
  }, []);

  const counts = useMemo(() => {
    return STATUS_TABS.reduce<Record<QuestionStatus, number>>((acc, item) => {
      acc[item.key] = questions.filter(q => (q.status || 'draft') === item.key).length;
      return acc;
    }, {} as Record<QuestionStatus, number>);
  }, [questions]);

  const currentRows = useMemo(() => {
    return questions
      .filter(q => (q.status || 'draft') === activeStatus)
      .sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')));
  }, [activeStatus, questions]);

  const updateStatus = (ids: string[], status: QuestionStatus, successText: string) => {
    if (!dbService) {
      message.error('本地数据库未加载');
      return;
    }
    ids.forEach(id => {
      if (typeof dbService.updateQuestionStatus === 'function') {
        dbService.updateQuestionStatus(id, status);
      } else {
        dbService.updateQuestion?.(id, { status });
      }
    });
    message.success(successText);
    loadData();
  };

  const selectedIds = selectedRowKeys.map(String);

  const actionButtons = (
    <Space wrap>
      <Button
        icon={<CloudUploadOutlined />}
        disabled={selectedIds.length === 0 || activeStatus !== 'draft'}
        onClick={() => updateStatus(selectedIds, 'pending', '已提交审核')}
      >
        提交审核
      </Button>
      <Button
        type="primary"
        icon={<CheckCircleOutlined />}
        disabled={selectedIds.length === 0 || activeStatus !== 'pending'}
        onClick={() => updateStatus(selectedIds, 'published', '审核已通过')}
      >
        通过
      </Button>
      <Button
        danger
        icon={<CloseCircleOutlined />}
        disabled={selectedIds.length === 0 || activeStatus !== 'pending'}
        onClick={() => updateStatus(selectedIds, 'draft', '已驳回到草稿')}
      >
        驳回
      </Button>
      <Button
        icon={<StopOutlined />}
        disabled={selectedIds.length === 0 || activeStatus !== 'published'}
        onClick={() => updateStatus(selectedIds, 'offline', '已下线')}
      >
        下线
      </Button>
      <Button
        icon={<UndoOutlined />}
        disabled={selectedIds.length === 0 || !['offline', 'deprecated'].includes(activeStatus)}
        onClick={() => updateStatus(selectedIds, 'draft', '已恢复到草稿')}
      >
        恢复草稿
      </Button>
    </Space>
  );

  const columns: ColumnsType<Question> = [
    {
      title: '题目',
      dataIndex: 'content',
      ellipsis: true,
      render: (value: string, row) => (
        <Space direction="vertical" size={2} style={{ maxWidth: 560 }}>
          <Text strong ellipsis>{value || '无题干'}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {row.school || row.source || '无来源'} · {row.exam_type || '其他'} · {row.updated_at ? new Date(row.updated_at).toLocaleString('zh-CN') : '-'}
          </Text>
        </Space>
      ),
    },
    { title: '科目', dataIndex: 'subject', width: 80, render: value => value || '物理' },
    { title: '题型', dataIndex: 'type', width: 90, render: value => normalizeQuestionType(value) },
    { title: '难度', dataIndex: 'difficulty', width: 70, render: value => value || '-' },
    {
      title: '编辑状态',
      dataIndex: 'edit_status',
      width: 90,
      render: value => <Tag color={value === '已编辑' ? 'green' : 'orange'}>{value || '未编辑'}</Tag>,
    },
    {
      title: '审核状态',
      dataIndex: 'status',
      width: 100,
      render: value => <Tag color={statusColor(value)}>{statusLabel(value)}</Tag>,
    },
    {
      title: '操作',
      width: 220,
      render: (_, row) => {
        const id = row.id;
        const status = row.status || 'draft';
        return (
          <Space size={4} wrap>
            {status === 'draft' && <Button size="small" onClick={() => updateStatus([id], 'pending', '已提交审核')}>提交</Button>}
            {status === 'pending' && <Button size="small" type="primary" onClick={() => updateStatus([id], 'published', '审核已通过')}>通过</Button>}
            {status === 'pending' && <Button size="small" danger onClick={() => updateStatus([id], 'draft', '已驳回到草稿')}>驳回</Button>}
            {status === 'published' && <Button size="small" onClick={() => updateStatus([id], 'offline', '已下线')}>下线</Button>}
            {['offline', 'deprecated'].includes(status) && <Button size="small" onClick={() => updateStatus([id], 'draft', '已恢复到草稿')}>恢复</Button>}
          </Space>
        );
      },
    },
  ];

  return (
    <Card
      title="审核中心"
      extra={actionButtons}
      bodyStyle={{ paddingTop: 12 }}
    >
      <Tabs
        activeKey={activeStatus}
        onChange={(key) => {
          setActiveStatus(key as QuestionStatus);
          setSelectedRowKeys([]);
        }}
        items={STATUS_TABS.map(item => ({
          key: item.key,
          label: (
            <Space size={6}>
              <span>{item.label}</span>
              <Tag color={item.color}>{counts[item.key] || 0}</Tag>
            </Space>
          ),
        }))}
      />
      {currentRows.length === 0 ? (
        <Empty description={`${statusLabel(activeStatus)}暂无题目`} />
      ) : (
        <Table
          rowKey="id"
          size="small"
          dataSource={currentRows}
          columns={columns}
          rowSelection={{
            selectedRowKeys,
            onChange: setSelectedRowKeys,
          }}
          pagination={{ pageSize: 12, showSizeChanger: true }}
        />
      )}
    </Card>
  );
};

export default AuditCenter;
