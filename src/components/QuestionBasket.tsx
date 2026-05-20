import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Button, Checkbox, Drawer, Empty, Modal, Space, Tag, message } from 'antd';
import { useRef } from 'react';
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  FileWordOutlined,
  ShoppingCartOutlined,
} from '@ant-design/icons';
import type { Question } from '../types';
import { getApiBase } from '../utils/apiBase';
import { normalizeQuestionType } from '../constants/questionTypes';
import { downloadPaperDocx } from '../services/docxExporter';
import './QuestionBasket.css';

const API_BASE = getApiBase('/api/question-bank');
export const QUESTION_BASKET_STORAGE_KEY = 'question_basket_ids';
export const QUESTION_BASKET_SELECTED_STORAGE_KEY = 'question_basket_selected';
export const QUESTION_BASKET_EVENT = 'question-basket-changed';
const QUESTION_BASKET_DOCK_TOP_KEY = 'question_basket_dock_top';

function readBasketIds(): string[] {
  try {
    const db = (window as any).dbService;
    const ids = db?.getQuestionBasketIds?.();
    if (Array.isArray(ids)) return ids;
    return JSON.parse(localStorage.getItem(QUESTION_BASKET_STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

function writeBasketIds(ids: string[]): void {
  const next = Array.from(new Set(ids.filter(Boolean)));
  const db = (window as any).dbService;
  if (db?.setQuestionBasketIds) {
    db.setQuestionBasketIds(next);
  } else {
    localStorage.setItem(QUESTION_BASKET_STORAGE_KEY, JSON.stringify(next));
  }
  window.dispatchEvent(new CustomEvent(QUESTION_BASKET_EVENT, { detail: next }));
}

export function isQuestionInBasket(id: string): boolean {
  return readBasketIds().includes(id);
}

export function setQuestionBasket(ids: string[]): void {
  writeBasketIds(ids);
}

export function toggleQuestionBasket(id: string): string[] {
  const current = readBasketIds();
  const next = current.includes(id) ? current.filter(item => item !== id) : [...current, id];
  writeBasketIds(next);
  return next;
}

export function useQuestionBasketIds(): [string[], (ids: string[]) => void] {
  const [ids, setIds] = useState<string[]>(() => readBasketIds());

  useEffect(() => {
    const sync = () => setIds(readBasketIds());
    window.addEventListener(QUESTION_BASKET_EVENT, sync as EventListener);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(QUESTION_BASKET_EVENT, sync as EventListener);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const update = useCallback((nextIds: string[]) => {
    writeBasketIds(nextIds);
    setIds(readBasketIds());
  }, []);

  return [ids, update];
}

function normalizeQuestion(row: any): Question {
  return {
    ...row,
    subject: row.subject || '物理',
    type: normalizeQuestionType(row.type),
    content: row.content ?? row.stem ?? '',
    analysis: row.analysis ?? row.explanation ?? '',
    exam_type: row.exam_type || '其他',
    knowledge_ids: row.knowledge_ids ?? row.knowledge_point_ids ?? [],
    model_ids: row.model_ids ?? row.model_point_ids ?? [],
    status: row.status || 'draft',
    has_image: !!row.has_image,
    has_formula: !!row.has_formula,
    created_by: row.created_by || '',
  } as Question;
}

async function loadQuestionsByIds(ids: string[]): Promise<Question[]> {
  const db = (window as any).dbService;
  const localRows = (db?.getAllQuestions?.() || []).map(normalizeQuestion);
  const localMap = new Map(localRows.map((q: Question) => [q.id, q]));

  try {
    const res = await fetch(`${API_BASE}/questions?limit=1000`);
    const data = await res.json();
    if (data.success && Array.isArray(data.data)) {
      for (const item of data.data.map(normalizeQuestion)) {
        localMap.set(item.id, item);
      }
    }
  } catch (_err) {}

  return ids.map(id => localMap.get(id)).filter((q): q is Question => !!q);
}

const QuestionBasket: React.FC<{ visible?: boolean }> = ({ visible = true }) => {
  const [ids, setIds] = useQuestionBasketIds();
  const [open, setOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [dockTop, setDockTop] = useState(() => {
    const saved = Number(localStorage.getItem(QUESTION_BASKET_DOCK_TOP_KEY));
    return Number.isFinite(saved) && saved >= 12 && saved <= 88 ? saved : 50;
  });
  const dragRef = useRef<{ startY: number; startTop: number; dragging: boolean; moved: boolean }>({
    startY: 0,
    startTop: 50,
    dragging: false,
    moved: false,
  });

  useEffect(() => {
    setSelectedIds(prev => prev.length === 0 ? [...ids] : prev.filter(id => ids.includes(id)));
    loadQuestionsByIds(ids).then(setQuestions);
  }, [ids]);

  const typeStats = useMemo(() => {
    const stats = new Map<string, number>();
    questions.forEach(q => {
      const type = normalizeQuestionType(q.type);
      stats.set(type, (stats.get(type) || 0) + 1);
    });
    return Array.from(stats.entries());
  }, [questions]);

  const removeSelected = () => {
    if (selectedIds.length === 0) return;
    setIds(ids.filter(id => !selectedIds.includes(id)));
    setSelectedIds([]);
  };

  const clearAll = () => {
    Modal.confirm({
      title: '清空试题篮',
      content: `确定清空试题篮中的 ${ids.length} 道试题？`,
      okText: '清空',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => {
        setIds([]);
        setSelectedIds([]);
      },
    });
  };

  const move = (index: number, offset: number) => {
    const target = index + offset;
    if (target < 0 || target >= ids.length) return;
    const next = [...ids];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    setIds(next);
  };

  const exportWord = async () => {
    if (questions.length === 0) {
      message.warning('请先加入试题');
      return;
    }
    const targetIds = selectedIds.length > 0 ? selectedIds : ids;
    const exportItems = targetIds
      .map(id => questions.find(question => question.id === id))
      .filter((question): question is Question => !!question)
      .map((question, index) => ({
        id: question.id,
        number: index + 1,
        sectionTitle: normalizeQuestionType(question.type),
        score: Number((question as any).score || 5),
        question,
      }));
    await downloadPaperDocx({
      title: `试题篮组卷_${new Date().toISOString().slice(0, 10)}`,
      questions: exportItems,
      answerPosition: 'separate',
      includeSource: true,
      includeAnswerArea: true,
    });
    message.success(`已导出 ${exportItems.length} 题到 Word`);
  };

  const goPaper = () => {
    const targetIds = selectedIds.length > 0 ? selectedIds : ids;
    localStorage.setItem(QUESTION_BASKET_SELECTED_STORAGE_KEY, JSON.stringify(targetIds));
    window.dispatchEvent(new CustomEvent('navigate-page', { detail: 'question-bank-paper' }));
    setOpen(false);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    dragRef.current = { startY: event.clientY, startTop: dockTop, dragging: true, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag.dragging) return;
    const deltaPercent = ((event.clientY - drag.startY) / window.innerHeight) * 100;
    if (Math.abs(event.clientY - drag.startY) > 3) drag.moved = true;
    setDockTop(Math.min(88, Math.max(12, drag.startTop + deltaPercent)));
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag.dragging) return;
    drag.dragging = false;
    const nextTop = Math.min(88, Math.max(12, dockTop));
    if (drag.moved) {
      localStorage.setItem(QUESTION_BASKET_DOCK_TOP_KEY, String(nextTop));
    }
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch (_err) {}
  };

  const handleFloatClick = () => {
    if (dragRef.current.moved) {
      dragRef.current.moved = false;
      return;
    }
    setOpen(prev => !prev);
  };

  if (!visible) return null;

  return (
    <>
      <button
        className={open ? 'question-basket-float open' : 'question-basket-float'}
        style={{ top: `${dockTop}%` }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClick={handleFloatClick}
        aria-label="打开试题篮"
      >
        <Badge count={ids.length} size="small" offset={[-2, 4]}>
          <ShoppingCartOutlined className="question-basket-float-icon" />
        </Badge>
        <span>试题篮</span>
      </button>

      <Drawer
        className="question-basket-drawer"
        title="试题篮"
        placement="right"
        open={open}
        onClose={() => setOpen(false)}
        width={520}
        mask
        maskClosable
        footer={
          <div className="question-basket-footer">
            <Checkbox
              checked={selectedIds.length === ids.length && ids.length > 0}
              indeterminate={selectedIds.length > 0 && selectedIds.length < ids.length}
              onChange={e => setSelectedIds(e.target.checked ? [...ids] : [])}
            >
              全选
            </Checkbox>
            <span>已选 {selectedIds.length} 题</span>
            <Space>
              <Button danger icon={<DeleteOutlined />} onClick={removeSelected} disabled={selectedIds.length === 0}>删除</Button>
              <Button onClick={clearAll} disabled={ids.length === 0}>清空</Button>
              <Button icon={<FileWordOutlined />} onClick={exportWord} disabled={ids.length === 0}>导出 Word</Button>
              <Button type="primary" onClick={goPaper} disabled={ids.length === 0}>去组卷</Button>
            </Space>
          </div>
        }
      >
        <Space wrap className="question-basket-stats">
          <Tag color="blue">共 {ids.length} 题</Tag>
          {typeStats.map(([type, count]) => <Tag key={type}>{type} {count}</Tag>)}
        </Space>
        {questions.length === 0 ? (
          <Empty description="试题篮中暂无试题" />
        ) : (
          <Checkbox.Group value={selectedIds} onChange={vals => setSelectedIds(vals as string[])} className="question-basket-list">
            {questions.map((q, index) => (
                <div
                  key={q.id}
                  className="question-basket-item"
                  onClick={(event) => {
                    if ((event.target as HTMLElement).closest('button,.ant-checkbox-wrapper')) return;
                    window.dispatchEvent(new CustomEvent('question-basket-focus', { detail: q.id }));
                    setOpen(false);
                  }}
                >
                <Checkbox value={q.id} />
                <div className="question-basket-item-body">
                  <Space size={4} wrap className="question-basket-item-tags">
                    <Tag>{index + 1}</Tag>
                    <Tag>{q.subject || '物理'}</Tag>
                    <Tag>{normalizeQuestionType(q.type)}</Tag>
                  </Space>
                  <div className="question-basket-item-content">{q.content || '未填写题干'}</div>
                </div>
                <Space direction="vertical" size={4}>
                  <Button size="small" icon={<ArrowUpOutlined />} disabled={index === 0} onClick={() => move(index, -1)} />
                  <Button size="small" icon={<ArrowDownOutlined />} disabled={index === ids.length - 1} onClick={() => move(index, 1)} />
                  <Button size="small" danger icon={<DeleteOutlined />} onClick={() => {
                    setIds(ids.filter(id => id !== q.id));
                    message.success('已移出试题篮');
                  }} />
                </Space>
              </div>
            ))}
          </Checkbox.Group>
        )}
      </Drawer>
    </>
  );
};

export default QuestionBasket;
