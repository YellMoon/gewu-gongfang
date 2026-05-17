import React, { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  Empty,
  Input,
  InputNumber,
  Checkbox,
  Radio,
  Select,
  Space,
  Statistic,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  FileWordOutlined,
  PlusOutlined,
  SplitCellsOutlined,
} from '@ant-design/icons';
import type { Question } from '../types';
import { getApiBase } from '../utils/apiBase';
import { normalizeQuestionType } from '../constants/questionTypes';
import { QUESTION_BASKET_SELECTED_STORAGE_KEY, QUESTION_BASKET_STORAGE_KEY } from '../components/QuestionBasket';
import QuestionRichContent from '../components/QuestionRichContent';
import QuestionOptionsView from '../components/QuestionOptionsView';
import { downloadPaperDocx } from '../services/docxExporter';

const API_BASE = getApiBase('/api/question-bank');

type AnswerPosition = 'separate' | 'after-question' | 'hidden';

interface PaperQuestion {
  uid: string;
  question: Question;
  sectionTitle: string;
  score: number;
}

const DEFAULT_SECTION_BY_TYPE: Record<string, string> = {
  单选题: '一、单选题',
  多选题: '二、多选题',
  判断题: '三、判断题',
  实验题: '四、实验题',
  解答题: '五、解答题',
};

function todayTitle(): string {
  return `${new Date().toISOString().slice(0, 10)}试卷`;
}

function normalizeQuestion(row: any): Question {
  return {
    ...row,
    subject: row.subject || '物理',
    type: normalizeQuestionType(row.type),
    difficulty: Number(row.difficulty || 1),
    content: row.content ?? row.stem ?? '',
    answer: row.answer ?? '',
    analysis: row.analysis ?? row.explanation ?? '',
    exam_type: row.exam_type || '其他',
    knowledge_ids: row.knowledge_ids ?? row.knowledge_point_ids ?? [],
    model_ids: row.model_ids ?? row.model_point_ids ?? [],
    status: row.status || 'draft',
    has_image: !!row.has_image,
    has_formula: !!row.has_formula,
    created_by: row.created_by || '',
    assets: row.assets || [],
    formulas: row.formulas || [],
  } as Question;
}

async function loadBasketQuestions(ids: string[]): Promise<Question[]> {
  const db = (window as any).dbService;
  const localRows = (db?.getAllQuestions?.() || []).map(normalizeQuestion);
  const byId = new Map(localRows.map((q: Question) => [q.id, q]));

  try {
    const res = await fetch(`${API_BASE}/questions?limit=1000`);
    const data = await res.json();
    if (data.success && Array.isArray(data.data)) {
      data.data.map(normalizeQuestion).forEach((q: Question) => byId.set(q.id, q));
    }
  } catch (_err) {
    // Remote service is optional for the desktop paper editor.
  }

  return ids.map(id => byId.get(id)).filter((q): q is Question => !!q);
}

function buildInitialPaperQuestions(questions: Question[]): PaperQuestion[] {
  return questions.map((question, index) => {
    const type = normalizeQuestionType(question.type);
    return {
      uid: `${question.id}-${index}`,
      question: { ...question, type },
      sectionTitle: DEFAULT_SECTION_BY_TYPE[type] || '综合题',
      score: type === '单选题' || type === '判断题' ? 3 : 6,
    };
  });
}

function moveItem<T>(rows: T[], index: number, offset: number): T[] {
  const target = index + offset;
  if (target < 0 || target >= rows.length) return rows;
  const next = [...rows];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  return next;
}

function renderSource(question: Question): string {
  const parts = [question.year, question.region, question.school, question.exam_type, question.source].filter(Boolean);
  return parts.length > 0 ? parts.join(' / ') : '未填写来源';
}

