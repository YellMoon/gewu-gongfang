import React from 'react';
import { Button, Popconfirm, Space, Tag } from 'antd';
import { DeleteOutlined, ShoppingCartOutlined } from '@ant-design/icons';
import type { Question } from '../types';
import QuestionOptionsView from './QuestionOptionsView';
import QuestionRichContent from './QuestionRichContent';
import QuestionRichText from './QuestionRichText';

const STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  pending: '待审核',
  published: '已发布',
  offline: '已下线',
  deprecated: '已废弃',
};

const QuestionPreviewCard: React.FC<{
  question: Question;
  index?: number;
  terms?: string[];
  knowledgeNames?: string[];
  modelNames?: string[];
  inBasket?: boolean;
  showAnswer?: boolean;
  onEdit?: () => void;
  editLabel?: string;
  onToggleBasket?: () => void;
  onDelete?: () => void;
}> = ({
  question,
  index,
  terms = [],
  knowledgeNames = [],
  modelNames = [],
  inBasket = false,
  showAnswer = true,
  onEdit,
  editLabel = '编辑',
  onToggleBasket,
  onDelete,
}) => {
  const sourceText = [
    question.source,
    question.year,
    question.region,
    question.school,
    question.exam_type,
  ].filter(Boolean).join(' / ') || '来源未标注';

  return (
    <div style={{ border: '1px solid #edf0f5', borderRadius: 6, padding: 12, background: '#fff' }}>
      <Space size={6} wrap style={{ marginBottom: 6 }}>
        <Tag color="blue">{question.subject || '物理'}</Tag>
        <Tag>{question.type || '题型未标注'}</Tag>
        <Tag>{question.exam_type || '其他'}</Tag>
        <Tag>{STATUS_LABEL[String(question.status || 'draft')] || question.status || '草稿'}</Tag>
        {question.has_image && <Tag color="cyan">图片</Tag>}
        {question.has_formula && <Tag color="purple">公式</Tag>}
      </Space>
      <div style={{ lineHeight: 1.7 }}>
        {index !== undefined && <span>{index + 1}. </span>}
        <QuestionRichText terms={terms}>{question.content || question.stem || '未填写题干'}</QuestionRichText>
      </div>
      <QuestionOptionsView options={question.options as any[]} terms={terms} />
      <QuestionRichContent question={question} terms={terms} />
      {showAnswer && question.answer && (
        <div style={{ marginTop: 8, color: '#555' }}>
          答案：<QuestionRichText terms={terms}>{question.answer}</QuestionRichText>
        </div>
      )}
      {showAnswer && (question.analysis || question.explanation) && (
        <div style={{ marginTop: 8, color: '#666' }}>
          解析：<QuestionRichText terms={terms}>{question.analysis || question.explanation}</QuestionRichText>
        </div>
      )}
      <div style={{ marginTop: 8, color: '#888', fontSize: 12 }}>
        知识点：<QuestionRichText terms={terms}>{knowledgeNames.join('、') || question.knowledge_point || '未标注'}</QuestionRichText>
      </div>
      <div style={{ marginTop: 4, color: '#888', fontSize: 12 }}>
        模型：<QuestionRichText terms={terms}>{modelNames.join('、') || question.model_point || '未标注'}</QuestionRichText>
      </div>
      <div style={{ marginTop: 4, color: '#888', fontSize: 12 }}>
        试题来源：<QuestionRichText terms={terms}>{sourceText}</QuestionRichText>
      </div>
      {(onEdit || onToggleBasket || onDelete) && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10, marginTop: 10 }}>
          {onDelete && (
            <Popconfirm
              title="确定删除这道题？"
              description="删除后会进入回收站，7天内可撤回。"
              okText="删除"
              cancelText="取消"
              onConfirm={onDelete}
            >
              <Button danger icon={<DeleteOutlined />}>删除</Button>
            </Popconfirm>
          )}
          {onEdit && <Button type="link" style={{ color: '#1677ff', padding: 0 }} onClick={onEdit}>{editLabel}</Button>}
          {onToggleBasket && (
            <Button
              type={inBasket ? 'default' : 'primary'}
              icon={<ShoppingCartOutlined />}
              style={inBasket ? { color: '#1677ff', borderColor: '#1677ff', background: '#fff' } : { background: '#1677ff', border: 'none' }}
              onClick={onToggleBasket}
            >
              {inBasket ? '移出试题篮' : '加入试题篮'}
            </Button>
          )}
        </div>
      )}
    </div>
  );
};

export default QuestionPreviewCard;
