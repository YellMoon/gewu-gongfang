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
      `<span class="omml-frac"><span class="omml-frac-num">${num}</span><span class="omml-frac-den">${den}</span></span>`
    )
  );
}

function normalizeDisplayOperators(value: string): string {
  const tags: string[] = [];
  const text = String(value || '').replace(/<[^>]+>/g, match => {
    const token = `@@HTML_TAG_${tags.length}@@`;
    tags.push(match);
    return token;
  });
  return text
    .replace(/−/g, '－')
    .replace(/-/g, '－')
    .replace(/@@HTML_TAG_(\d+)@@/g, (_match, index) => tags[Number(index)] || '');
}

function cleanLatexInput(latex: string): string {
  return String(latex || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<i>([\s\S]*?)<\/i>/gi, '$1')
    .replace(/<em>([\s\S]*?)<\/em>/gi, '$1')
    .replace(/<strong>([\s\S]*?)<\/strong>/gi, '$1')
    .replace(/<b>([\s\S]*?)<\/b>/gi, '$1')
    .replace(/<sup>([\s\S]*?)<\/sup>/gi, '^{$1}')
    .replace(/<sub>([\s\S]*?)<\/sub>/gi, '_{$1}')
    .replace(/&lt;(\/?)(i|sub|sup|b|strong|em)&gt;/gi, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/−/g, '-')
    .replace(/－/g, '-')
    .replace(/＋/g, '+')
    .replace(/\s+/g, ' ')
    .trim();
}

function renderInlineLatex(latex: string): string {
  const normalizedLatex = cleanLatexInput(latex);
  if (!normalizedLatex) return '';
  try {
    return katex.renderToString(normalizedLatex, createKaTeXPhysicsOptions(false));
  } catch {
    return katex.renderToString(normalizedLatex, {
      displayMode: false,
      throwOnError: false,
      strict: false,
      trust: true,
      macros: {},
    });
  }
}

function legacyLatexPlaceholder(latex: string): string {
  return `<span class="legacy-latex" data-latex="${encodeURIComponent(latex)}"></span>`;
}

function findBalancedGroup(input: string, openIndex: number): { value: string; end: number } | null {
  if (input[openIndex] !== '{') return null;
  let depth = 0;
  for (let i = openIndex; i < input.length; i++) {
    if (input[i] === '{') depth++;
    if (input[i] === '}') {
      depth--;
      if (depth === 0) {
        return { value: input.slice(openIndex + 1, i), end: i + 1 };
      }
    }
  }
  return null;
}

function findBalancedParen(input: string, openIndex: number): { value: string; end: number } | null {
  if (input[openIndex] !== '(') return null;
  let depth = 0;
  for (let i = openIndex; i < input.length; i++) {
    if (input[i] === '(') depth++;
    if (input[i] === ')') {
      depth--;
      if (depth === 0) {
        return { value: input.slice(openIndex + 1, i), end: i + 1 };
      }
    }
  }
  return null;
}

function convertLegacyLatexFragments(content: string): string {
  const source = String(content || '');
  let output = '';
  let i = 0;
  const canStartCommand = (index: number) => index === 0 || !/[A-Za-z0-9_]/.test(source[index - 1]);

  while (i < source.length) {
    const hasDollar = source[i] === '$';
    const commandStart = hasDollar ? i + 1 : i;
    const hasSlash = source[commandStart] === '\\';
    const nameStart = hasSlash ? commandStart + 1 : commandStart;
    const name = source.startsWith('dfrac', nameStart) ? 'dfrac' : source.startsWith('frac', nameStart) ? 'frac' : source.startsWith('sqrt', nameStart) ? 'sqrt' : '';

    if (name && (canStartCommand(commandStart) || (name === 'sqrt' && commandStart > 0 && /\d/.test(source[commandStart - 1])))) {
      const afterName = nameStart + name.length;
      const first = findBalancedGroup(source, afterName);
      if (first) {
        if (name === 'sqrt') {
          const end = source[first.end] === '$' && hasDollar ? first.end + 1 : first.end;
          output += legacyLatexPlaceholder(`\\sqrt{${first.value}}`);
          i = end;
          continue;
        }
        const second = findBalancedGroup(source, first.end);
        if (second) {
          const end = source[second.end] === '$' && hasDollar ? second.end + 1 : second.end;
          output += `<span class="omml-frac"><span class="omml-frac-num">${convertLegacyLatexFragments(first.value)}</span><span class="omml-frac-den">${convertLegacyLatexFragments(second.value)}</span></span>`;
          i = end;
          continue;
        }
      }
      if (name === 'sqrt') {
        const paren = findBalancedParen(source, afterName);
        if (paren) {
          const end = source[paren.end] === '$' && hasDollar ? paren.end + 1 : paren.end;
          output += legacyLatexPlaceholder(`\\sqrt{${paren.value}}`);
          i = end;
          continue;
        }
      }
    }

    output += source[i];
    i++;
  }

  return output;
}

