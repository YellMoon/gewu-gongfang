import React, { useMemo } from 'react';
import katex from 'katex';
import './QuestionRenderer.css';
import {
  applyPhysicsNotationToHTML,
  createKaTeXPhysicsOptions,
  PHYSICS_KATEX_GLOBAL_MACROS,
  PHYSICS_KATEX_MACROS,
} from '../utils/physicsNotation';

interface QuestionRendererProps {
  content: string;
  options?: any[];
  questionType?: string;
  /** 表格单元格内联模式：截断纯文本 */
  inline?: boolean;
  showAnalysis?: boolean;
  analysis?: string;
  terms?: string[];
}

interface ContentSegment {
  type: 'html' | 'math-display' | 'math-inline';
  value: string;
}

function splitInlineMath(text: string): ContentSegment[] {
  const segments: ContentSegment[] = [];
  const re = /\$([^$]+?)\$/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      segments.push({ type: 'html', value: text.slice(last, m.index) });
    }
    segments.push({ type: 'math-inline', value: m[1] });
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    segments.push({ type: 'html', value: text.slice(last) });
  }
  return segments;
}

function splitMixedContent(content: string): ContentSegment[] {
  const segments: ContentSegment[] = [];
  const re = /\$\$([\s\S]*?)\$\$/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (m.index > last) {
      segments.push(...splitInlineMath(content.slice(last, m.index)));
    }
    segments.push({ type: 'math-display', value: m[1] });
    last = m.index + m[0].length;
  }
  if (last < content.length) {
    segments.push(...splitInlineMath(content.slice(last)));
  }
  return segments.length > 0 ? segments : [{ type: 'html', value: content }];
}

