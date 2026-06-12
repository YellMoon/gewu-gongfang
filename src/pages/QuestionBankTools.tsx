import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Empty, Space, Statistic, Table, Tabs, Tag, Typography } from 'antd';
import {
  AuditOutlined,
  DatabaseOutlined,
  EditOutlined,
  FileSearchOutlined,
  FileWordOutlined,
  ImportOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import QuestionBankImport from './QuestionBankImport';
import QuestionIssueQueue, { QuestionIssue } from '../components/question-bank/QuestionIssueQueue';
import type { ImportTask, Question } from '../types';
import type { PageKey } from '../navigation/appNavigation';
import './QuestionBankTools.css';

interface QuestionBankToolsProps {
  onNavigate: (page: PageKey) => void;
}

type QuestionBankStats = {
  questions: Question[];
  knowledgeCount: number;
  modelCount: number;
  recentTasks: ImportTask[];
};

const EMPTY_STATS: QuestionBankStats = {
  questions: [],
  knowledgeCount: 0,
  modelCount: 0,
  recentTasks: [],
};

function normalizeQuestion(row: any): Question {
  return {
    ...row,
    content: row.content ?? row.stem ?? '',
    answer: row.answer ?? '',
    analysis: row.analysis ?? row.explanation ?? '',
    status: row.status || 'draft',
    subject: row.subject || '物理',
    type: row.type || '综合题',
    difficulty: Number(row.difficulty || 1),
    has_image: !!row.has_image,
    has_formula: !!row.has_formula,
    created_by: row.created_by || '',
  } as Question;
}

function buildIssues(questions: Question[]): QuestionIssue[] {
  return questions
    .map(question => {
      const reasons: string[] = [];
      if (!String(question.content || '').trim()) reasons.push('题干缺失');
      if (!String(question.answer || '').trim()) reasons.push('答案缺失');
      if (!String(question.analysis || '').trim()) reasons.push('解析缺失');
      if (String(question.edit_status || '').trim() === '未编辑') reasons.push('未编辑');
      return { question, reasons };
    })
    .filter(item => item.reasons.length > 0)
    .slice(0, 8)
    .map(({ question, reasons }) => ({
      id: question.id,
      title: String(question.content || question.stem || '未填写题干').slice(0, 80),
      subject: question.subject,
      reason: reasons.join(' / '),
      updatedAt: question.updated_at ? new Date(question.updated_at).toLocaleString('zh-CN') : undefined,
    }));
}

function taskStatusText(status: string): string {
  const map: Record<string, string> = {
    pending: '待处理',
    checking: '校验中',
    checked: '已校验',
    importing: '导入中',
    imported: '已导入',
    partial_failed: '部分失败',
    failed: '失败',
  };
  return map[status] || status || '-';
}

function statusColor(status: string): string {
  if (['success', 'accepted', 'imported', 'checked'].includes(status)) return 'green';
  if (['warning', 'partial_failed', 'duplicate'].includes(status)) return 'orange';
  if (['failed', 'rejected'].includes(status)) return 'red';
  return 'blue';
}

const QuestionBankTools: React.FC<QuestionBankToolsProps> = ({ onNavigate }) => {
  const [stats, setStats] = useState<QuestionBankStats>(EMPTY_STATS);

  const loadStats = () => {
    try {
      const db = (window as any).dbService;
      const questions = (db?.getAllQuestions?.() || []).map(normalizeQuestion);
      setStats({
        questions,
        knowledgeCount: db?.getKnowledgeTree?.().length || 0,
        modelCount: db?.getModelTree?.().length || 0,
        recentTasks: db?.getRecentImportTasks?.(8) || [],
      });
    } catch {
      setStats(EMPTY_STATS);
    }
  };

  useEffect(() => {
    loadStats();
    window.addEventListener('question-basket-changed', loadStats as EventListener);
    return () => window.removeEventListener('question-basket-changed', loadStats as EventListener);
  }, []);

  const subjectStats = useMemo(() => {
    const map = new Map<string, number>();
    stats.questions.forEach(question => {
      const subject = question.subject || '未分类';
      map.set(subject, (map.get(subject) || 0) + 1);
    });
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [stats.questions]);

  const issues = useMemo(() => buildIssues(stats.questions), [stats.questions]);
  const publishedCount = stats.questions.filter(question => question.status === 'published').length;
  const draftCount = stats.questions.filter(question => question.status !== 'published').length;
  const formulaCount = stats.questions.filter(question => question.has_formula).length;
  const imageCount = stats.questions.filter(question => question.has_image).length;

  const shortcuts = [
    { key: 'question-bank-import' as PageKey, icon: <ImportOutlined />, label: '独立导入页', type: 'default' as const },
    { key: 'question-bank-edit' as PageKey, icon: <EditOutlined />, label: '原试题编辑', type: 'default' as const },
    { key: 'question-bank-audit' as PageKey, icon: <AuditOutlined />, label: '原审核中心', type: 'default' as const },
    { key: 'question-bank-preview' as PageKey, icon: <FileSearchOutlined />, label: '进入试题库', type: 'primary' as const },
    { key: 'question-bank-paper' as PageKey, icon: <FileWordOutlined />, label: '去组卷', type: 'primary' as const },
  ];

  return (
    <div className="question-bank-tools-page">
      <div className="question-bank-tools-hero">
        <div className="question-bank-tools-hero__main">
          <Space size={8} align="center">
            <ToolOutlined />
            <Typography.Title level={3}>题库工具</Typography.Title>
            <Tag color="blue">压缩工作台</Tag>
          </Space>
          <Typography.Text type="secondary">
            知识树、模型树、试题导入、题库统计和问题提醒集中在这里；原导入、编辑、审核页面保留为兼容入口。
          </Typography.Text>
        </div>
        <Space wrap>
          {shortcuts.map(item => (
            <Button key={item.key} type={item.type} icon={item.icon} onClick={() => onNavigate(item.key)}>
              {item.label}
            </Button>
          ))}
        </Space>
      </div>

      <div className="question-bank-tools-metrics">
        <Card size="small"><Statistic title="试题总数" value={stats.questions.length} suffix="题" /></Card>
        <Card size="small"><Statistic title="已发布" value={publishedCount} suffix="题" /></Card>
        <Card size="small"><Statistic title="草稿/待处理" value={draftCount} suffix="题" /></Card>
        <Card size="small"><Statistic title="知识点" value={stats.knowledgeCount} /></Card>
        <Card size="small"><Statistic title="模型点" value={stats.modelCount} /></Card>
        <Card size="small"><Statistic title="含公式/图片" value={`${formulaCount}/${imageCount}`} /></Card>
      </div>

      <Tabs
        className="question-bank-tools-tabs"
        defaultActiveKey="import"
        items={[
          {
            key: 'import',
            label: '导入与知识树',
            children: <QuestionBankImport />,
          },
          {
            key: 'quality',
            label: `问题提醒 ${issues.length}`,
            children: (
              <div className="question-bank-tools-grid">
                <Card title="问题试题" size="small">
                  <QuestionIssueQueue issues={issues} onEdit={() => onNavigate('question-bank-edit')} />
                </Card>
                <Card title="处理建议" size="small">
                  <Alert
                    type="info"
                    showIcon
                    message="个人使用场景下，问题提醒优先于独立审核流程"
                    description="导入时标注异常，试题库或原编辑页中修正；原审核中心仍可从上方兼容入口进入。"
                  />
                </Card>
              </div>
            ),
          },
          {
            key: 'stats',
            label: '统计与导入记录',
            children: (
              <div className="question-bank-tools-grid">
                <Card title="学科分布" size="small">
                  {subjectStats.length === 0 ? (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无试题统计" />
                  ) : (
                    <Space wrap>
                      {subjectStats.map(([subject, count]) => <Tag key={subject} color="blue">{subject} {count}</Tag>)}
                    </Space>
                  )}
                </Card>
                <Card title="最近导入" size="small">
                  <Table
                    size="small"
                    rowKey="id"
                    dataSource={stats.recentTasks}
                    pagination={false}
                    locale={{ emptyText: '暂无导入记录' }}
                    columns={[
                      { title: '文件', dataIndex: 'file_name', ellipsis: true, render: value => value || '-' },
                      { title: '类型', dataIndex: 'source_type', width: 82, render: value => value === 'exam' ? '试卷' : '讲义' },
                      { title: '状态', dataIndex: 'status', width: 88, render: value => <Tag color={statusColor(value)}>{taskStatusText(value)}</Tag> },
                      { title: '总数', dataIndex: 'total_items', width: 70 },
                      { title: '时间', dataIndex: 'created_at', width: 160, render: value => value ? new Date(value).toLocaleString('zh-CN') : '-' },
                    ]}
                  />
                </Card>
              </div>
            ),
          },
        ]}
      />
    </div>
  );
};

export default QuestionBankTools;