function removeDuplicatedSubQuestionLines(content: string): string {
  const lines = String(content || '').split(/\r?\n/);
  const normalizeLine = (line: string) => line.replace(/<[^>]+>/g, '').replace(/\s+/g, '');
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*\(1\)/.test(lines[i])) continue;
    for (let len = 2; len <= 8 && i + len * 2 <= lines.length; len++) {
      const first = lines.slice(i, i + len).map(normalizeLine);
      const second = lines.slice(i + len, i + len * 2).map(normalizeLine);
      if (first.length > 0 && first.every((line, index) => line && line === second[index])) {
        lines.splice(i + len, len);
        return removeDuplicatedSubQuestionLines(lines.join('\n'));
      }
    }
  }
  return lines.join('\n');
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
  const protectedLegacyLatex: string[] = [];
  const safeHtml = imageSafeHtml.replace(/<span class="legacy-latex" data-latex="[^"]*"><\/span>/gi, match => {
    const token = `@@QUESTION_LEGACY_LATEX_${protectedLegacyLatex.length}@@`;
    protectedLegacyLatex.push(match);
    return token;
  });
  const stripGraphicPathNoise = (value: string) => value
    .replace(/\bM\s*-?\d+(?:\.\d+)?(?:[\s,]*[hlvcsmqtazHLVCSMQTAZ]?-?\d+(?:\.\d+)?){4,}\s*z?\b/g, '')
    .replace(/\b-?\d+(?:\.\d+)?(?:\s*[,，]\s*-?\d+(?:\.\d+)?){5,}\b/g, '')
    .replace(/\b(?:[mMlLhHvVcCsSqQtTaAzZ]\s*-?\d+(?:\.\d+)?(?:\s+|-|,)){4,}[mMlLhHvVcCsSqQtTaAzZ]?\b/g, '')
    .replace(/\b\d+(?:\.\d+)?\s+\d+h\d+v\d+h-\d+z\b/gi, '')
    .replace(/[ \t]{2,}/g, ' ');
  const unitCore = '(?:kg|mol|cd|rad|sr|Hz|Pa|J|Wb|W|C|V|F|T|H|N|A|K|m|s|L|eV|MeV|GeV|min|h|Ω)';
  const unitToken = `(?:[YZEPTGMkhdcmμunpfa]?${unitCore})`;
  const unitExpr = `${unitToken}(?:\\s*(?:[·⋅*/\\\\/]|<sup>-?\\d+</sup>|\\^?-?\\d+)\\s*${unitToken})*`;
  const elementPattern = [
    'Og', 'Ts', 'Lv', 'Mc', 'Fl', 'Nh', 'Cn', 'Rg', 'Ds', 'Mt', 'Hs', 'Bh', 'Sg', 'Db', 'Rf',
    'Ac', 'Ag', 'Al', 'Am', 'Ar', 'As', 'At', 'Au', 'Ba', 'Be', 'Bi', 'Bk', 'Br', 'Ca', 'Cd',
    'Ce', 'Cf', 'Cl', 'Cm', 'Co', 'Cr', 'Cs', 'Cu', 'Dy', 'Er', 'Es', 'Eu', 'Fe', 'Fm', 'Fr',
    'Ga', 'Gd', 'Ge', 'He', 'Hf', 'Hg', 'Ho', 'In', 'Ir', 'Kr', 'La', 'Li', 'Lr', 'Lu', 'Md',
    'Mg', 'Mn', 'Mo', 'Na', 'Nb', 'Nd', 'Ne', 'Ni', 'No', 'Np', 'Os', 'Pa', 'Pb', 'Pd', 'Pm',
    'Po', 'Pr', 'Pt', 'Pu', 'Ra', 'Rb', 'Re', 'Rh', 'Rn', 'Ru', 'Sb', 'Sc', 'Se', 'Si', 'Sm',
    'Sn', 'Sr', 'Ta', 'Tb', 'Tc', 'Te', 'Th', 'Ti', 'Tl', 'Tm', 'Xe', 'Yb', 'Zn', 'Zr',
    'B', 'C', 'F', 'H', 'I', 'K', 'N', 'O', 'P', 'S', 'U', 'V', 'W', 'Y', 'n',
  ].join('|');
  const restoreUnits = (value: string) => value.replace(
    new RegExp(`(\\d(?:[\\d.,×xX+\\-]*\\d)?\\s*)((?:<i>[A-Za-zμΩ]+<\\/i>|[·⋅*/\\\\/\\s]|<sup>-?\\d+<\\/sup>|\\^?-?\\d+)+)(?=\\s|[\\u4e00-\\u9fff]|[,，。；;、）)]|$)`, 'g'),
    (_match, prefix, body) => prefix + body.replace(/<\/?i>/g, '')
  );

  return restoreUnits(stripGraphicPathNoise(safeHtml))
    .replace(/<span class="omml-frac">\s*<span class="omml-frac-num">\s*(m|cm|mm|km)\s*<\/span>\s*<span class="omml-frac-den">\s*(s(?:<sup>2<\/sup>|<sub>2<\/sub>|2)?)\s*<\/span>\s*<\/span>/gi, '$1/$2')
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
    .replace(/<span class="nuclear-left">\s*(<sup>\d+<\/sup>\s*<sub>\d+<\/sub>|<sub>\d+<\/sub>\s*<sup>\d+<\/sup>)\s*<\/span>\s*(?:<i>)?(H|B|K)(?:<\/i>)?(?:\s*(?:<i>)?(e|a|r)(?:<\/i>)?)?/g, '<span class="nuclear-symbol"><span class="nuclear-left">$1</span><span class="nuclear-core">$2$3</span></span>')
    .replace(new RegExp(`<span class="nuclear-left">\\s*(<sup>\\d+<\\/sup>\\s*<sub>\\d+<\\/sub>|<sub>\\d+<\\/sub>\\s*<sup>\\d+<\\/sup>)\\s*<\\/span>\\s*(?:<i>)?(${elementPattern})(?:<\\/i>)?`, 'g'), '<span class="nuclear-symbol"><span class="nuclear-left">$1</span><span class="nuclear-core">$2</span></span>')
    .replace(/<sup>(\d+)<\/sup>\s*<sub>(\d+)<\/sub>\s*<i>(H|B|K)<\/i>\s*(?:<i>)?(e|a|r)(?:<\/i>)?/g, '<span class="nuclear-symbol"><span class="nuclear-left"><sup>$1</sup><sub>$2</sub></span><span class="nuclear-core">$3$4</span></span>')
    .replace(/<sub>(\d+)<\/sub>\s*<sup>(\d+)<\/sup>\s*<i>(H|B|K)<\/i>\s*(?:<i>)?(e|a|r)(?:<\/i>)?/g, '<span class="nuclear-symbol"><span class="nuclear-left"><sup>$2</sup><sub>$1</sub></span><span class="nuclear-core">$3$4</span></span>')
    .replace(new RegExp(`<sup>(\\d+)<\\/sup>\\s*<sub>(\\d+)<\\/sub>\\s*(?:<i>)?(${elementPattern})(?:<\\/i>)?`, 'g'), '<span class="nuclear-symbol"><span class="nuclear-left"><sup>$1</sup><sub>$2</sub></span><span class="nuclear-core">$3</span></span>')
    .replace(new RegExp(`<sub>(\\d+)<\\/sub>\\s*<sup>(\\d+)<\\/sup>\\s*(?:<i>)?(${elementPattern})(?:<\\/i>)?`, 'g'), '<span class="nuclear-symbol"><span class="nuclear-left"><sup>$2</sup><sub>$1</sub></span><span class="nuclear-core">$3</span></span>')
    .replace(new RegExp(`(?<=\\d)\\s*(${unitExpr})`, 'g'), '<span class="physics-unit"> $1</span>')
    .replace(/(?<![A-Za-z])([A-Za-zα-ωΑ-Ω])([0-9]+)(?![0-9A-Za-z]|\.(?:png|jpe?g|gif|webp|svg))/gi, '$1<sub>$2</sub>')
    .replace(/(?<![A-Za-z])(?!H[zZ](?![0-9A-Za-z]))([A-Za-z])([xyzXYZ])(?![0-9A-Za-z])/g, '$1<sub>$2</sub>')
    .replace(/@@QUESTION_LEGACY_LATEX_(\d+)@@/g, (_match, index) => protectedLegacyLatex[Number(index)] || '')
    .replace(/@@QUESTION_IMAGE_(\d+)@@/g, (_match, index) => protectedImages[Number(index)] || '');
}

