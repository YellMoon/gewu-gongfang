import React from 'react';
import { useEffect, useState } from 'react';
import { Button, Checkbox, Popconfirm, Space } from 'antd';
import { DeleteOutlined, EditOutlined, ShoppingCartOutlined } from '@ant-design/icons';
import type { Question } from '../types';
import QuestionRichText from './QuestionRichText';
import QuestionRenderer from './QuestionRenderer';
import QuestionRichContent from './QuestionRichContent';
import { getQuestionAssetDataUrl, isAssetRef } from '../services/questionAssetStore';
import './QuestionPreviewCard.css';

function contentWithInlineAssets(question: Question): string {
  let content = question.content || question.stem || '未填写题干';
  const assets = Array.isArray((question as any).assets) ? (question as any).assets : [];
  assets
    .filter((asset: any) => asset?.asset_type === 'image')
    .forEach((asset: any) => {
      const src = asset.resolved_url || asset.oss_url || asset.data_url || asset.url;
      const fileName = asset.file_name || '';
      if (!src || !fileName || content.includes(src)) return;
      const escaped = fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      content = content.replace(new RegExp(`(?:^|\\s)${escaped}(?=\\s|$)`, 'g'), match => {
        const prefix = match.startsWith(fileName) ? '' : match.slice(0, match.indexOf(fileName));
        return `${prefix}<img src="${src}" alt="${fileName}" />`;
      });
    });
  return content;
}

const QuestionPreviewCard: React.FC<{
  question: Question;
  index?: number;
  terms?: string[];
  knowledgeNames?: string[];
  modelNames?: string[];
  inBasket?: boolean;
  selectable?: boolean;
  checked?: boolean;
  showAnswer?: boolean;
  onCheckChange?: (checked: boolean) => void;
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
  selectable = false,
  checked = false,
  onCheckChange,
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
  const [resolvedQuestion, setResolvedQuestion] = useState<Question>(question);

  useEffect(() => {
    let cancelled = false;
    setResolvedQuestion(question);
    async function resolveAssets() {
      const copy: any = { ...question };
      const assets = Array.isArray((question as any).assets) ? (question as any).assets : [];
      copy.assets = await Promise.all(assets.map(async (asset: any) => {
        const src = asset?.oss_url || asset?.data_url || asset?.url;
        if (isAssetRef(src)) {
          const resolved = await getQuestionAssetDataUrl(src);
          return { ...asset, resolved_url: resolved || src };
        }
        return asset;
      }));
      for (const asset of copy.assets) {
        const src = asset?.oss_url || asset?.data_url || asset?.url;
        if (!isAssetRef(src) || !asset?.resolved_url) continue;
        for (const field of ['content', 'stem', 'answer', 'analysis']) {
          if (typeof copy[field] === 'string') copy[field] = copy[field].split(src).join(asset.resolved_url);
        }
      }
      if (!cancelled) setResolvedQuestion(copy);
    }
    resolveAssets();
    return () => { cancelled = true; };
  }, [question]);

  const displayContent = contentWithInlineAssets(resolvedQuestion);

  return (
    <article id={`question-card-${question.id}`} className="qb-question-card">
      <div className="qb-card-main">
        {selectable && (
          <Checkbox
            className="qb-card-checkbox"
            checked={checked}
            onChange={event => onCheckChange?.(event.target.checked)}
            onClick={event => event.stopPropagation()}
          />
        )}
        <div className="qb-card-index">{index !== undefined ? index + 1 : ''}</div>
        <div className="qb-card-body">
          <QuestionRenderer
            content={displayContent}
            options={resolvedQuestion.options as any[]}
            questionType={resolvedQuestion.type}
            answer={resolvedQuestion.answer}
            analysis={resolvedQuestion.analysis || resolvedQuestion.explanation}
            terms={terms}
          />
          <QuestionRichContent question={resolvedQuestion} terms={terms} />
        </div>
      </div>

      <div className="qb-card-footer">
        <div className="qb-card-source-line">
          <span>来源：<QuestionRichText terms={terms}>{sourceText}</QuestionRichText></span>
          <span>知识点：<QuestionRichText terms={terms}>{knowledgeText}</QuestionRichText></span>
          {modelText && <span>模型：<QuestionRichText terms={terms}>{modelText}</QuestionRichText></span>}
        </div>
        <Space className="qb-card-footer-actions" size={8}>
          {onDelete && (
            <Popconfirm
              title="确定删除这道题？"
              description="删除后会进入回收站，7天内可撤回。"
              okText="删除"
              cancelText="取消"
              onConfirm={onDelete}
            >
              <Button className="qb-delete-button" danger icon={<DeleteOutlined />}>删除</Button>
            </Popconfirm>
          )}
          {onEdit && <Button className="qb-edit-button" icon={<EditOutlined />} onClick={onEdit}>{editLabel}</Button>}
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
        </Space>
      </div>
    </article>
  );
};

export default React.memo(QuestionPreviewCard);