const QuestionBankPaper: React.FC = () => {
  const [title, setTitle] = useState(todayTitle());
  const [items, setItems] = useState<PaperQuestion[]>([]);
  const [answerPosition, setAnswerPosition] = useState<AnswerPosition>('separate');
  const [includeDraft, setIncludeDraft] = useState(true);

  useEffect(() => {
    let mounted = true;
    const selectedIds: string[] = JSON.parse(localStorage.getItem(QUESTION_BASKET_SELECTED_STORAGE_KEY) || '[]');
    const basketIds: string[] = JSON.parse(localStorage.getItem(QUESTION_BASKET_STORAGE_KEY) || '[]');
    const dbIds: string[] = (window as any).dbService?.getQuestionBasketIds?.() || [];
    const targetIds = selectedIds.length > 0 ? selectedIds : (dbIds.length > 0 ? dbIds : basketIds);
    loadBasketQuestions(targetIds).then(questions => {
      const visibleQuestions = includeDraft
        ? questions
        : questions.filter(question => (question.status || 'draft') === 'published');
      if (mounted) setItems(buildInitialPaperQuestions(visibleQuestions));
    });
    return () => {
      mounted = false;
    };
  }, [includeDraft]);

  const sectionOptions = useMemo(() => {
    const titles = Array.from(new Set([...Object.values(DEFAULT_SECTION_BY_TYPE), ...items.map(item => item.sectionTitle)]));
    return titles.map(title => ({ label: title, value: title }));
  }, [items]);

  const groupedItems = useMemo(() => {
    const groups: { title: string; rows: Array<PaperQuestion & { number: number; index: number }> }[] = [];
    items.forEach((item, index) => {
      const title = item.sectionTitle || '综合题';
      let group = groups.find(row => row.title === title);
      if (!group) {
        group = { title, rows: [] };
        groups.push(group);
      }
      group.rows.push({ ...item, number: index + 1, index });
    });
    return groups;
  }, [items]);

  const typeStats = useMemo(() => {
    const stats = new Map<string, number>();
    items.forEach(item => stats.set(item.question.type, (stats.get(item.question.type) || 0) + 1));
    return Array.from(stats.entries());
  }, [items]);

  const difficultyStats = useMemo(() => {
    const stats = new Map<number, number>();
    items.forEach(item => stats.set(item.question.difficulty || 1, (stats.get(item.question.difficulty || 1) || 0) + 1));
    return Array.from(stats.entries()).sort((a, b) => a[0] - b[0]);
  }, [items]);

  const totalScore = useMemo(() => items.reduce((sum, item) => sum + Number(item.score || 0), 0), [items]);

  const updateItem = (uid: string, patch: Partial<PaperQuestion>) => {
    setItems(prev => prev.map(item => item.uid === uid ? { ...item, ...patch } : item));
  };

  const move = (index: number, offset: number) => {
    setItems(prev => moveItem(prev, index, offset));
  };

  const applyAutoGroup = () => {
    setItems(prev => buildInitialPaperQuestions(prev.map(item => item.question)));
    message.success('已按题型重新分组');
  };

  const exportPaper = async () => {
    try {
      const record = await downloadPaperDocx({
        title,
        answerPosition,
        includeSource: true,
        includeAnswerArea: true,
        questions: items.map((item, index) => ({
          id: item.question.id,
          number: index + 1,
          sectionTitle: item.sectionTitle,
          score: item.score,
          question: item.question,
        })),
      });
      message.success(`试卷已导出：${record.fileName}`);
    } catch (error) {
      console.error('DOCX export failed', error);
      message.error('DOCX 导出失败，请稍后重试');
    }
  };

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Card
        title={
          <Input
            value={title}
            onChange={e => setTitle(e.target.value)}
            bordered={false}
            style={{ maxWidth: 520, fontSize: 20, fontWeight: 600, paddingLeft: 0 }}
          />
        }
        extra={
          <Space wrap>
            <Checkbox checked={includeDraft} onChange={e => setIncludeDraft(e.target.checked)}>
              包含草稿/待审核题
            </Checkbox>
            <Radio.Group value={answerPosition} onChange={e => setAnswerPosition(e.target.value)}>
              <Radio.Button value="separate">答案单独附后</Radio.Button>
              <Radio.Button value="after-question">答案跟题显示</Radio.Button>
              <Radio.Button value="hidden">不显示答案</Radio.Button>
            </Radio.Group>
            <Button icon={<SplitCellsOutlined />} onClick={applyAutoGroup} disabled={items.length === 0}>
              按题型分组
            </Button>
            <Button type="primary" icon={<FileWordOutlined />} onClick={exportPaper} disabled={items.length === 0}>
              导出试卷
            </Button>
          </Space>
        }
      >
        <Space size={16} wrap>
          <Statistic title="题目数" value={items.length} suffix="题" />
          <Statistic title="总分" value={totalScore} suffix="分" />
          <div>
            <Typography.Text type="secondary">题型分布</Typography.Text>
            <div style={{ marginTop: 6 }}>
              {typeStats.length === 0 ? <Tag>暂无</Tag> : typeStats.map(([type, count]) => <Tag key={type} color="blue">{type} {count}</Tag>)}
            </div>
          </div>
          <div>
            <Typography.Text type="secondary">难度分布</Typography.Text>
            <div style={{ marginTop: 6 }}>
              {difficultyStats.length === 0 ? <Tag>暂无</Tag> : difficultyStats.map(([level, count]) => <Tag key={level}>难度{level} {count}</Tag>)}
            </div>
          </div>
        </Space>
      </Card>

      {items.length === 0 ? (
        <Card>
          <Empty description="试题篮中暂无已选试题，请先从试题预览加入试题篮后再组卷" />
        </Card>
      ) : (
        groupedItems.map(group => (
          <Card
            key={group.title}
            title={group.title}
            extra={<Tag color="processing">{group.rows.length} 题</Tag>}
            bodyStyle={{ paddingTop: 8 }}
          >
            <Space direction="vertical" size={10} style={{ width: '100%' }}>
              {group.rows.map(row => (
                <div
                  key={row.uid}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '44px 1fr 260px 80px',
                    gap: 12,
                    alignItems: 'start',
                    border: '1px solid #edf0f5',
                    borderRadius: 6,
                    padding: 12,
                    background: '#fff',
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: 18 }}>{row.number}</div>
                  <div style={{ minWidth: 0 }}>
                    <Space size={6} wrap style={{ marginBottom: 8 }}>
                      <Tag>{row.question.subject || '物理'}</Tag>
                      <Tag color="blue">{row.question.type}</Tag>
                      <Tag color={(row.question.status || 'draft') === 'published' ? 'green' : 'orange'}>{row.question.status || 'draft'}</Tag>
                      <Tag>难度{row.question.difficulty || 1}</Tag>
                      <Tag>{renderSource(row.question)}</Tag>
                    </Space>
                    <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{row.question.content || '未填写题干'}</div>
                    <QuestionOptionsView options={row.question.options as any[]} />
                    <QuestionRichContent question={row.question} />
                    {answerPosition === 'after-question' && (
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed #d9d9d9', color: '#455a64' }}>
                        <div><b>答案：</b>{row.question.answer || '未填写'}</div>
                        {row.question.analysis && <div><b>解析：</b>{row.question.analysis}</div>}
                      </div>
                    )}
                  </div>
                  <Space direction="vertical" size={8} style={{ width: '100%' }}>
                    <Select
                      value={row.sectionTitle}
                      options={sectionOptions}
                      onChange={value => updateItem(row.uid, { sectionTitle: value })}
                      style={{ width: '100%' }}
                    />
                    <Input
                      addonBefore="新分组"
                      placeholder="输入后回车"
                      onPressEnter={e => {
                        const value = e.currentTarget.value.trim();
                        if (!value) return;
                        updateItem(row.uid, { sectionTitle: value });
                        e.currentTarget.value = '';
                      }}
                    />
                    <InputNumber
                      min={0}
                      precision={1}
                      addonBefore="分值"
                      value={row.score}
                      onChange={value => updateItem(row.uid, { score: Number(value || 0) })}
                      style={{ width: '100%' }}
                    />
                  </Space>
                  <Space direction="vertical">
                    <Button icon={<ArrowUpOutlined />} onClick={() => move(row.index, -1)} disabled={row.index === 0} />
                    <Button icon={<ArrowDownOutlined />} onClick={() => move(row.index, 1)} disabled={row.index === items.length - 1} />
                    <Button icon={<PlusOutlined />} onClick={() => updateItem(row.uid, { sectionTitle: '综合题' })}>综合</Button>
                  </Space>
                </div>
              ))}
            </Space>
          </Card>
        ))
      )}

      {answerPosition === 'separate' && items.length > 0 && (
        <Card title="参考答案与解析">
          <Space direction="vertical" style={{ width: '100%' }}>
            {items.map((item, index) => (
              <div key={item.uid} style={{ lineHeight: 1.8 }}>
                <b>{index + 1}. </b>
                <span>答案：{item.question.answer || '未填写'}</span>
                {item.question.analysis && <div style={{ marginLeft: 24 }}>解析：{item.question.analysis}</div>}
              </div>
            ))}
          </Space>
        </Card>
      )}
    </Space>
  );
};

export default QuestionBankPaper;
