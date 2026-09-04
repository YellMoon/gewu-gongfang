import React from 'react';
import katex from 'katex';
import type { QuestionRichDocument } from '../types/questionRichContent';
import { RichAssetImage } from './RichAssetImage';
import { columnsForOptions, normalizeOptionLabel } from '../utils/questionOptions';

function markStyle(marks: any[] = []): React.CSSProperties {
  const style: React.CSSProperties = {};
  for (const mark of marks) {
    if (mark.type === 'bold') style.fontWeight = 700;
    if (mark.type === 'italic') style.fontStyle = 'italic';
    if (mark.type === 'underline') style.textDecoration = 'underline';
    if (mark.type === 'strike') style.textDecoration = 'line-through';
    if (mark.type === 'fontFamily') style.fontFamily = mark.attrs?.fontFamily;
    if (mark.type === 'textStyle') Object.assign(style, { color: mark.attrs?.color, fontSize: mark.attrs?.fontSize, fontFamily: mark.attrs?.fontFamily });
    if (mark.type === 'highlight') style.backgroundColor = mark.attrs?.color || '#fff3a3';
  }
  return style;
}

function renderNode(node: any, key: React.Key): React.ReactNode {
  if (!node) return null;
  if (node.type === 'text') return <span key={key} style={markStyle(node.marks)}>{node.text}</span>;
  if (node.type === 'formula') {
    const latex = String(node.attrs?.canonicalLatex || '');
    const html = katex.renderToString(latex, { throwOnError: false, displayMode: node.attrs?.displayMode === 'block' });
    return <span key={key} className="structured-question-viewer__formula" dangerouslySetInnerHTML={{ __html: html }} />;
  }
  if (node.type === 'image') return <RichAssetImage key={key} src={node.attrs?.src} assetKey={node.attrs?.assetKey} alt={node.attrs?.alt || ''} style={{ width: node.attrs?.width || undefined }} data-align={node.attrs?.align || 'center'} />;
  const children = (node.content || []).map((child: any, index: number) => renderNode(child, `${String(key)}-${index}`));
  const style = { textAlign: node.attrs?.textAlign, lineHeight: node.attrs?.lineHeight } as React.CSSProperties;
  if (node.type === 'paragraph') return <p key={key} style={style}>{children}</p>;
  if (node.type === 'heading') { const Tag = `h${Math.min(6, Math.max(1, node.attrs?.level || 2))}` as keyof JSX.IntrinsicElements; return <Tag key={key} style={style}>{children}</Tag>; }
  if (node.type === 'bulletList') return <ul key={key}>{children}</ul>;
  if (node.type === 'orderedList') return <ol key={key}>{children}</ol>;
  if (node.type === 'listItem') return <li key={key}>{children}</li>;
  if (node.type === 'blockquote') return <blockquote key={key}>{children}</blockquote>;
  if (node.type === 'hardBreak') return <br key={key} />;
  return <React.Fragment key={key}>{children}</React.Fragment>;
}

const Doc: React.FC<{ value: any }> = ({ value }) => <>{renderNode(value, 'root')}</>;

function docPlainText(value: any): string {
  if (!value || typeof value !== 'object') return '';
  if (value.type === 'text') return String(value.text || '');
  if (value.type === 'formula') return String(value.attrs?.canonicalLatex || '');
  if (value.type === 'image') return '[image]';
  return (Array.isArray(value.content) ? value.content : []).map(docPlainText).join(' ');
}

function docHasContent(value: any): boolean {
  return docPlainText(value).trim().length > 0;
}

const StructuredQuestionViewer: React.FC<{ value: QuestionRichDocument; showAnswer?: boolean }> = ({ value, showAnswer = false }) => {
  const { sections } = value;
  const options = sections.options.map((option, index) => ({
    ...option,
    label: normalizeOptionLabel(option.label, index),
  }));
  const optionColumns = columnsForOptions(options.map(option => ({
    label: option.label,
    content: docPlainText(option.content),
  })));
  return <div className="structured-question-viewer">
    <Doc value={sections.stem} />
    {options.length > 0 && <div className={`structured-question-viewer__options cols-${optionColumns}`} style={{ gridTemplateColumns: `repeat(${optionColumns}, minmax(0, 1fr))` }}>{options.map(option => <div key={option.id} className="structured-question-viewer__option"><strong>{option.label}.</strong><Doc value={option.content} /></div>)}</div>}
    {sections.subQuestions.map(sub => <div key={sub.id} className="structured-question-viewer__sub"><strong>{sub.label}</strong><Doc value={sub.content} />{showAnswer && docHasContent(sub.answer) && <div className="structured-question-viewer__sub-answer"><Doc value={sub.answer} /></div>}</div>)}
    {showAnswer && <>{docHasContent(sections.answer) && <div className="structured-question-viewer__answer"><strong>{'\u7b54\u6848\uff1a'}</strong><Doc value={sections.answer} /></div>}{docHasContent(sections.analysis) && <div className="structured-question-viewer__analysis"><strong>{'\u89e3\u6790\uff1a'}</strong><Doc value={sections.analysis} /></div>}</>}
  </div>;
};
export default StructuredQuestionViewer;
