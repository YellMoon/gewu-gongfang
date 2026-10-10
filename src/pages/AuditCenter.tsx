import React, { useEffect, useMemo, useState } from 'react';
import { Card, Empty, Space, Tabs, Tag, Typography } from 'antd';
import Table from '../components/NumberedTable';
import type { ColumnsType } from 'antd/es/table';
import type { Question } from '../types';
import { normalizeQuestionType } from '../constants/questionTypes';

const { Text } = Typography;

type QuestionStatus = Question['status'];

const STATUS_TABS: Array<{ key: QuestionStatus; label: string; color: string }> = [
  { key: 'draft', label: '草稿', color: 'default' },
  { key: 'published', label: '已发布', color: 'success' },
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
    exam_type: row.exam_type || '未标注',
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

  const dbService = (window as any).dbService;

  const loadData = () => {
    const rows = (dbService?.getAllQuestions?.() || []).map(normalizeQuestion);
    setQuestions(rows);
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

  const columns: ColumnsType<Question> = [
    {
      title: '题目',
      dataIndex: 'content',
      ellipsis: true,
      render: (value: string, row) => (
        <Space direction="vertical" size={2} style={{ maxWidth: 560 }}>
          <Text strong ellipsis>{value || '无题干'}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {row.school || row.source || '无来源'} · {row.exam_type || '未标注'} · {row.updated_at ? new Date(row.updated_at).toLocaleString('zh-CN') : '-'}
          </Text>
        </Space>
      ),
    },
    { title: '科目', dataIndex: 'subject', width: 80, render: value => value || '物理' },
    { title: '题型', dataIndex: 'type', width: 90, render: value => normalizeQuestionType(value) },
    { title: '难度系数', dataIndex: 'difficulty_coefficient', width: 100, render: value => value ?? '未标注' },
    {
      title: '编辑状态',
      dataIndex: 'edit_status',
      width: 90,
      render: value => <Tag color={value === '已编辑' ? 'green' : 'orange'}>{value || '未编辑'}</Tag>,
    },
    {
      title: '发布状态',
      dataIndex: 'status',
      width: 100,
      render: value => <Tag color={statusColor(value)}>{statusLabel(value)}</Tag>,
    },

  ];

  return (
    <Card
      bodyStyle={{ paddingTop: 12 }}
    >
      <Tabs
        activeKey={activeStatus}
        onChange={(key) => {
          setActiveStatus(key as QuestionStatus);
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
          pagination={{ pageSize: 12, showSizeChanger: true }}
        />
      )}
    </Card>
  );
};

export default AuditCenter;
