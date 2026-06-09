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
  const cleaned = decodeHtmlEntities(String(latex || ''))
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
    .replace(/[\u00B7\u22C5]/g, '\\cdot')
    .replace(/\u00D7/g, '\\times')
    .replace(/\u0394/g, '\\Delta')
    .replace(/["']?\s*>\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return balanceLatexBraces(normalizeLooseLatex(cleaned));
}

function normalizeLooseLatex(latex: string): string {
  const greekCommandMap: Record<string, string> = {
    π: '\\pi',
    β: '\\beta',
    μ: '\\mu',
    ω: '\\omega',
    θ: '\\theta',
  };
  return String(latex || '')
    .replace(/&amp;(#x?[0-9a-fA-F]+;)/g, '&$1')
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (_match, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&apos;/g, "'")
    .replace(/\^\{\s*['’′]\s*\}/g, "'")
    .replace(/([A-Za-z])'(_\{[^}]+\})\^\{([^}]+)\}/g, "{$1'$2}^{$3}")
    .replace(/\\mathrm\{([πβμωθ])\}/g, (_match, letter) => greekCommandMap[letter] || letter)
    .replace(/\\mathrm\{arctan\}/g, '\\arctan')
    .replace(/\\mathrm\{%\}/g, '\\%')
    .replace(/\\mathrm\{_\}/g, '\\_')
    .replace(/\\mathrm\{_{2,}\}/g, '\\underline{\\qquad}')
    .replace(/\\mathrm\{\s*\\([A-Za-z]+)\s*\}/g, '\\$1')
    .replace(/\\(cdot|times|Delta|theta|omega|mu|pi|alpha|beta|gamma|lambda)(?=[A-Za-zα-ωΑ-Ω])/g, '\\$1 ')
    .replace(/\\([A-Za-z]+)(?=[\u4e00-\u9fff])/g, '\\$1 ');
}

function hasBalancedLatexBraces(latex: string): boolean {
  let depth = 0;
  for (const char of String(latex || '')) {
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

function balanceLatexBraces(latex: string): string {
  let depth = 0;
  let next = '';
  for (const char of String(latex || '')) {
    if (char === '{') depth += 1;
    if (char === '}') {
      if (depth === 0) continue;
      depth -= 1;
    }
    next += char;
  }
  return depth > 0 ? `${next}${'}'.repeat(depth)}` : next;
}

function decodeHtmlEntities(value: string): string {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, dec) => String.fromCodePoint(parseInt(dec, 10)))
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

function escapeHtmlText(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

// ============================================================================
// 完整单位库 & 正斜体判断核心逻辑
// ============================================================================
//
// 设计原则：
//   1. 单位库优先：先查预构建的单位库（覆盖所有 SI 前缀组合），匹配到即强制正体
//   2. 上下文启发：对单字母 token，分析前后文证据（数字、运算符、斜杠等）
//   3. Word 信号兜底：无强证据时，Word 的格式化作为有用信号（大概率正确）
//
// 判断层级：
//   Layer 1: 单位库匹配 → 强制正体（覆盖 Word 的错误标记）
//   Layer 2: 化学元素（多字母）→ 强制正体
//   Layer 3: 单字母 token → 上下文综合判断（见下方详细规则）
//   Layer 4: 默认 → 斜体（数学惯例：变量用斜体）
//
// Layer 3 详细规则（单字母 token 的上下文判断）：
//   上下文证据类型：
//     A. 前方信号：前一个 token 是数字/已知单位 → 强烈暗示当前是单位
//     B. 后方信号：后一个 token 是 "/" → 强烈暗示当前是单位
//     C. 前方信号：前一个 token 是运算符 → 暗示当前是变量
//     D. 后方信号：后一个 token 是 "=" → 暗示当前是变量
//     E. Word 的格式化标签（<i> 或无标签）
//
//   判断流程：
//     if 强上下文暗示单位 (A or B) → 强制正体
//     elif 强上下文暗示变量 (C or D) → 强制斜体
//     elif Word 标记了 <i> → 斜体（无反证，Word 信号有效）
//     else → 正体（默认）
// ============================================================================

// ---- SI 前缀 ----
const SI_PREFIXES = ['Y', 'Z', 'E', 'P', 'T', 'G', 'M', 'k', 'h', 'da', 'd', 'c', 'm', 'μ', 'u', 'n', 'p', 'f', 'a', 'z', 'y'];

// ---- SI 基本单位 ----
const SI_BASE_UNITS = ['m', 's', 'kg', 'A', 'K', 'mol', 'cd'];

// ---- SI 导出单位（可加前缀的）----
const SI_DERIVED_UNITS = ['Hz', 'N', 'Pa', 'J', 'W', 'C', 'V', 'F', 'Ω', 'S', 'H', 'T', 'Wb', 'lm', 'lx', 'Bq', 'Gy', 'Sv', 'kat'];

// ---- 不可加前缀的单位 ----
const NON_PREFIXED_UNITS = [
  '°', '°C', '°F', '%', '°R',
  'eV', 'keV', 'MeV', 'GeV', 'TeV', 'PeV',
  'L', 'mL', 'μL',
  'min', 'h', 'd', 'au', 'ly',
  'u', 'Da', 'Np', 'B', 'dB',
  'r', 'gon',
];

// ---- 常用组合单位（前缀加在整个单位前，多为 dot 连接以保持为单 token）----
// 注意：含 "/" 的组合单位（如 V/m, N/C）在 HTML 中会被拆分为多个 token，
// 不会作为整体出现在单位库中，需要通过上下文启发式判断。
const COMPOUND_UNITS = [
  // === 力学 ===
  'N·m', 'N·s', 'N/m',
  'kg·m/s²', 'kg·m²/s²', 'kg·m²', 'kg/m³', 'kg/m²', 'kg/(m·s²)',
  'm/s', 'm/s²', 'm²/s', 'm³/s', 'm²/s²', 'm³/s²', 'm⁴/s',
  'Pa·s', 'Pa·m', 'Pa/m', 'Pa·m²',
  // === 电磁学 ===
  'V·s', 'V/m', 'V²',
  'A·s', 'A·m', 'A/m', 'A/m²', 'A·m²',
  'C·m', 'C/m', 'C/m²', 'C/m³', 'C²',
  'F/m', 'F·m',
  'H/m', 'H·m',
  'Ω·m', 'Ω/m', 'Ω·m²',
  'S/m', 'S·m',
  'Wb/m', 'Wb·m',
  'T·m', 'T·m²', 'T/m',
  'J·m', 'J/m³', 'J/m²', 'J·m²',
  'W·m', 'W/m²', 'W/m³',
  // === 热学 ===
  'W/(m·K)', 'J/(kg·K)', 'J/(kg·m²)', 'K/m', 'K·m²/W',
  'J/K', 'J/(mol·K)', 'J/mol',
  'Pa/K', 'm²/(V·s)',
  // === 光学 ===
  'cd/m²', 'lm·s', 'lx·s', 'lx/m', 'cd·sr',
  // === 流体力学 ===
  'Pa·s/m', 'm²/s³',
  // === 原子/核物理 ===
  'kg/mol', 'eV/atom', 'eV·m', 'J·s',
  // === 通用导出 ===
  'kg·m', 'kg/s', 'kg/s²', 'kg·m/s',
  'm·K', 'mol/m³', 'mol/(m²·s)',
];

// ---- 数学函数（永远正体）----
const MATH_FUNCTIONS = new Set([
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc',
  'arcsin', 'arccos', 'arctan', 'arccot', 'arcsec', 'arccsc',
  'sinh', 'cosh', 'tanh', 'coth',
  'arsinh', 'arcosh', 'artanh', 'arcoth',
  'log', 'ln', 'lg', 'exp',
  'max', 'min', 'sup', 'inf', 'lim',
  'det', 'dim', 'gcd', 'ker', 'hom',
]);

// ---- 描述性缩写（永远正体）----
const DESCRIPTIVE_ABBREVS = new Set([
  'avg', 'rms', 'eff', 'tot', 'ext', 'int', 'rev', 'abs', 'rel', 'sat',
  'std', 'STP', 'NTP', 'eq', 'fig', 'ref', 'ch', 'sec', 'vol', 'ed',
]);

// ---- 生成完整单位库 ----
// 核心原则：只收录**无歧义**的多字母单位（如 MeV, km, MHz, sin, log）。
// 单字母单位（m, s, T, V 等）不收录——它们既可能是单位也可能是物理量，
// 需要通过上下文启发式来判断（见 simpleTokenToLatex 的 Layer 3）。
function buildUnitLibrary(): Set<string> {
  const units = new Set<string>();

  // 1. 不可加前缀的单位（多字母的直接加入，单字母的不加入）
  for (const u of NON_PREFIXED_UNITS) {
    if (u.length > 1) units.add(u); // eV, MeV, min, h, ...
  }

  // 2. SI 基本单位（只加入多字母的：kg, mol, cd）
  // 单字母基本单位（m, s, A, K）不加入——需要上下文判断
  for (const base of SI_BASE_UNITS) {
    if (base.length > 1) {
      units.add(base); // kg, mol, cd
    }
    if (base !== 'kg') {
      for (const prefix of SI_PREFIXES) {
        units.add(prefix + base); // km, mm, cm, μm, nm, ... (都是多字母)
      }
    }
  }

  // 3. SI 导出单位
  // 多字母导出单位（Hz, Pa, Wb, lm, lx, Bq, Gy, Sv, kat）直接加入
  // 单字母导出单位（N, V, F, T, ...）不加入——需要上下文判断
  // 加前缀后都是多字母，可以直接加入
  for (const derived of SI_DERIVED_UNITS) {
    if (derived.length > 1) {
      units.add(derived); // Hz, Pa, Wb, lm, lx, Bq, Gy, Sv, kat
    }
    for (const prefix of SI_PREFIXES) {
      units.add(prefix + derived); // kHz, MPa, GW, mV, μT, ... (都是多字母)
    }
  }

  // 4. 组合单位（前缀加在整个单位前）
  for (const compound of COMPOUND_UNITS) {
    units.add(compound);
    for (const prefix of SI_PREFIXES) {
      units.add(prefix + compound);
    }
  }

  // 5. 数学函数
  for (const fn of MATH_FUNCTIONS) units.add(fn);

  // 6. 描述性缩写
  for (const abbr of DESCRIPTIVE_ABBREVS) units.add(abbr);

  return units;
}

const UNIT_LIBRARY = buildUnitLibrary();

function simpleTokenToLatex(value: string, prev = '', next = ''): string {
  const raw = String(value || '').trim();
  const plain = stripSimpleHtml(raw);
  if (!plain) return '';

  // Layer 1: 单位库匹配 → 强制正体（覆盖 Word 的错误标记）
  // 单位库包含所有 SI 前缀组合（km, mm, MHz, GPa, ...）、数学函数、描述性缩写
  if (UNIT_LIBRARY.has(plain)) return `\\mathrm{${escapeLatexText(plain)}}`;

  // Layer 2: 化学元素（多字母）→ 强制正体
  if (plain.length > 1 && CHEMICAL_ELEMENTS.includes(plain)) return `\\mathrm{${escapeLatexText(plain)}}`;

  // Layer 3: 单字母 token → 上下文综合判断
  if (plain.length === 1) {
    const hasItalicTag = /<(?:i|em)\b/i.test(raw);

    // --- 上下文证据收集 ---
    // 前方信号
    const prevIsDigit = /^\d/.test(prev);                                // 5 m → m 是单位
    const prevIsKnownUnit = /^[a-zA-ZΩμ°%]$/.test(prev);                // kg·m → m 是单位
    const prevIsDigitOrUnit = prevIsDigit || prevIsKnownUnit;
    // 分数中的单位：5m/ 或 kg/ 或 eV/ 或 MeV/ → 后面的 token 是单位
    // 匹配：数字+字母+/, 或多字母单位+/, 或单字母单位+/
    const prevIsUnitFraction = /(?:\d[a-zA-Z0-9]*|[a-zA-ZΩμ°%]{2,}|[VsATNFHWCK])\//.test(prev);
    // 斜杠前是已知单位库中的单位 → 斜杠后的 token 也是单位
    const prevEndsAfterKnownUnit = /\/$/.test(prev) && UNIT_LIBRARY.has(prev.replace(/\/$/, ''));
    // 后方信号
    const nextIsChinese = /^[\u4e00-\u9fa5]/.test(next);                 // m/秒 → m 是单位
    const nextIsEquals = /^[=]/.test(next);                               // F=ma → F 是变量
    const nextIsOperator = /^[+\-×÷·<>≤≥≠^_]/.test(next);               // a+b → a 是变量

    // --- 综合判断 ---
    // 强上下文暗示单位：前置数字/已知单位，或前置斜杠（斜杠前是单位），或后置中文
    // 注意：不使用 nextIsSlash——它会错误地将 s/t 中的 s 当作单位
    // 分数中的单位识别完全依赖 prev 上下文（prevIsDigit, prevIsUnitFraction, prevEndsAfterKnownUnit）
    const strongRomanContext =
      prevIsDigitOrUnit || prevIsUnitFraction || prevEndsAfterKnownUnit ||
      nextIsChinese;

    // 强上下文暗示变量：前置运算符（=, +, -, × 等），或后置等号/运算符
    const prevEndsWithNonSlashOp = /[+\-×÷·=<>≤≥≠]$/.test(prev);
    const strongItalicContext =
      prevEndsWithNonSlashOp || nextIsEquals || nextIsOperator;

    if (strongRomanContext) {
      // 上下文证据强 → 覆盖 Word 的格式化
      return `\\mathrm{${escapeLatexText(plain)}}`;
    }
    if (strongItalicContext) {
      // 上下文证据强 → 覆盖 Word 的格式化
      return escapeLatexText(plain);
    }

    // 无强上下文证据 → Word 的格式化是有用信号（大概率正确）
    if (hasItalicTag) return escapeLatexText(plain);      // Word 说是斜体，无反证 → 斜体
    return `\\mathrm{${escapeLatexText(plain)}}`;          // Word 说是正体或无标记 → 正体
  }

  // Layer 5: 默认 → 斜体（数学惯例：变量用斜体）
  return escapeLatexText(plain);
}

function scriptToLatex(value: string): string {
  const raw = String(value || '').trim();
  const plain = stripSimpleHtml(raw);
  if (!plain) return '';

  // 数字始终是 plain
  if (/^\d+$/.test(plain)) return plain;

  // 单位库匹配 → 强制正体
  if (UNIT_LIBRARY.has(plain)) return `\\mathrm{${escapeLatexText(plain)}}`;
  // 化学元素 → 强制正体
  if (plain.length > 1 && CHEMICAL_ELEMENTS.includes(plain)) return `\\mathrm{${escapeLatexText(plain)}}`;

  // 下标中的 Word 格式化 → 作为有用信号（大概率正确），无强上下文可参考
  if (/<(?:i|em)\b/i.test(raw)) return escapeLatexText(plain);

  // 默认 → 正体（下标中的字母通常是单位或描述性文字）
  return `\\mathrm{${escapeLatexText(plain)}}`;

  // 默认 → 斜体
  return escapeLatexText(plain);
}

function renderInlineLatex(latex: string): string {
  const normalizedLatex = cleanLatexInput(latex);
  if (!normalizedLatex) return '';
  try {
    return katex.renderToString(normalizedLatex, {
      ...createKaTeXPhysicsOptions(false),
      throwOnError: true,
      trust: false,
      output: 'html',
    });
  } catch {
    return `<span class="latex-fallback">${escapeHtmlText(normalizedLatex)}</span>`;
  }
}

function renderLatex(latex: string, displayMode: boolean): string {
  const normalizedLatex = cleanLatexInput(latex);
  if (!normalizedLatex) return '';
  try {
    return katex.renderToString(normalizedLatex, {
      ...createKaTeXPhysicsOptions(displayMode),
      displayMode,
      throwOnError: true,
      trust: false,
      output: 'html',
    });
  } catch {
    return `<span class="latex-fallback">${escapeHtmlText(normalizedLatex)}</span>`;
  }
}

function convertBareLatexRuns(html: string): string {
  const protectedParts: string[] = [];
  const protect = (value: string) => {
    const token = `@@QUESTION_PROTECTED_${protectedParts.length}@@`;
    protectedParts.push(value);
    return token;
  };
  const source = String(html || '')
    .replace(/<img\b[^>]*>/gi, protect)
    .replace(/<span\b[^>]*class=["'][^"']*katex[\s\S]*?<\/span>/gi, protect)
    .replace(/<span\b[^>]*class=["'][^"']*latex-fallback[^"']*["'][\s\S]*?<\/span>/gi, protect)
    .replace(/<[^>]+>/g, protect);
  const converted = source.replace(/[A-Za-z0-9α-ωΑ-Ω\\{}_^+\-=－＋()\/.,·×\s]+/g, match => {
    const text = decodeHtmlEntities(match).trim();
    if (!text || !/(\\[A-Za-z]+|[_^]\{|[{}])/.test(text)) return match;
    if (text.length < 3 || !/[A-Za-z0-9]/.test(text)) return match;
    return renderInlineLatex(text);
  });
  return converted.replace(/@@QUESTION_PROTECTED_(\d+)@@/g, (_match, index) => protectedParts[Number(index)] || '');
}

function collapseExcessBreaks(html: string): string {
  return String(html || '')
    .replace(/(?:<br\s*\/?>\s*){3,}/gi, '<br /><br />')
    .replace(/(?:<br\s*\/?>\s*){2,}(?=\s*(?:<span[^>]*>\s*)?[\(\uff08]\d+[\)\uff09])/gi, '<br />')
    .replace(/(?:<br\s*\/?>\s*){2,}(?=\s*[\u2460-\u2469])/gi, '<br />');
}

function replaceDollarLatex(html: string): string {
  return String(html || '').replace(/\$([^$]+?)\$/g, (_match, latex) => renderInlineLatex(latex));
}

function processHtmlSegment(html: string): string {
  const normalized = normalizeDisplayOperators(convertHtmlScriptsToLatex(normalizePhysicsHtml(html).replace(/##+/g, '、')));
  const legacyRendered = normalized.replace(/<span class="legacy-latex" data-latex="([^"]*)"><\/span>/g, (_match, latex) => {
    return renderInlineLatex(readLatexAttribute(latex));
  });
  return collapseExcessBreaks(convertBareLatexRuns(replaceDollarLatex(legacyRendered)).replace(/\\(?=<span class="katex")/g, ''));
}

const KaTeXMath: React.FC<{ latex: string; displayMode: boolean }> = ({ latex, displayMode }) => {
  const rendered = renderLatex(latex, displayMode);
  if (displayMode) {
    return <div className="math-display" dangerouslySetInnerHTML={{ __html: rendered }} />;
  }
  return <span className="math-inline" dangerouslySetInnerHTML={{ __html: rendered }} />;
};

function legacyLatexPlaceholder(latex: string): string {
  return `<span class="legacy-latex" data-latex="${encodeURIComponent(latex)}"></span>`;
}

function convertHtmlScriptsToLatex(content: string): string {
  const basePattern = String.raw`(?:<i>[^<]+<\/i>|<em>[^<]+<\/em>|[A-Za-zα-ωΑ-ΩμΩ]+|\d+(?:\.\d+)?|[)\]])`;
  let next = String(content || '');

  // --- 子题标签保护：防止 (1)(2)(3) 被错误渲染为斜体 ---
  // Word 中的子题标签可能被标记为斜体（<i>(1)</i>），需要在处理前保护它们，
  // 并统一规范化为半角括号格式。
  // 保护被 <i> 包裹的子题标签（半角和全角括号）
  next = next.replace(
    /<i>\s*([\(\uff08]\s*\d+\s*[\)\uff09])\s*<\/i>/gi,
    (_match, label: string) => {
      const num = label.replace(/[^\d]/g, '');
      return `@@SUB_LABEL_${num}@@`;
    }
  );
  // 保护被 <i> 包裹的带圈数字子题标签
  next = next.replace(
    /<i>\s*([\u2460-\u2469])\s*<\/i>/gi,
    (_match, circled: string) => {
      const code = circled.charCodeAt(0);
      const num = code - 0x2460 + 1;
      return `@@SUB_LABEL_${num}@@`;
    }
  );
  // 安全网：处理未被 <i> 包裹的全角括号子题标签
  next = next.replace(
    /[\uff08]\s*(\d+)\s*[\uff09]/g,
    (_match, num: string) => `@@SUB_LABEL_${num}@@`
  );

  // --- 上下文提取：扫描 HTML，构建每个 token 的前后文本上下文 ---
  // 用于 simpleTokenToLatex 的上下文判断（如 "5 m/s" 中 m 的前方是数字 "5"）
  // 注意：不能用 Map，因为同一个文本可能多次出现（如 m 在 "5m" 和 "m·t" 中），
  // 需要为每次出现保存独立的上下文。
  const tokenContextArray: Array<{ text: string; prev: string; next: string }> = [];
  {
    const tagPattern = /<i>([^<]+)<\/i>|<em>([^<]+)<\/em>|<sub>[\s\S]*?<\/sub>|<sup>[\s\S]*?<\/sup>|<span[^>]*>[\s\S]*?<\/span>|<br\s*\/?>/gi;
    const tokens: Array<{ text: string; gapBefore: string }> = [];
    let m: RegExpExecArray | null;
    let lastEnd = 0;
    while ((m = tagPattern.exec(next)) !== null) {
      const gap = stripSimpleHtml(next.slice(lastEnd, m.index));
      const text = m[1] || m[2] || '';
      if (text) {
        tokens.push({ text, gapBefore: gap });
      }
      lastEnd = m.index + m[0].length;
    }
    for (let i = 0; i < tokens.length; i++) {
      const prevText = i > 0 ? tokens[i - 1].text.slice(-3) : '';
      const prevGap = i > 0 ? tokens[i].gapBefore : '';
      const nextText = i < tokens.length - 1 ? tokens[i + 1].text.slice(0, 3) : '';
      const nextGap = i < tokens.length - 1 ? tokens[i + 1].gapBefore : '';
      tokenContextArray.push({
        text: tokens[i].text,
        prev: prevText + prevGap,
        next: nextGap + nextText,
      });
    }
  }
  // --- 结束上下文提取 ---

  // 构建按文本分组的上下文队列（处理重复 token，如多个 "m"）
  const contextQueues = new Map<string, Array<{ prev: string; next: string }>>();
  for (const entry of tokenContextArray) {
    const q = contextQueues.get(entry.text) || [];
    q.push({ prev: entry.prev, next: entry.next });
    contextQueues.set(entry.text, q);
  }
  const popContext = (text: string) => {
    const q = contextQueues.get(text);
    if (q && q.length > 0) return q.shift()!;
    return { prev: '', next: '' };
  };

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
      (_match, base, sub, sup) => {
        const ctx = popContext(stripSimpleHtml(base));
        return legacyLatexPlaceholder(`${simpleTokenToLatex(base, ctx.prev, ctx.next)}_{${scriptToLatex(sub)}}^{${scriptToLatex(sup)}}`);
      }
    )
    .replace(
      new RegExp(`(${basePattern})\\s*<sup>([\\s\\S]*?)<\\/sup>\\s*<sub>([\\s\\S]*?)<\\/sub>`, 'gi'),
      (_match, base, sup, sub) => {
        const ctx = popContext(stripSimpleHtml(base));
        return legacyLatexPlaceholder(`${simpleTokenToLatex(base, ctx.prev, ctx.next)}_{${scriptToLatex(sub)}}^{${scriptToLatex(sup)}}`);
      }
    )
    .replace(
      new RegExp(`(${basePattern})\\s*<sub>([\\s\\S]*?)<\\/sub>`, 'gi'),
      (_match, base, sub) => {
        const ctx = popContext(stripSimpleHtml(base));
        return legacyLatexPlaceholder(`${simpleTokenToLatex(base, ctx.prev, ctx.next)}_{${scriptToLatex(sub)}}`);
      }
    )
    .replace(
      new RegExp(`(${basePattern})\\s*<sup>([\\s\\S]*?)<\\/sup>`, 'gi'),
      (_match, base, sup) => {
        const ctx = popContext(stripSimpleHtml(base));
        return legacyLatexPlaceholder(`${simpleTokenToLatex(base, ctx.prev, ctx.next)}^{${scriptToLatex(sup)}}`);
      }
    )
    .replace(/<sub>([\s\S]*?)<\/sub>/gi, (_match, sub) => legacyLatexPlaceholder(`{}_{${scriptToLatex(sub)}}`))
    .replace(/<sup>([\s\S]*?)<\/sup>/gi, (_match, sup) => legacyLatexPlaceholder(`{}^{${scriptToLatex(sup)}}`));

  // --- 恢复子题标签占位符 ---
  // 统一渲染为半角括号 + 正体，确保 (1)(2)(3) 左对齐且不被斜体化
  next = next.replace(/@@SUB_LABEL_(\d+)@@/g, (_match, num: string) => {
    return `<span style="font-style:normal">(${num})</span>`;
  });

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
  const protectedLegacyLatex: string[] = [];
  const source = String(content || '').replace(/<span class="legacy-latex" data-latex="[^"]*"><\/span>/gi, match => {
    const token = `@@QUESTION_EXISTING_LEGACY_LATEX_${protectedLegacyLatex.length}@@`;
    protectedLegacyLatex.push(match);
    return token;
  });
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

  return output.replace(/@@QUESTION_EXISTING_LEGACY_LATEX_(\d+)@@/g, (_match, index) => protectedLegacyLatex[Number(index)] || '');
}

function removeDuplicatedSubQuestionLines(content: string): string {
  const lines = String(content || '').split(/\r?\n/);
  const normalizeLine = (line: string) => line.replace(/<[^>]+>/g, '').replace(/\s+/g, '');
  // 同时检测半角 (1) 和全角 （1）（带圈数字 ① 是更低一级编号，不参与重复检测）
  const subLabelPattern = /^\s*[\(\uff08]1[\)\uff09]/;
  for (let i = 0; i < lines.length; i++) {
    if (!subLabelPattern.test(lines[i])) continue;
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

/** 统一子题标签格式：全角括号→半角，多余空白→单空格，带圈数字→(N) */
function normalizeSubQuestionLabels(content: string): string {
  let result = String(content || '');
  // 全角括号 → 半角括号（带或不带 <i> 标签）
  result = result.replace(/<i>\s*[\uff08]\s*(\d+)\s*[\uff09]\s*<\/i>/gi, '<i>($1)</i>');
  result = result.replace(/[\uff08]\s*(\d+)\s*[\uff09]/g, '($1)');
  // 注意：带圈数字 ①②③ 保持原样，不转换——它们是比括号数字更低一级的编号
  // 规范化括号后多余空白：( 1 ) → (1)，（ 1 ）→ (1)
  result = result.replace(/\(\s*(\d+)\s*\)/g, '($1)');
  return result;
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
    // Repair fragmented units: <i>k</i><i>g</i> → kg
    .replace(/<i>k<\/i>\s*<i>g<\/i>/gi, 'kg')
    .replace(/<i>m<\/i>\s*<i>o<\/i>\s*<i>l<\/i>/gi, 'mol')
    .replace(/<i>c<\/i>\s*<i>d<\/i>/gi, 'cd')
    .replace(/<i>r<\/i>\s*<i>a<\/i>\s*<i>d<\/i>/gi, 'rad')
    .replace(/<i>s<\/i>\s*<i>r<\/i>/gi, 'sr')
    .replace(/<i>H<\/i>\s*<i>z<\/i>/gi, 'Hz')
    .replace(/<i>P<\/i>\s*<i>a<\/i>/gi, 'Pa')
    .replace(/<i>W<\/i>\s*<i>b<\/i>/gi, 'Wb')
    // Merge adjacent italic unit letters: <i>N</i><i>m</i> → Nm
    .replace(/(<\/i>)\s*(<i>)/g, (_, close, open) => close + open)
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
    const normalized = normalizeSubQuestionLabels(deduped);
    const cleaned = normalizeStemImagePlacement(normalized, normalizedOptions.length > 0, questionType);
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
    <span dangerouslySetInnerHTML={{ __html: sanitizeHtml(applySearchHighlight(processHtmlSegment(convertLegacyLatexFragments(convertHtmlLatexFractions(normalizeSubQuestionLabels(value || '')))), terms)) }} />
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
