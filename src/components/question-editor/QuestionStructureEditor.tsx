import React from 'react';
import { Button, Card, Checkbox, Collapse, Input, Radio, Space, Tabs, Typography } from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import type { JSONContent } from '@tiptap/react';
import RichQuestionEditor from '../RichQuestionEditor';
import type { QuestionRichDocument } from '../../types/questionRichContent';
import { addOption, addSubQuestion, choiceMode, moveEntity, removeEntity, setCorrectSelection, updateEntity } from './questionStructureOperations';

export type QuestionStructureEditorProps = {
  value: QuestionRichDocument;
  onChange: (value: QuestionRichDocument) => void;
  createId?: (kind: 'option' | 'sub') => string;
  confirmDelete?: (kind: 'option' | 'sub') => boolean;
  disabled?: boolean;
  questionType?: string;
};

const labels = {
  option: '\u9009\u9879', sub: '\u5c0f\u9898', correct: '\u6b63\u786e\u7b54\u6848',
  optionLabel: '\u9009\u9879\u6807\u7b7e', optionContent: '\u8f93\u5165\u9009\u9879\u5185\u5bb9',
  subLabel: '\u5c0f\u9898\u5e8f\u53f7', subStem: '\u5c0f\u9898\u9898\u5e72', subAnswer: '\u5c0f\u9898\u7b54\u6848',
  stem: '\u9898\u5e72', stemPlaceholder: '\u8f93\u5165\u9898\u5e72\uff0c\u53ef\u7f16\u8f91\u6587\u5b57\u3001\u516c\u5f0f\u548c\u56fe\u7247',
  emptyOptions: '\u5f53\u524d\u6ca1\u6709\u9009\u9879', emptySubs: '\u5f53\u524d\u6ca1\u6709\u5c0f\u9898',
  addOption: '\u6dfb\u52a0\u9009\u9879', addSub: '\u6dfb\u52a0\u5c0f\u9898', mainAnswer: '\u4e3b\u7b54\u6848', analysis: '\u89e3\u6790',
};

