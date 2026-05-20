import React, { useCallback, useMemo, useState } from 'react';
import katex from 'katex';
import './QuestionRenderer.css';
import {
  createKaTeXPhysicsOptions,
  PHYSICS_KATEX_GLOBAL_MACROS,
  PHYSICS_KATEX_MACROS,
} from '../utils/physicsNotation';

interface QuestionRendererProps {
  content: string;
  options?: any[];
  questionType?: string;
  inline?: boolean;
  answer?: string;
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

function convertHtmlLatexFractions(content: string): string {
  return (content || '').replace(
    /\$\\frac\{([^{}]*)\}\{([^{}]*)\}\$/g,
    (match, num, den) => (
      String(num + den).includes('<')
        ? `<span class="omml-frac"><span class="omml-frac-num">${num}</span><span class="omml-frac-den">${den}</span></span>`
        : match
    )
  );
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
  const protectedImages: string[] = [];
  const imageSafeHtml = (html || '').replace(/<img\b[^>]*>/gi, match => {
    const token = `@@QUESTION_IMAGE_${protectedImages.length}@@`;
    protectedImages.push(match);
    return token;
  });
  const unitCore = '(?:kg|mol|cd|rad|sr|Hz|Pa|J|Wb|W|C|V|F|T|H|N|A|K|m|s|L|eV|MeV|GeV|min|h|Ω)';
  const unitToken = `(?:[YZEPTGMkhdcmμunpfa]?${unitCore})`;
  const unitExpr = `${unitToken}(?:\\s*(?:[·⋅*/\\\\/]|<sup>-?\\d+</sup>|\\^?-?\\d+)\\s*${unitToken})*`;
  const restoreUnits = (value: string) => value.replace(
    new RegExp(`(\\d(?:[\\d.,×xX+\\-]*\\d)?\\s*)((?:<i>[A-Za-zμΩ]+<\\/i>|[·⋅*/\\\\/\\s]|<sup>-?\\d+<\\/sup>|\\^?-?\\d+)+)(?=\\s|[\\u4e00-\\u9fff]|[,，。；;、）)]|$)`, 'g'),
    (_match, prefix, body) => prefix + body.replace(/<\/?i>/g, '')
  );

  return restoreUnits(imageSafeHtml)
    .replace(/<i>k<\/i><i>g<\/i>/g, 'kg')
    .replace(/<i>(N|Pa|J|W|C|V|F|T|H|A|K|Hz|Ω)<\/i>(?=(?:<sup>|[·⋅.*/\/]))/g, '$1')
    .replace(/(?<=[·⋅.*/\/])<i>(m|s|g|A|K|mol|cd|rad|Hz|N|Pa|J|W|C|V|F|T|H|Ω)<\/i>/g, '$1')
    .replace(/<i>(m|s|g|A|K|mol|cd|rad|Hz|N|Pa|J|W|C|V|F|T|H|Ω)<\/i>(?=<sup>-?\d+<\/sup>)/g, '$1')
    .replace(/<i>([A-Za-zα-ωΑ-Ω])i>/g, '<i>$1</i>')
    .replace(/<\/<sup>/g, '</sup>')
    .replace(/<\/<sub>/g, '</sub>')
    .replace(/<\/sup><\/sup>/g, '</sup>')
    .replace(/<\/sub><\/sub>/g, '</sub>')
    .replace(/<sup>([^<]+)<\/<sup>/g, '<sup>$1</sup>')
    .replace(/<sub>([^<]+)<\/<sub>/g, '<sub>$1</sub>')
    .replace(/<sup>([^<]*)$/g, '<sup>$1</sup>')
    .replace(/<sub>([^<]*)$/g, '<sub>$1</sub>')
    .replace(/&lt;(\/?)(sub|sup|i|b|strong|em)&gt;/gi, '<$1$2>')
    .replace(/\r?\n/g, '<br />')
    .replace(/<span class="nuclear-left">([\s\S]*?)<\/span>\s*(?:<i>)?([A-Z][a-z]?)(?:<\/i>)?/g, '<span class="nuclear-symbol"><span class="nuclear-left">$1</span><span class="nuclear-core">$2</span></span>')
    .replace(/<sup>([^<]+)<\/sup>\s*<sub>([^<]+)<\/sub>\s*(?:<i>)?([A-Z][a-z]?)(?:<\/i>)?/g, '<span class="nuclear-symbol"><span class="nuclear-left"><sup>$1</sup><sub>$2</sub></span><span class="nuclear-core">$3</span></span>')
    .replace(/<sub>([^<]+)<\/sub>\s*<sup>([^<]+)<\/sup>\s*(?:<i>)?([A-Z][a-z]?)(?:<\/i>)?/g, '<span class="nuclear-symbol"><span class="nuclear-left"><sup>$2</sup><sub>$1</sub></span><span class="nuclear-core">$3</span></span>')
    .replace(new RegExp(`(?<=\\d)\\s*(${unitExpr})`, 'g'), '<span class="physics-unit"> $1</span>')
    .replace(/(?<![A-Za-z])([A-Za-zα-ωΑ-Ω])([0-9]+)(?![0-9A-Za-z]|\.(?:png|jpe?g|gif|webp|svg))/gi, '$1<sub>$2</sub>')
    .replace(/(?<![A-Za-z])([A-Za-z])([xyzXYZ])(?![0-9A-Za-z])/g, '$1<sub>$2</sub>')
    .replace(/@@QUESTION_IMAGE_(\d+)@@/g, (_match, index) => protectedImages[Number(index)] || '');
}

function processHtmlSegment(html: string): string {
  return normalizePhysicsHtml(html);
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
  answer,
  showAnalysis,
  analysis,
  terms = [],
}) => {
  const isChoice = questionType === '单选题' || questionType === '多选题' || questionType === '鍗曢€夐' || questionType === '澶氶€夐';
  const [expanded, setExpanded] = useState(false);
  const hasDrawer = Boolean(answer || analysis);

  const { stemText, stemImages } = useMemo(() => {
    return { stemText: convertHtmlLatexFractions(content || ''), stemImages: [] as string[] };
  }, [content]);

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
  const toggleDrawer = useCallback(() => {
    if (hasDrawer && !showAnalysis) {
      setExpanded(prev => !prev);
    }
  }, [hasDrawer, showAnalysis]);
  const closeDrawer = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
    setExpanded(false);
  }, []);
  const renderHtml = (value?: string) => (
    <span dangerouslySetInnerHTML={{ __html: applySearchHighlight(processHtmlSegment(value || ''), terms) }} />
  );

  return (
    <div className="question-content">
      <div
        className={`question-stem-wrapper${hasDrawer && !showAnalysis ? ' has-drawer' : ''}`}
        onClick={toggleDrawer}
        role={hasDrawer && !showAnalysis ? 'button' : undefined}
        tabIndex={hasDrawer && !showAnalysis ? 0 : undefined}
        onKeyDown={(event) => {
          if ((event.key === 'Enter' || event.key === ' ') && hasDrawer && !showAnalysis) {
            event.preventDefault();
            setExpanded(prev => !prev);
          }
        }}
      >
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

        {hasDrawer && !showAnalysis && (
          <div className={`question-answer-drawer${expanded ? ' open' : ''}`} onClick={closeDrawer}>
            <div className="question-answer-drawer-inner">
              {answer && (
                <div className="question-answer-row">
                  <strong>答案</strong>
                  {renderHtml(answer)}
                </div>
              )}
              {analysis && (
                <div className="question-answer-row">
                  <strong>解析</strong>
                  {renderHtml(analysis)}
                </div>
              )}
            </div>
          </div>
        )}

      </div>

      {showAnalysis && (answer || analysis) && (
        <div className="question-analysis">
          {answer && (
            <span className="question-analysis-answer">
              <strong>答案：</strong>{renderHtml(answer)}
            </span>
          )}
          {analysis && (
            <span>
              <strong>解析：</strong>{renderHtml(analysis)}
            </span>
          )}
        </div>
      )}
    </div>
  );
};

export default QuestionRenderer;
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
  const matches = Array.from(raw.matchAll(/(?:^|\s*)([A-G])[\.\u3001\uff0e\s]+([\s\S]*?)(?=\s*[A-G][\.\u3001\uff0e\s]+|$)/g));
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
  if (options.length < 2) return 1;
  const maxLen = Math.max(...options.map(option => option.content.replace(/<[^>]+>/g, '').length));
  if (maxLen <= 12) return Math.min(options.length, 4);
  if (maxLen <= 28) return 2;
  return 1;
}
