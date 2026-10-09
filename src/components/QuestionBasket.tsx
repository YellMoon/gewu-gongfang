import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Button, Checkbox, Drawer, Empty, Modal, Space, Tag, message } from 'antd';
import { useRef } from 'react';
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  ShoppingCartOutlined,
} from '@ant-design/icons';
import type { Question } from '../types';
import { normalizeQuestionType } from '../constants/questionTypes';
import './QuestionBasket.css';

export const QUESTION_BASKET_STORAGE_KEY = 'question_basket_ids';
export const QUESTION_BASKET_SELECTED_STORAGE_KEY = 'question_basket_selected';
export const QUESTION_BASKET_EVENT = 'question-basket-changed';
const QUESTION_BASKET_DOCK_TOP_KEY = 'question_basket_dock_top';
const QUESTION_BASKET_POSITION_KEY = 'question_basket_position_v2';

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
  await db?.refreshAuthorityProjection?.({ notifyConsumers: false });
  const localRows = (db?.getAllQuestions?.() || []).map(normalizeQuestion);
  const localMap = new Map(localRows.map((q: Question) => [q.id, q]));
  return ids.map(id => localMap.get(id)).filter((q): q is Question => !!q);
}

const QuestionBasket: React.FC<{ visible?: boolean }> = ({ visible = true }) => {
  const [ids, setIds] = useQuestionBasketIds();
  const [open, setOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [position, setPosition] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(QUESTION_BASKET_POSITION_KEY) || 'null');
      if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) return saved as { x: number; y: number };
    } catch {}
    const savedTop = Number(localStorage.getItem(QUESTION_BASKET_DOCK_TOP_KEY));
    return { x: 94, y: savedTop >= 12 && savedTop <= 88 ? savedTop : 50 };
  });
  const floatRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef({ startX: 0, startY: 0, startLeft: 0, startTop: 0, dragging: false, moved: false });
  const clampPosition = useCallback((x: number, y: number) => {
    const width = floatRef.current?.offsetWidth || 76;
    const height = floatRef.current?.offsetHeight || 102;
    return {
      x: Math.min(Math.max(8, window.innerWidth - width - 8), Math.max(8, x)) / window.innerWidth * 100,
      y: Math.min(Math.max(8, window.innerHeight - height - 8), Math.max(8, y)) / window.innerHeight * 100,
    };
  }, []);
  useEffect(() => {
    const resize = () => setPosition(current => clampPosition(current.x / 100 * window.innerWidth, current.y / 100 * window.innerHeight));
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [clampPosition, visible]);

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

  const goPaper = () => {
    const targetIds = selectedIds.length > 0 ? selectedIds : ids;
    localStorage.setItem(QUESTION_BASKET_SELECTED_STORAGE_KEY, JSON.stringify(targetIds));
    window.dispatchEvent(new CustomEvent('navigate-page', { detail: 'question-bank-paper' }));
    setOpen(false);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const box = event.currentTarget.getBoundingClientRect();
    dragRef.current = { startX: event.clientX, startY: event.clientY, startLeft: box.left, startTop: box.top, dragging: true, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag.dragging) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.hypot(dx, dy) > 3) drag.moved = true;
    if (drag.moved) setPosition(clampPosition(drag.startLeft + dx, drag.startTop + dy));
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag.dragging) return;
    drag.dragging = false;
    if (drag.moved) {
      const box = event.currentTarget.getBoundingClientRect();
      localStorage.setItem(QUESTION_BASKET_POSITION_KEY, JSON.stringify(clampPosition(box.left, box.top)));
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
        ref={floatRef}
        className={open ? 'question-basket-float open' : 'question-basket-float'}
        style={{ left: `${position.x}%`, top: `${position.y}%` }}
        title={'\u70b9\u51fb\u6253\u5f00\u8bd5\u9898\u7bee\uff0c\u62d6\u52a8\u53ef\u79fb\u52a8\u4f4d\u7f6e'}
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