function processHtmlSegment(html: string): string {
  return normalizeDisplayOperators(normalizePhysicsHtml(html)).replace(/<span class="legacy-latex" data-latex="([^"]*)"><\/span>/g, (_match, latex) => {
    try {
      return renderInlineLatex(decodeURIComponent(latex));
    } catch {
      return renderInlineLatex(latex);
    }
  }).replace(/\$([^$]+?)\$/g, (_match, latex) => {
    const normalizedLatex = cleanLatexInput(latex);
    try {
      return katex.renderToString(normalizedLatex, createKaTeXPhysicsOptions(false));
    } catch {
      return katex.renderToString(normalizedLatex, {
        displayMode: false,
        throwOnError: false,
        strict: false,
        trust: true,
        macros: {},
      });
    }
  });
}

const KaTeXMath: React.FC<{ latex: string; displayMode: boolean }> = ({ latex, displayMode }) => {
  let rendered: string;
  const normalizedLatex = cleanLatexInput(latex);
  try {
    rendered = katex.renderToString(normalizedLatex, createKaTeXPhysicsOptions(displayMode));
  } catch {
    rendered = katex.renderToString(normalizedLatex, {
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
  const normalizedOptions = useMemo(() => normalizeOptions(options || []), [options]);

  const { stemText, stemImages } = useMemo(() => {
    const cleaned = removeOptionImageDuplicates(removeDuplicatedSubQuestionLines(content || ''), normalizedOptions);
    return { stemText: convertLegacyLatexFragments(convertHtmlLatexFractions(cleaned)), stemImages: [] as string[] };
  }, [content, normalizedOptions]);

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
    <span dangerouslySetInnerHTML={{ __html: applySearchHighlight(processHtmlSegment(convertLegacyLatexFragments(convertHtmlLatexFractions(value || ''))), terms) }} />
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
              <div key={`${opt.label}-${i}`} className={`question-option${isImageOnlyOption(opt.content) ? ' image-only' : ''}`}>
                <span className="question-option-label">{opt.label}.</span>
                <span dangerouslySetInnerHTML={{ __html: applySearchHighlight(processHtmlSegment(convertLegacyLatexFragments(convertHtmlLatexFractions(opt.content))), terms) }} />
              </div>
            ))}
          </div>
        )}

        {hasDrawer && !showAnalysis && (
          <div className={`question-answer-drawer${expanded ? ' open' : ''}`} onClick={closeDrawer}>
            {expanded && (
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
              )}
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

export default React.memo(QuestionRenderer);
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

function imageSourcesFromHtml(value: string): string[] {
  return Array.from(String(value || '').matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)).map(match => match[1]);
}

function isImageOnlyOption(value: string): boolean {
  const html = String(value || '').trim();
  if (!/<img\b/i.test(html)) return false;
  return html.replace(/<img\b[^>]*>/gi, '').replace(/<br\s*\/?>/gi, '').replace(/&nbsp;/gi, '').trim() === '';
}

function removeOptionImageDuplicates(content: string, options: Array<{ label: string; content: string }>): string {
  let next = String(content || '');
  const optionSrcs = new Set(options.flatMap(option => imageSourcesFromHtml(option.content)));
  if (optionSrcs.size === 0) return next;
  next = next.replace(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>\s*/gi, (match, src) => optionSrcs.has(src) ? '' : match);
  return next;
}

function columnsForOptions(options: Array<{ label: string; content: string }>): number {
  if (options.length >= 5) return 1;
  if (options.length < 2) return 1;
  if (options.every(option => isImageOnlyOption(option.content))) return Math.min(options.length, 4);
  const maxLen = Math.max(...options.map(option => option.content.replace(/<[^>]+>/g, '').length));
  if (maxLen <= 12) return Math.min(options.length, 4);
  if (maxLen <= 28) return 2;
  return 1;
}