const defaultId = (kind: 'option' | 'sub') => `${kind}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

const QuestionStructureEditor: React.FC<QuestionStructureEditorProps> = ({ value, onChange, createId = defaultId, confirmDelete, disabled = false, questionType }) => {
  const { sections } = value;
  const mode = choiceMode(questionType);
  const confirmRemoval = (kind: 'option' | 'sub') => confirmDelete ? confirmDelete(kind) : window.confirm(`\u8be5${labels[kind]}\u5df2\u6709\u5185\u5bb9\uff0c\u786e\u5b9a\u5220\u9664\u5417\uff1f`);
  const optionItems = sections.options.map((option, index) => ({
    key: option.id,
    label: <Space><Typography.Text strong>{option.label || String.fromCharCode(65 + index)}</Typography.Text>{mode === 'single' ? <Radio disabled={disabled} checked={option.isCorrect} onChange={() => onChange(setCorrectSelection(value, option.id, true, 'single'))}>{labels.correct}</Radio> : <Checkbox disabled={disabled} checked={option.isCorrect} onChange={event => onChange(setCorrectSelection(value, option.id, event.target.checked, mode === 'multiple' ? 'multiple' : 'other'))}>{labels.correct}</Checkbox>}</Space>,
    extra: <Space onClick={event => event.stopPropagation()}>
      <Button aria-label={`move option ${option.label} up`} disabled={disabled || index === 0} type="text" icon={<ArrowUpOutlined />} onClick={() => onChange(moveEntity(value, 'options', option.id, -1))} />
      <Button aria-label={`move option ${option.label} down`} disabled={disabled || index === sections.options.length - 1} type="text" icon={<ArrowDownOutlined />} onClick={() => onChange(moveEntity(value, 'options', option.id, 1))} />
      <Button aria-label={`delete option ${option.label}`} disabled={disabled} type="text" danger icon={<DeleteOutlined />} onClick={() => onChange(removeEntity(value, 'options', option.id, () => confirmRemoval('option')))} />
    </Space>,
    children: <Space direction="vertical" size={8} style={{ width: '100%' }}>
      <Space size={8}><Typography.Text>{labels.optionLabel}</Typography.Text><Input disabled={disabled} aria-label={labels.optionLabel} value={option.label} style={{ width: 120 }} onChange={event => onChange(updateEntity(value, 'options', option.id, { label: event.target.value }))} /></Space>
      <RichQuestionEditor disabled={disabled} output="json" value={option.content} minHeight={88} placeholder={labels.optionContent} onChange={content => onChange(updateEntity(value, 'options', option.id, { content: content as JSONContent }))} />
    </Space>,
  }));
  const subItems = sections.subQuestions.map((sub, index) => ({
    key: sub.id,
    label: <Typography.Text strong>{sub.label || `(${index + 1})`} {labels.sub}</Typography.Text>,
    extra: <Space onClick={event => event.stopPropagation()}>
      <Button aria-label={`move subquestion ${sub.label} up`} disabled={disabled || index === 0} type="text" icon={<ArrowUpOutlined />} onClick={() => onChange(moveEntity(value, 'subQuestions', sub.id, -1))} />
      <Button aria-label={`move subquestion ${sub.label} down`} disabled={disabled || index === sections.subQuestions.length - 1} type="text" icon={<ArrowDownOutlined />} onClick={() => onChange(moveEntity(value, 'subQuestions', sub.id, 1))} />
      <Button aria-label={`delete subquestion ${sub.label}`} disabled={disabled} type="text" danger icon={<DeleteOutlined />} onClick={() => onChange(removeEntity(value, 'subQuestions', sub.id, () => confirmRemoval('sub')))} />
    </Space>,
    children: <Space direction="vertical" size={8} style={{ width: '100%' }}>
      <Space size={8}><Typography.Text>{labels.subLabel}</Typography.Text><Input disabled={disabled} aria-label={labels.subLabel} value={sub.label} style={{ width: 120 }} onChange={event => onChange(updateEntity(value, 'subQuestions', sub.id, { label: event.target.value }))} /></Space>
      <Typography.Text strong>{labels.subStem}</Typography.Text>
      <RichQuestionEditor disabled={disabled} output="json" value={sub.content} minHeight={96} onChange={content => onChange(updateEntity(value, 'subQuestions', sub.id, { content: content as JSONContent }))} />
      <Typography.Text strong>{labels.subAnswer}</Typography.Text>
      <RichQuestionEditor disabled={disabled} output="json" value={sub.answer} minHeight={80} onChange={answer => onChange(updateEntity(value, 'subQuestions', sub.id, { answer: answer as JSONContent }))} />
    </Space>,
  }));
  return <div className="question-structure-editor" data-testid="question-structure-editor">
    <Card size="small" title={labels.stem}><RichQuestionEditor disabled={disabled} output="json" value={sections.stem} minHeight={180} placeholder={labels.stemPlaceholder} onChange={stem => onChange({ ...value, sections: { ...sections, stem: stem as JSONContent } })} /></Card>
    <Tabs items={[
      { key: 'options', label: `${labels.option} (${optionItems.length})`, children: <Space direction="vertical" style={{ width: '100%' }}>{optionItems.length ? <Collapse items={optionItems} defaultActiveKey={optionItems.map(item => item.key)} /> : <Typography.Text type="secondary">{labels.emptyOptions}</Typography.Text>}<Button disabled={disabled} icon={<PlusOutlined />} onClick={() => onChange(addOption(value, () => createId('option')))}>{labels.addOption}</Button></Space> },
      { key: 'subs', label: `${labels.sub} (${subItems.length})`, children: <Space direction="vertical" style={{ width: '100%' }}>{subItems.length ? <Collapse items={subItems} defaultActiveKey={subItems.map(item => item.key)} /> : <Typography.Text type="secondary">{labels.emptySubs}</Typography.Text>}<Button disabled={disabled} icon={<PlusOutlined />} onClick={() => onChange(addSubQuestion(value, () => createId('sub')))}>{labels.addSub}</Button></Space> },
      { key: 'answer', label: labels.mainAnswer, children: <RichQuestionEditor disabled={disabled || mode !== 'other'} output="json" value={sections.answer} minHeight={130} placeholder={labels.mainAnswer} onChange={answer => onChange({ ...value, sections: { ...sections, answer: answer as JSONContent } })} /> },
      { key: 'analysis', label: labels.analysis, children: <RichQuestionEditor disabled={disabled} output="json" value={sections.analysis} minHeight={150} placeholder={labels.analysis} onChange={analysis => onChange({ ...value, sections: { ...sections, analysis: analysis as JSONContent } })} /> },
    ]} />
  </div>;
};

export default QuestionStructureEditor;
