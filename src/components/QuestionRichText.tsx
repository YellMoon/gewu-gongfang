import React from 'react';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sanitizeRichText(value: React.ReactNode, terms: string[] = []): string {
  let html = escapeHtml(String(value ?? ''));
  html = html
    .replace(/&lt;(\/?)(sub|sup)&gt;/gi, '<$1$2>')
    .replace(/\r?\n/g, '<br />');

  html = html
    .replace(/([A-Za-zα-ωΑ-Ω])([0-9]+)(?![0-9A-Za-z])/g, '$1<sub>$2</sub>')
    .replace(/(?!H[zZ](?![0-9A-Za-z]))([A-Za-z])([xyzXYZ])(?![0-9A-Za-z])/g, '$1<sub>$2</sub>');

  const activeTerms = Array.from(new Set((terms || []).map(item => String(item || '').trim()).filter(Boolean)));
  if (activeTerms.length > 0) {
    const pattern = activeTerms.map(escapeRegExp).join('|');
    const regex = new RegExp(`(${pattern})`, 'gi');
    html = html.replace(regex, '<mark class="question-rich-mark">$1</mark>');
  }
  return html;
}

const QuestionRichText: React.FC<{
  children?: React.ReactNode;
  terms?: string[];
  className?: string;
  style?: React.CSSProperties;
}> = ({ children, terms = [], className, style }) => (
  <span
    className={className}
    style={style}
    dangerouslySetInnerHTML={{ __html: sanitizeRichText(children, terms) }}
  />
);

export default QuestionRichText;
