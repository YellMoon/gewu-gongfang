// encoding: utf-8
import React from 'react';
import { Button, Card, Checkbox, Collapse, Input, Space, Tabs, Typography } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import type { JSONContent } from '@tiptap/react';
import RichQuestionEditor from './RichQuestionEditor';
import type { QuestionRichDocument, RichOption, RichSubQuestion } from '../types/questionRichContent';
import { emptyRichDoc } from '../types/questionRichContent';

const t = (value: string) => value;
const uid = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
type LegacyProjection = { stem?: string; answer?: string; analysis?: string };
type Props = { value: QuestionRichDocument; legacy?: LegacyProjection; onChange: (value: QuestionRichDocument) => void; onLegacyChange?: (field: keyof LegacyProjection, html: string) => void; };

function hasDocumentContent(doc?: JSONContent): boolean { return Boolean(doc?.content?.length); }

const QuestionDocumentEditor: React.FC<Props> = ({ value, legacy = {}, onChange, onLegacyChange }) => {
  const sections = value.sections;
  const patch = (next: Partial<QuestionRichDocument['sections']>) => onChange({ ...value, sections: { ...sections, ...next } });
  const updateOption = (id: string, next: Partial<RichOption>) => patch({ options: sections.options.map(item => item.id === id ? { ...item, ...next } : item) });
  const updateSub = (id: string, next: Partial<RichSubQuestion>) => patch({ subQuestions: sections.subQuestions.map(item => item.id === id ? { ...item, ...next } : item) });
  const optionItems = sections.options.map((option, index) => ({
    key: option.id,
    label: <Space><Typography.Text strong>{option.label || String.fromCharCode(65 + index)}</Typography.Text><Checkbox checked={option.isCorrect} onChange={event => updateOption(option.id, { isCorrect: event.target.checked })}>{t('\u6b63\u786e\u7b54\u6848')}</Checkbox></Space>,
    extra: <Button type="text" danger icon={<DeleteOutlined />} onClick={event => { event.stopPropagation(); patch({ options: sections.options.filter(item => item.id !== option.id) }); }} />,
    children: <><Input addonBefore={t('\u9009\u9879\u6807\u7b7e')} value={option.label} style={{ width: 180, marginBottom: 10 }} onChange={event => updateOption(option.id, { label: event.target.value })} /><RichQuestionEditor output="json" value={option.content} minHeight={90} placeholder={t('\u8f93\u5165\u9009\u9879\u5185\u5bb9')} onChange={content => updateOption(option.id, { content: content as JSONContent })} /></>,
  }));
  const subItems = sections.subQuestions.map((sub, index) => ({
    key: sub.id,
    label: <Space><Typography.Text strong>{sub.label || `(${index + 1})`}</Typography.Text><Typography.Text type="secondary">{t('\u5c0f\u9898')}</Typography.Text></Space>,
    extra: <Button type="text" danger icon={<DeleteOutlined />} onClick={event => { event.stopPropagation(); patch({ subQuestions: sections.subQuestions.filter(item => item.id !== sub.id) }); }} />,
    children: <Space direction="vertical" size={10} style={{ width: '100%' }}><Input addonBefore={t('\u5c0f\u9898\u5e8f\u53f7')} value={sub.label} style={{ width: 180 }} onChange={event => updateSub(sub.id, { label: event.target.value })} /><Typography.Text strong>{t('\u5c0f\u9898\u9898\u5e72')}</Typography.Text><RichQuestionEditor output="json" value={sub.content} minHeight={100} onChange={content => updateSub(sub.id, { content: content as JSONContent })} /><Typography.Text strong>{t('\u5c0f\u9898\u7b54\u6848')}</Typography.Text><RichQuestionEditor output="json" value={sub.answer} minHeight={80} onChange={answer => updateSub(sub.id, { answer: answer as JSONContent })} /></Space>,
  }));
  return <div className="question-document-editor">
    <Card size="small" className="question-document-editor__stem" title={t('\u9898\u5e72')}><RichQuestionEditor output="json" value={hasDocumentContent(sections.stem) ? sections.stem : legacy.stem || sections.stem} minHeight={180} placeholder={t('\u8f93\u5165\u9898\u5e72\uff0c\u53ef\u7f16\u8f91\u6587\u5b57\u3001\u516c\u5f0f\u548c\u56fe\u7247')} onChange={stem => patch({ stem: stem as JSONContent })} onHtmlChange={html => onLegacyChange?.('stem', html)} /></Card>
    <Tabs className="question-document-editor__tabs" items={[
      { key: 'options', label: `${t('\u9009\u9879')} (${sections.options.length})`, children: <Space direction="vertical" size={10} style={{ width: '100%' }}>{optionItems.length ? <Collapse items={optionItems} defaultActiveKey={optionItems.map(item => item.key)} /> : <Typography.Text type="secondary">{t('\u5f53\u524d\u9898\u578b\u6682\u65e0\u9009\u9879')}</Typography.Text>}<Button icon={<PlusOutlined />} onClick={() => patch({ options: [...sections.options, { id: uid('option'), label: String.fromCharCode(65 + sections.options.length), isCorrect: false, content: emptyRichDoc() }] })}>{t('\u6dfb\u52a0\u9009\u9879')}</Button></Space> },
      { key: 'subs', label: `${t('\u5c0f\u9898')} (${sections.subQuestions.length})`, children: <Space direction="vertical" size={10} style={{ width: '100%' }}>{subItems.length ? <Collapse items={subItems} defaultActiveKey={subItems.map(item => item.key)} /> : <Typography.Text type="secondary">{t('\u6682\u65e0\u5c0f\u9898')}</Typography.Text>}<Button icon={<PlusOutlined />} onClick={() => patch({ subQuestions: [...sections.subQuestions, { id: uid('sub'), label: `(${sections.subQuestions.length + 1})`, content: emptyRichDoc(), answer: emptyRichDoc() }] })}>{t('\u6dfb\u52a0\u5c0f\u9898')}</Button></Space> },
      { key: 'answer', label: t('\u7b54\u6848'), children: <RichQuestionEditor output="json" value={hasDocumentContent(sections.answer) ? sections.answer : legacy.answer || sections.answer} minHeight={130} placeholder={t('\u8f93\u5165\u7b54\u6848')} onChange={answer => patch({ answer: answer as JSONContent })} onHtmlChange={html => onLegacyChange?.('answer', html)} /> },
      { key: 'analysis', label: t('\u89e3\u6790'), children: <RichQuestionEditor output="json" value={hasDocumentContent(sections.analysis) ? sections.analysis : legacy.analysis || sections.analysis} minHeight={150} placeholder={t('\u8f93\u5165\u89e3\u6790')} onChange={analysis => patch({ analysis: analysis as JSONContent })} onHtmlChange={html => onLegacyChange?.('analysis', html)} /> },
    ]} />
  </div>;
};
export default QuestionDocumentEditor;
