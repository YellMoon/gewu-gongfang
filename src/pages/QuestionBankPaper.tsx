import React, { useEffect, useState } from 'react';
import { Button, Card, Empty, Input, Space, Tag, message } from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined, FileWordOutlined } from '@ant-design/icons';
import type { Question } from '../types';
import { getApiBase } from '../utils/apiBase';

const API_BASE = getApiBase('/api/question-bank');

function normalizeQuestion(row: any): Question {
  return {
    ...row,
    subject: row.subject || '物理',
    content: row.content ?? row.stem ?? '',
    analysis: row.analysis ?? row.explanation ?? '',
    exam_type: row.exam_type || '其他',
    knowledge_ids: row.knowledge_ids ?? row.knowledge_point_ids ?? [],
    model_ids: row.model_ids ?? row.model_point_ids ?? [],
  } as Question;
}

const QuestionBankPaper: React.FC = () => {
  const [title, setTitle] = useState(`${new Date().toISOString().slice(0, 10)}试卷`);
  const [editingTitle, setEditingTitle] = useState(false);
  const [questions, setQuestions] = useState<Question[]>([]);

  useEffect(() => {
    const ids: string[] = JSON.parse(localStorage.getItem('question_basket_selected') || '[]');
    const db = (window as any).dbService;
    const localRows = (db?.getAllQuestions?.() || []).map(normalizeQuestion).filter((q: Question) => ids.includes(q.id));
    fetch(`${API_BASE}/questions?limit=200`)
      .then(res => res.json())
      .then(data => {
        const rows = data.success && Array.isArray(data.data) ? data.data.map(normalizeQuestion) : localRows;
        const byId = new Map(rows.map((q: Question) => [q.id, q]));
        setQuestions(ids.map(id => byId.get(id)).filter((q): q is Question => !!q));
      })
      .catch(() => setQuestions(localRows));
  }, []);

  const move = (index: number, offset: number) => {
    const next = [...questions];
    const target = index + offset;
    if (target < 0 || target >= next.length) return;
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    setQuestions(next);
  };

  const exportPaper = () => {
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><h1 style="text-align:center">${title}</h1>${questions.map((q, i) => `<div style="margin:16px 0"><b>${i + 1}.</b> ${String(q.content || '').replace(/\n/g, '<br>')}</div>`).join('')}</body></html>`;
    const blob = new Blob([html], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title}.doc`;
    a.click();
    URL.revokeObjectURL(url);
    message.success('试卷已导出');
  };

  return (
    <Card
      title={editingTitle ? <Input value={title} autoFocus onChange={e => setTitle(e.target.value)} onBlur={() => setEditingTitle(false)} onPressEnter={() => setEditingTitle(false)} style={{ maxWidth: 420 }} /> : <span onClick={() => setEditingTitle(true)} style={{ cursor: 'text' }}>{title}</span>}
      extra={<Button type="primary" icon={<FileWordOutlined />} onClick={exportPaper} disabled={questions.length === 0}>导出试卷</Button>}
    >
      {questions.length === 0 ? <Empty description="试题篮中暂无选中试题" /> : (
        <Space direction="vertical" style={{ width: '100%' }} size={10}>
          {questions.map((q, index) => (
            <div key={q.id} style={{ border: '1px solid #edf0f5', borderRadius: 6, padding: 12, display: 'flex', gap: 12 }}>
              <div style={{ width: 42, fontWeight: 600 }}>{index + 1}</div>
              <div style={{ flex: 1 }}>
                <Space size={6} wrap style={{ marginBottom: 6 }}><Tag>{q.subject || '物理'}</Tag><Tag>{q.type}</Tag></Space>
                <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{q.content}</div>
              </div>
              <Space direction="vertical">
                <Button icon={<ArrowUpOutlined />} onClick={() => move(index, -1)} disabled={index === 0} />
                <Button icon={<ArrowDownOutlined />} onClick={() => move(index, 1)} disabled={index === questions.length - 1} />
              </Space>
            </div>
          ))}
        </Space>
      )}
    </Card>
  );
};

export default QuestionBankPaper;