export function stripHtmlAndMath(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/\$\$[\s\S]*?\$\$/g, '')
    .replace(/\$[^$]+?\$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function applySearchHighlight(html: string, terms: string[] = []): string {
  const activeTerms = Array.from(new Set(terms.map(term => String(term || '').trim()).filter(Boolean)));
  if (activeTerms.length === 0) return html;
  const pattern = activeTerms.map(escapeRegExp).join('|');
  return html.replace(new RegExp(`(${pattern})`, 'gi'), '<mark class="question-rich-mark">$1</mark>');
}

function normalizePhysicsHtml(html: string): string {
  return html
    .replace(/&lt;(\/?)(sub|sup|i|b|strong|em)&gt;/gi, '<$1$2>')
    .replace(/\r?\n/g, '<br />')
    .replace(/([A-Za-zα-ωΑ-Ω])([0-9]+)(?![0-9A-Za-z])/g, '$1<sub>$2</sub>')
    .replace(/([A-Za-z])([xyzXYZ])(?![0-9A-Za-z])/g, '$1<sub>$2</sub>');
}

/** 对非数学模式的 HTML 文本应用物理学科字体规范 */
function processHtmlSegment(html: string): string {
  return normalizePhysicsHtml(applyPhysicsNotationToHTML(html));
}

const KaTeXMath: React.FC<{ latex: string; displayMode: boolean }> = ({ latex, displayMode }) => {
  let rendered: string;
  try {
    rendered = katex.renderToString(latex, createKaTeXPhysicsOptions(displayMode));
  } catch {
    rendered = katex.renderToString(latex, {
      displayMode,
      throwOnError: false,
      strict: false,
      trust: true,
      macros: {},
    });
  }
  if (displayMode) {
    return <div className="math-display" dangerouslySetInnerHTML={{ __html: rendered }} />;
  }
  return <span className="math-inline" dangerouslySetInnerHTML={{ __html: rendered }} />;
};

const QuestionRenderer: React.FC<QuestionRendererProps> = ({
  content,
  options,
  questionType,
  inline,
  showAnalysis,
  analysis,
  terms = [],
}) => {
  const isChoice = questionType === '单选题' || questionType === '多选题';

  const { stemText, stemImages } = useMemo(() => {
    if (!isChoice) return { stemText: content || '', stemImages: [] as string[] };

    const allImages: string[] = [];
    const re = /<img[^>]+src\s*=\s*["']([^"']+)["'][^>]*\/?>/gi;
    const cleanText = (content || '').replace(re, (_m, src: string) => {
      allImages.push(src);
      return '';
    });
    return { stemText: cleanText, stemImages: allImages };
  }, [content, isChoice]);

  const segments = useMemo(() => splitMixedContent(stemText), [stemText]);

  if (inline) {
    const plain = stripHtmlAndMath(content || '');
    return (
      <span
        style={{
          maxWidth: 350,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          display: 'block',
        }}
      >
        {plain}
      </span>
    );
  }

  const renderSegment = (seg: ContentSegment, idx: number) => {
    if (seg.type === 'math-display') {
      return <KaTeXMath key={idx} latex={seg.value} displayMode />;
    }
    if (seg.type === 'math-inline') {
      return <KaTeXMath key={idx} latex={seg.value} displayMode={false} />;
    }
    if (!seg.value.trim()) return null;
    const processed = applySearchHighlight(processHtmlSegment(seg.value), terms);
    return <span key={idx} dangerouslySetInnerHTML={{ __html: processed }} />;
  };

  const normalizedOptions = normalizeOptions(options || []);
  const optCount = normalizedOptions.length;
  const optCols = columnsForOptions(normalizedOptions);

  return (
    <div className="question-content">
      <div className="question-stem">{segments.map(renderSegment)}</div>

      {isChoice && stemImages.length > 0 && (
        <div className="question-images">
          {stemImages.map((src, i) => (
            <img key={i} src={src} alt={`题目图片 ${i + 1}`} />
          ))}
        </div>
      )}

      {options && optCount > 0 && (
        <div className={`question-options cols-${optCols}`}>
          {normalizedOptions.map((opt, i) => (
            <div key={`${opt.label}-${i}`} className="question-option">
              <span className="question-option-label">{opt.label}.</span>
              <span dangerouslySetInnerHTML={{ __html: applySearchHighlight(processHtmlSegment(opt.content), terms) }} />
            </div>
          ))}
        </div>
      )}

      {showAnalysis && analysis && (
        <div className="question-analysis">
          <strong>【解析】</strong>
          <span dangerouslySetInnerHTML={{ __html: applySearchHighlight(processHtmlSegment(analysis), terms) }} />
        </div>
      )}
    </div>
  );
};

export default QuestionRenderer;
// 导出供 Word 导出等场景使用
export { createKaTeXPhysicsOptions, PHYSICS_KATEX_GLOBAL_MACROS, PHYSICS_KATEX_MACROS };

function normalizeOption(option: any, index: number): { label: string; content: string } {
  if (typeof option === 'string') {
    const match = option.trim().match(/^([A-G])[\.\u3001\uff0e\s]+([\s\S]*)$/i);
    return {
      label: (match?.[1] || String.fromCharCode(65 + index)).toUpperCase(),
      content: (match?.[2] || option).trim(),
    };
  }
  return {
    label: String(option?.label || String.fromCharCode(65 + index)).toUpperCase(),
    content: String(option?.content || option?.text || '').trim(),
  };
}

function splitPackedOptions(options: Array<{ label: string; content: string }>): Array<{ label: string; content: string }> {
  if (options.length !== 1) return options;
  const raw = `${options[0].label}. ${options[0].content}`;
  const matches = Array.from(raw.matchAll(/(?:^|\s)([A-G])[\.\u3001\uff0e\s]+([\s\S]*?)(?=\s+[A-G][\.\u3001\uff0e\s]+|$)/g));
  if (matches.length < 2) return options;
  return matches.map(match => ({
    label: match[1].toUpperCase(),
    content: match[2].trim(),
  })).filter(item => item.content);
}

function normalizeOptions(options: any[]): Array<{ label: string; content: string }> {
  const rows = (Array.isArray(options) ? options : [])
    .map(normalizeOption)
    .filter(option => option.content);
  return splitPackedOptions(rows);
}

function columnsForOptions(options: Array<{ label: string; content: string }>): number {
  if (options.length >= 5) return 1;
  if (options.length !== 4) return 1;
  const maxLen = Math.max(...options.map(option => option.content.replace(/<[^>]+>/g, '').length));
  if (maxLen <= 12) return 4;
  if (maxLen <= 28) return 2;
  return 1;
}
