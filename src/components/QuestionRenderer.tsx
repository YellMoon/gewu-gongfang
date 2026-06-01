import React, { useCallback, useMemo, useState } from 'react';
import katex from 'katex';
import './QuestionRenderer.css';
import {
  createKaTeXPhysicsOptions,
  PHYSICS_KATEX_GLOBAL_MACROS,
  PHYSICS_KATEX_MACROS,
} from '../utils/physicsNotation';
import { sanitizeHtml } from '../utils/sanitizeHtml';
import {
  columnsForOptions,
  imageSourcesFromHtml,
  isImageOnlyOption,
  normalizeOptions,
} from '../utils/questionOptions';

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
    (_match, num, den) => legacyLatexPlaceholder(`\\frac{${num}}{${den}}`)
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
    .replace(/[\u00B7\u22C5]/g, '\\cdot ')
    .replace(/\u00D7/g, '\\times ')
    .replace(/\u0394/g, '\\Delta ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeHtmlEntities(value: string): string {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

function readLatexAttribute(value: string): string {
  const decoded = decodeHtmlEntities(value);
  if (!/%[0-9A-Fa-f]{2}/.test(decoded)) return decoded;
  try {
    return decodeURIComponent(decoded);
  } catch {
    return decoded;
  }
}

function escapeLatexText(value: string): string {
  return decodeHtmlEntities(String(value || '').replace(/<br\s*\/?>/gi, ' '))
    .replace(/\\/g, '\\backslash{}')
    .replace(/([{}_$#%&])/g, '\\$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripSimpleHtml(value: string): string {
  return decodeHtmlEntities(String(value || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim());
}

const CHEMICAL_ELEMENTS = [
  'Og', 'Ts', 'Lv', 'Mc', 'Fl', 'Nh', 'Cn', 'Rg', 'Ds', 'Mt', 'Hs', 'Bh', 'Sg', 'Db', 'Rf',
  'Ac', 'Ag', 'Al', 'Am', 'Ar', 'As', 'At', 'Au', 'Ba', 'Be', 'Bi', 'Bk', 'Br', 'Ca', 'Cd',
  'Ce', 'Cf', 'Cl', 'Cm', 'Co', 'Cr', 'Cs', 'Cu', 'Dy', 'Er', 'Es', 'Eu', 'Fe', 'Fm', 'Fr',
  'Ga', 'Gd', 'Ge', 'He', 'Hf', 'Hg', 'Ho', 'In', 'Ir', 'Kr', 'La', 'Li', 'Lr', 'Lu', 'Md',
  'Mg', 'Mn', 'Mo', 'Na', 'Nb', 'Nd', 'Ne', 'Ni', 'No', 'Np', 'Os', 'Pa', 'Pb', 'Pd', 'Pm',
  'Po', 'Pr', 'Pt', 'Pu', 'Ra', 'Rb', 'Re', 'Rh', 'Rn', 'Ru', 'Sb', 'Sc', 'Se', 'Si', 'Sm',
  'Sn', 'Sr', 'Ta', 'Tb', 'Tc', 'Te', 'Th', 'Ti', 'Tl', 'Tm', 'Xe', 'Yb', 'Zn', 'Zr',
  'B', 'C', 'F', 'H', 'I', 'K', 'N', 'O', 'P', 'S', 'U', 'V', 'W', 'Y', 'n',
];

const CHEMICAL_ELEMENT_PATTERN = CHEMICAL_ELEMENTS.join('|');

function simpleTokenToLatex(value: string): string {
  const raw = String(value || '').trim();
  const plain = stripSimpleHtml(raw);
  if (!plain) return '';
  if (/<(?:i|em)\b/i.test(raw)) return escapeLatexText(plain);
  return `\\mathrm{${escapeLatexText(plain)}}`;
}

function scriptToLatex(value: string): string {
  const raw = String(value || '').trim();
  const plain = stripSimpleHtml(raw);
  if (!plain) return '';
  if (/<(?:i|em)\b/i.test(raw)) return escapeLatexText(plain);
  if (/^\d+$/.test(plain)) return plain;
  return `\\mathrm{${escapeLatexText(plain)}}`;
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
      output: 'html',
      macros: {},
    });
  }
}

function legacyLatexPlaceholder(latex: string): string {
  return `<span class="legacy-latex" data-latex="${encodeURIComponent(latex)}"></span>`;
}

function convertHtmlScriptsToLatex(content: string): string {
  const basePattern = String.raw`(?:<i>[^<]+<\/i>|<em>[^<]+<\/em>|[A-Za-zα-ωΑ-ΩμΩ]+|\d+(?:\.\d+)?|[)\]])`;
  let next = String(content || '');

  next = next
    .replace(
      new RegExp(`<span class="nuclear-symbol">\\s*<span class="nuclear-left">\\s*<sup>([\\s\\S]*?)<\\/sup>\\s*<sub>([\\s\\S]*?)<\\/sub>\\s*<\\/span>\\s*<span class="nuclear-core">\\s*([A-Za-z]{1,2}|n)\\s*<\\/span>\\s*<\\/span>`, 'gi'),
      (_match, mass, charge, element) => legacyLatexPlaceholder(`{}^{${scriptToLatex(mass)}}_{${scriptToLatex(charge)}}\\mathrm{${escapeLatexText(stripSimpleHtml(element))}}`)
    )
    .replace(
      new RegExp(`<sup>(\\d+)<\\/sup>\\s*<sub>(\\d+)<\\/sub>\\s*(?:<i>)?(${CHEMICAL_ELEMENT_PATTERN})(?:<\\/i>)?`, 'g'),
      (_match, mass, charge, element) => legacyLatexPlaceholder(`{}^{${mass}}_{${charge}}\\mathrm{${element}}`)
    )
    .replace(
      new RegExp(`<sub>(\\d+)<\\/sub>\\s*<sup>(\\d+)<\\/sup>\\s*(?:<i>)?(${CHEMICAL_ELEMENT_PATTERN})(?:<\\/i>)?`, 'g'),
      (_match, charge, mass, element) => legacyLatexPlaceholder(`{}^{${mass}}_{${charge}}\\mathrm{${element}}`)
    );

  next = next
    .replace(
      new RegExp(`(${basePattern})\\s*<sub>([\\s\\S]*?)<\\/sub>\\s*<sup>([\\s\\S]*?)<\\/sup>`, 'gi'),
      (_match, base, sub, sup) => legacyLatexPlaceholder(`${simpleTokenToLatex(base)}_{${scriptToLatex(sub)}}^{${scriptToLatex(sup)}}`)
    )
    .replace(
      new RegExp(`(${basePattern})\\s*<sup>([\\s\\S]*?)<\\/sup>\\s*<sub>([\\s\\S]*?)<\\/sub>`, 'gi'),
      (_match, base, sup, sub) => legacyLatexPlaceholder(`${simpleTokenToLatex(base)}_{${scriptToLatex(sub)}}^{${scriptToLatex(sup)}}`)
    )
    .replace(
      new RegExp(`(${basePattern})\\s*<sub>([\\s\\S]*?)<\\/sub>`, 'gi'),
      (_match, base, sub) => legacyLatexPlaceholder(`${simpleTokenToLatex(base)}_{${scriptToLatex(sub)}}`)
    )
    .replace(
      new RegExp(`(${basePattern})\\s*<sup>([\\s\\S]*?)<\\/sup>`, 'gi'),
      (_match, base, sup) => legacyLatexPlaceholder(`${simpleTokenToLatex(base)}^{${scriptToLatex(sup)}}`)
    )
    .replace(/<sub>([\s\S]*?)<\/sub>/gi, (_match, sub) => legacyLatexPlaceholder(`{}_{${scriptToLatex(sub)}}`))
    .replace(/<sup>([\s\S]*?)<\/sup>/gi, (_match, sup) => legacyLatexPlaceholder(`{}^{${scriptToLatex(sup)}}`));

  return next;
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
          output += legacyLatexPlaceholder(`\\frac{${first.value}}{${second.value}}`);
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

function normalizeStemImagePlacement(content: string, hasSeparateOptions: boolean, questionType?: string): string {
  const source = String(content || '');
  if (!/<img\b/i.test(source)) return source;
  const leadingInline = source.match(/^\s*((?:<img\b[^>]*>\s*)+)([\s\S]*)$/i);
  const normalizedSource = leadingInline && leadingInline[2].trim()
    ? `${leadingInline[1].trim()}\n${leadingInline[2].trimStart()}`
    : source;
  const imageLinePattern = /^\s*(?:<img\b[^>]*>\s*)+\s*$/i;
  const lines = normalizedSource.split(/\r?\n/);
  const leadingImages: string[] = [];
  while (lines.length > 0 && imageLinePattern.test(lines[0])) {
    leadingImages.push(lines.shift() || '');
  }
  if (leadingImages.length === 0) return source;

  const subQuestionPattern = /^\s*(?:[\(\uff08]\d+[\)\uff09]|[\u2460-\u2469])/;
  const optionPattern = /^\s*[A-G][\.\uff0e]\s*/i;
  const boundaryIndex = lines.findIndex(line => (
    subQuestionPattern.test(line) ||
    optionPattern.test(line) ||
    /<div class="question-options\b/i.test(line)
  ));
  const insertIndex = boundaryIndex === 0 ? 1 : boundaryIndex >= 0 ? boundaryIndex : Math.min(lines.length, 1);
  lines.splice(insertIndex, 0, ...leadingImages);
  return lines.join('\n').trim();
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
  return stripGraphicPathNoise(safeHtml)
    .replace(/<span class="omml-frac">\s*<span class="omml-frac-num">\s*(m|cm|mm|km)\s*<\/span>\s*<span class="omml-frac-den">\s*(s(?:<sup>2<\/sup>|<sub>2<\/sub>|2)?)\s*<\/span>\s*<\/span>/gi, '$1/$2')
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
    .replace(new RegExp(`<span class="nuclear-left">\\s*(<sup>\\d+<\\/sup>\\s*<sub>\\d+<\\/sub>|<sub>\\d+<\\/sub>\\s*<sup>\\d+<\\/sup>)\\s*<\\/span>\\s*(?:<i>)?(${CHEMICAL_ELEMENT_PATTERN})(?:<\\/i>)?`, 'g'), '<span class="nuclear-symbol"><span class="nuclear-left">$1</span><span class="nuclear-core">$2</span></span>')
    .replace(/<sup>(\d+)<\/sup>\s*<sub>(\d+)<\/sub>\s*<i>(H|B|K)<\/i>\s*(?:<i>)?(e|a|r)(?:<\/i>)?/g, '<span class="nuclear-symbol"><span class="nuclear-left"><sup>$1</sup><sub>$2</sub></span><span class="nuclear-core">$3$4</span></span>')
    .replace(/<sub>(\d+)<\/sub>\s*<sup>(\d+)<\/sup>\s*<i>(H|B|K)<\/i>\s*(?:<i>)?(e|a|r)(?:<\/i>)?/g, '<span class="nuclear-symbol"><span class="nuclear-left"><sup>$2</sup><sub>$1</sub></span><span class="nuclear-core">$3$4</span></span>')
    .replace(new RegExp(`<sup>(\\d+)<\\/sup>\\s*<sub>(\\d+)<\\/sub>\\s*(?:<i>)?(${CHEMICAL_ELEMENT_PATTERN})(?:<\\/i>)?`, 'g'), '<span class="nuclear-symbol"><span class="nuclear-left"><sup>$1</sup><sub>$2</sub></span><span class="nuclear-core">$3</span></span>')
    .replace(new RegExp(`<sub>(\\d+)<\\/sub>\\s*<sup>(\\d+)<\\/sup>\\s*(?:<i>)?(${CHEMICAL_ELEMENT_PATTERN})(?:<\\/i>)?`, 'g'), '<span class="nuclear-symbol"><span class="nuclear-left"><sup>$2</sup><sub>$1</sub></span><span class="nuclear-core">$3</span></span>')
    .replace(new RegExp(`(?<=\\d)\\s*(${unitExpr})`, 'g'), '<span class="physics-unit"> $1</span>')
    .replace(/@@QUESTION_LEGACY_LATEX_(\d+)@@/g, (_match, index) => protectedLegacyLatex[Number(index)] || '')
    .replace(/@@QUESTION_IMAGE_(\d+)@@/g, (_match, index) => protectedImages[Number(index)] || '');
}

function processHtmlSegment(html: string): string {
  return normalizeDisplayOperators(convertHtmlScriptsToLatex(normalizePhysicsHtml(html))).replace(/<span class="legacy-latex" data-latex="([^"]*)"><\/span>/g, (_match, latex) => {
    return renderInlineLatex(readLatexAttribute(latex));
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
        output: 'html',
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
      output: 'html',
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
    const deduped = removeOptionImageDuplicates(removeDuplicatedSubQuestionLines(content || ''), normalizedOptions);
    const cleaned = normalizeStemImagePlacement(deduped, normalizedOptions.length > 0, questionType);
    return { stemText: convertLegacyLatexFragments(convertHtmlLatexFractions(cleaned)), stemImages: [] as string[] };
  }, [content, normalizedOptions]);

  const stemWithInlineOptionGrids = useMemo(() => formatInlineOptionsInPlace(stemText), [stemText]);

  const segments = useMemo(() => splitMixedContent(stemWithInlineOptionGrids), [stemWithInlineOptionGrids]);

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
    const processed = sanitizeHtml(applySearchHighlight(processHtmlSegment(seg.value), terms));
    const hasBlockHtml = /<(?:div|table|img)\b/i.test(processed);
    const Tag = hasBlockHtml ? 'div' : 'span';
    return <Tag key={idx} dangerouslySetInnerHTML={{ __html: processed }} />;
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
    <span dangerouslySetInnerHTML={{ __html: sanitizeHtml(applySearchHighlight(processHtmlSegment(convertLegacyLatexFragments(convertHtmlLatexFractions(value || ''))), terms)) }} />
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

        {optCount > 0 && (
          <div className={`question-options cols-${optCols}`}>
            {normalizedOptions.map((opt, i) => (
              <div key={`${opt.label}-${i}`} className={`question-option${isImageOnlyOption(opt.content) ? ' image-only' : ''}`}>
                <span className="question-option-label">{opt.label}.</span>
                <span dangerouslySetInnerHTML={{ __html: sanitizeHtml(applySearchHighlight(processHtmlSegment(convertLegacyLatexFragments(convertHtmlLatexFractions(opt.content))), terms)) }} />
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

function removeOptionImageDuplicates(content: string, options: Array<{ label: string; content: string }>): string {
  let next = String(content || '');
  const optionSrcs = new Set(options.flatMap(option => imageSourcesFromHtml(option.content)));
  if (optionSrcs.size === 0) return next;
  next = next.replace(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>\s*/gi, (match, src) => optionSrcs.has(src) ? '' : match);
  return next;
}

function formatOptionGrid(options: Array<{ label: string; content: string }>): string {
  const columns = columnsForOptions(options);
  const rows = options.map((option, index) => (
    `<div class="question-option${isImageOnlyOption(option.content) ? ' image-only' : ''}">` +
    `<span class="question-option-label">${option.label}.</span>` +
    `<span>${option.content}</span>` +
    `</div>`
  )).join('');
  return `<div class="question-options cols-${columns}" data-inline-options="true">${rows}</div>`;
}

function formatInlineOptionsInPlace(content: string): string {
  return String(content || '').replace(/((?:^|[\n\t\f])\s*[A-G][\.\uff0e][\s\S]*?)(?=[\n\t\f]\s*(?:[\(\uff08]\d+[\)\uff09]|[\u2460-\u2469]|\d+[\.\u3001\uff0e])|$)/g, (block) => {
    const normalized = block.replace(/\n+/g, '\n').trim();
    const labels = Array.from(normalized.matchAll(/(^|[\r\n\t\f])\s*([A-G])[\.\uff0e]\s*/g)).map(match => ({
      label: match[2].toUpperCase(),
      start: (match.index || 0) + (match[1] || '').length,
      contentStart: (match.index || 0) + match[0].length,
    }));
    if (labels.length < 2) return block;
    const options = labels.map((label, index) => {
      const nextLabel = labels[index + 1];
      const value = normalized.slice(label.contentStart, nextLabel?.start ?? normalized.length).trim();
      return { label: label.label, content: value };
    }).filter(option => option.content);
    return options.length >= 2 ? `\n${formatOptionGrid(options)}\n` : block;
  });
}
