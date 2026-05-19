import React from 'react';
import { Button, Popconfirm, Space, Tag } from 'antd';
import { DeleteOutlined, EditOutlined, ShoppingCartOutlined } from '@ant-design/icons';
import type { Question } from '../types';
import QuestionRichText from './QuestionRichText';
import QuestionRenderer from './QuestionRenderer';
import './QuestionPreviewCard.css';

const difficultyColor = (difficulty?: number) => {
  if (!difficulty || difficulty <= 2) return 'green';
  if (difficulty === 3) return 'gold';
  return 'orange';
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
  onEdit,
  editLabel = '编辑',
  onToggleBasket,
  onDelete,
}) => {
  const sourceText = [question.source, question.region, question.school, question.exam_type]
    .filter(Boolean)
    .join(' / ') || '来源未标注';
  const knowledgeText = knowledgeNames.join('、') || question.knowledge_point || '知识点未标注';
  const modelText = modelNames.join('、') || question.model_point || '';

  return (
    <article id={`question-card-${question.id}`} className="qb-question-card">
      <div className="qb-card-main">
        <div className="qb-card-index">{index !== undefined ? index + 1 : ''}</div>
        <div className="qb-card-body">
          <div className="qb-card-meta">
            <Tag color="blue">{question.type || '题型未标注'}</Tag>
            <Tag color={difficultyColor(question.difficulty)}>{'★'.repeat(question.difficulty || 1)}</Tag>
            {question.exam_type && <Tag>{question.exam_type}</Tag>}
            {question.has_image && <Tag color="cyan">图片</Tag>}
            {question.has_formula && <Tag color="purple">公式</Tag>}
          </div>
          <QuestionRenderer
            content={question.content || question.stem || '未填写题干'}
            options={question.options as any[]}
            questionType={question.type}
            answer={question.answer}
            analysis={question.analysis || question.explanation}
            terms={terms}
          />
        </div>
        {(onEdit || onDelete) && (
          <Space className="qb-card-actions" size={6}>
            {onEdit && <Button type="text" icon={<EditOutlined />} onClick={onEdit}>{editLabel}</Button>}
            {onDelete && (
              <Popconfirm
                title="确定删除这道题？"
                description="删除后会进入回收站，7天内可撤回。"
                okText="删除"
                cancelText="取消"
                onConfirm={onDelete}
              >
                <Button type="text" danger icon={<DeleteOutlined />}>删除</Button>
              </Popconfirm>
            )}
          </Space>
        )}
      </div>

      <div className="qb-card-footer">
        <div className="qb-card-source-line">
          <span>来源：<QuestionRichText terms={terms}>{sourceText}</QuestionRichText></span>
          <span>知识点：<QuestionRichText terms={terms}>{knowledgeText}</QuestionRichText></span>
          {modelText && <span>模型：<QuestionRichText terms={terms}>{modelText}</QuestionRichText></span>}
        </div>
        {onToggleBasket && (
          <Button
            className={inBasket ? 'qb-basket-button active' : 'qb-basket-button'}
            type={inBasket ? 'default' : 'primary'}
            icon={<ShoppingCartOutlined />}
            onClick={onToggleBasket}
          >
            {inBasket ? '已加入试题篮' : '加入试题篮'}
          </Button>
        )}
      </div>
    </article>
  );
};

export default QuestionPreviewCard;
