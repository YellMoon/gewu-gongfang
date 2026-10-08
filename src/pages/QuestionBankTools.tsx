import React, { useEffect, useMemo, useState } from 'react';
import { Card, Empty, Space, Statistic, Tabs, Tag, message } from 'antd';
import Table from '../components/NumberedTable';
import QuestionBankImport from './QuestionBankImport';
import QuestionIssueQueue, { QuestionIssue } from '../components/question-bank/QuestionIssueQueue';
import type { ImportTask, Question } from '../types';
import { inspectQuestion, questionSearchText } from '../services/questionInspection';
import type { NavigationInput, QuestionBankToolsContext } from '../navigation/navigationContext';
import './QuestionBankTools.css';
import { readDesktopAuthorizationSession } from '../services/desktopAuthorizationSession.mjs';
const { questionDeletePresentation } = require('../services/questionDeletionPresentation');
const { normalizeDesktopQuestionDeleteContext, verifyNativeQuestionDraft } = require('../services/desktopQuestionDeleteContext');

interface QuestionBankToolsProps {
  onNavigate: (target: NavigationInput) => void;
  context?: QuestionBankToolsContext;
}

type QuestionBankStats = {
  questions: Question[];
  recentTasks: ImportTask[];
};

const EMPTY_STATS: QuestionBankStats = {
  questions: [],
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
      const reasons = inspectQuestion(question);
      if (String(question.edit_status || '').trim() === '未编辑') reasons.push('未编辑');
      return { question, reasons };
    })
    .filter(item => item.reasons.length > 0)
    .map(({ question, reasons }) => ({
      id: question.id,
      title: questionSearchText(question).split('\n').slice(1).join(' ').slice(0, 80) || '未填写题干',
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

const QuestionBankTools: React.FC<QuestionBankToolsProps> = ({ onNavigate, context }) => {
  const [stats, setStats] = useState<QuestionBankStats>(EMPTY_STATS);
  const [activeTab, setActiveTab] = useState(context?.mode === 'problem-questions' ? 'quality' : 'import');

  const loadStats = () => {
    try {
      const db = (window as any).dbService;
      const questions = (db?.getAllQuestions?.() || []).map(normalizeQuestion);
      setStats({
        questions,
        recentTasks: db?.getRecentImportTasks?.(8) || [],
      });
    } catch {
      setStats(EMPTY_STATS);
    }
  };

  useEffect(() => {
    loadStats();
    window.addEventListener('question-basket-changed', loadStats as EventListener);
    window.addEventListener('authority-projection-refreshed', loadStats);
    return () => {
      window.removeEventListener('question-basket-changed', loadStats as EventListener);
      window.removeEventListener('authority-projection-refreshed', loadStats);
    };
  }, []);

  useEffect(() => {
    if (context?.mode === 'problem-questions') {
      setActiveTab('quality');
    }
  }, [context?.mode]);

  const subjectStats = useMemo(() => {
    const map = new Map<string, number>();
    stats.questions.forEach(question => {
      const subject = question.subject || '未分类';
      map.set(subject, (map.get(subject) || 0) + 1);
    });
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [stats.questions]);

  const deleteIssue = async (id: string) => {
    try {
      const question = stats.questions.find(item => item.id === id);
      const session = readDesktopAuthorizationSession();
      const permission = questionDeletePresentation(question, normalizeDesktopQuestionDeleteContext(session));
      if (!permission.enabled) { message.warning(permission.reason); return; }
      const db = (window as any).dbService;
      const deleted = question?.storage_state === 'cloud_cached'
        ? db.deleteCloudCachedQuestion(id)
        : db.deleteQuestion(id, await verifyNativeQuestionDraft(id, session));
      if (!deleted) throw new Error('删除失败，请刷新后重试');
      loadStats();
    } catch (error: any) { message.error(error?.message || '删除失败'); }
  };

  const issues = useMemo(() => buildIssues(stats.questions), [stats.questions]);
  const publishedCount = stats.questions.filter(question => question.status === 'published').length;
  const draftCount = stats.questions.filter(question => question.status !== 'published').length;

  return (
    <div className="question-bank-tools-page">
      {/* UTF-8: navigation lives beside the shell title; keep only useful metrics. */}
      <div className="question-bank-tools-metrics">
        <Card size="small"><Statistic title="试题总数" value={stats.questions.length} suffix="题" /></Card>
        <Card size="small"><Statistic title="已发布" value={publishedCount} suffix="题" /></Card>
        <Card size="small"><Statistic title="草稿/待处理" value={draftCount} suffix="题" /></Card>
      </div>

      <Tabs
        className="question-bank-tools-tabs"
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: 'import',
            label: '导入与体系',
            children: <QuestionBankImport />,
          },
          {
            key: 'quality',
            label: `问题提醒 ${issues.length}`,
            children: (
              <div>
                <Card title="问题试题" size="small">
                  <QuestionIssueQueue issues={issues} onEdit={questionId => onNavigate({ page: 'question-bank-preview', context: { questionId } })} onDelete={deleteIssue} />
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
                    scroll={{ x: 640 }}
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
