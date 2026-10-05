import React from 'react';
import { applyPhysicsNotationToTextRuns } from '../utils/physicsNotation';
import { QuestionFormulaContent } from './QuestionFormulaContent';
import type { QuestionRichDocument } from '../types/questionRichContent';
import { RichAssetImage } from './RichAssetImage';
import { columnsForOptions, normalizeOptionLabel } from '../utils/questionOptions';
import './StructuredQuestionViewer.css';

function markStyle(marks: any[] = []): React.CSSProperties {
  const style: React.CSSProperties = {};
  for (const mark of marks) {
    if (mark.type === 'bold') style.fontWeight = 700;
    if (mark.type === 'italic') style.fontStyle = 'italic';
    if (mark.type === 'underline') style.textDecoration = 'underline';
    if (mark.type === 'strike') style.textDecoration = 'line-through';
    if (mark.type === 'fontSize') style.fontSize = mark.attrs?.fontSize;
    if (mark.type === 'fontFamily') style.fontFamily = mark.attrs?.fontFamily;
    if (mark.type === 'textStyle') Object.assign(style, { color: mark.attrs?.color, fontSize: mark.attrs?.fontSize, fontFamily: mark.attrs?.fontFamily });
    if (mark.type === 'highlight') style.backgroundColor = mark.attrs?.color || '#fff3a3';
  }
  return style;
}

function renderNode(node: any, key: React.Key, textHtml?: string): React.ReactNode {
  if (!node) return null;
  if (node.type === 'text') {
    const style = markStyle(node.marks);
    const textStyle = style.fontFamily ? { ...style, '--question-quantity-font-family': style.fontFamily } as React.CSSProperties : style;
    const content = <span style={textStyle} dangerouslySetInnerHTML={{ __html: textHtml ?? applyPhysicsNotationToTextRuns([String(node.text || '')])[0] }} />;
    const verticalMark = (node.marks || []).filter((mark: any) => mark.type === 'subscript' || mark.type === 'superscript').at(-1);
    if (verticalMark?.type === 'subscript') return <sub key={key}>{content}</sub>;
    if (verticalMark?.type === 'superscript') return <sup key={key}>{content}</sup>;
    return <React.Fragment key={key}>{content}</React.Fragment>;
  }
  if (node.type === 'formula' || node.type === 'formulaBlock') {
    const latex = String(node.attrs?.canonicalLatex || '');
    // Exam layout follows paragraph/hardBreak nodes, not imported math display metadata.
    return <span key={key} className="structured-question-viewer__formula"><QuestionFormulaContent latex={latex} /></span>;
  }
  if (node.type === 'image') return <RichAssetImage key={key} src={node.attrs?.src} assetKey={node.attrs?.assetKey} alt={node.attrs?.alt || ''} width={node.attrs?.width || undefined} height={node.attrs?.height || undefined} style={{ width: node.attrs?.width || undefined, maxWidth: '100%', height: 'auto' }} data-align={node.attrs?.align || 'center'} />;
  const nodes = node.content || [];
  const formattedText = new Map<number, string>();
  const ordinaryText = (child: any) => child.type === 'text' && !(child.marks || []).some((mark: any) => ['subscript', 'superscript'].includes(mark.type));
  for (let index = 0; index < nodes.length;) {
    if (!ordinaryText(nodes[index])) { index++; continue; }
    const start = index;
    while (index < nodes.length && ordinaryText(nodes[index])) index++;
    applyPhysicsNotationToTextRuns(nodes.slice(start, index).map((child: any) => String(child.text || '')))
      .forEach((html, offset) => formattedText.set(start + offset, html));
  }
  const children = nodes.map((child: any, index: number) => renderNode(child, `${String(key)}-${index}`, formattedText.get(index)));
  const style = { textAlign: node.attrs?.textAlign, lineHeight: node.attrs?.lineHeight } as React.CSSProperties;
  if (node.type === 'table') return <div key={key} className="question-table-scroll"><table className="question-table"><tbody>{children}</tbody></table></div>;
  if (node.type === 'tableRow') return <tr key={key}>{children}</tr>;
  if (node.type === 'tableCell' || node.type === 'tableHeader') {
    const Tag = node.type === 'tableHeader' ? 'th' : 'td';
    const span = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 1000 ? value : 1;
    return <Tag key={key} colSpan={span(node.attrs?.colspan)} rowSpan={span(node.attrs?.rowspan)}>{children}</Tag>;
  }
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
  if (value.type === 'formula' || value.type === 'formulaBlock') return String(value.attrs?.canonicalLatex || '[\u516c\u5f0f\u5f85\u8865\u5168]');
  if (value.type === 'image') return '[image]';
  return (Array.isArray(value.content) ? value.content : []).map(docPlainText).join(' ');
}

function docHasContent(value: any): boolean {
  return docPlainText(value).trim().length > 0;
}

const StructuredQuestionViewer: React.FC<{ value: QuestionRichDocument; showAnswer?: boolean; answerOnly?: boolean }> = ({ value, showAnswer = false, answerOnly = false }) => {
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
    {!answerOnly && <Doc value={sections.stem} />}
    {!answerOnly && options.length > 0 && <div className={`structured-question-viewer__options cols-${optionColumns}`} style={{ gridTemplateColumns: `repeat(${optionColumns}, minmax(0, 1fr))` }}>{options.map(option => <div key={option.id} className="structured-question-viewer__option"><strong>{option.label}.</strong><div className="structured-question-viewer__option-content"><Doc value={option.content} /></div></div>)}</div>}
    {sections.subQuestions.filter(sub => !answerOnly || docHasContent(sub.answer)).map(sub => <div key={sub.id} className="structured-question-viewer__sub"><strong>{sub.label}</strong>{!answerOnly && <Doc value={sub.content} />}{showAnswer && docHasContent(sub.answer) && <div className="structured-question-viewer__sub-answer"><Doc value={sub.answer} /></div>}</div>)}
    {showAnswer && <>{docHasContent(sections.answer) && <div className="structured-question-viewer__answer"><strong>{'\u7b54\u6848\uff1a'}</strong><Doc value={sections.answer} /></div>}{docHasContent(sections.analysis) && <div className="structured-question-viewer__analysis"><strong>{'\u89e3\u6790\uff1a'}</strong><Doc value={sections.analysis} /></div>}</>}
  </div>;
};
export default StructuredQuestionViewer;
