export interface NormalizedQuestionOption {
  label: string;
  content: string;
}

export type QuestionOptionLengthClass = 'short' | 'medium' | 'long';

export const OPTION_SHORT_TEXT_LIMIT = 12;
export const OPTION_MEDIUM_TEXT_LIMIT = 28;

const OPTION_PREFIX = /^([A-G])(?:[.\uff0e\u3001\u3002:\uff1a)\uff09])\s*([\s\S]*)$/i;
const OPTION_LABEL = /^\s*([A-G])(?:[.\uff0e\u3001\u3002:\uff1a)\uff09])?\s*$/i;

export function normalizeOptionLabel(value: unknown, index: number): string {
  const raw = String(value || '').trim();
  const match = raw.match(OPTION_LABEL);
  if (match) return match[1].toUpperCase();
  return raw ? raw.toUpperCase() : String.fromCharCode(65 + index);
}

export function normalizeOption(option: any, index: number): NormalizedQuestionOption {
  if (typeof option === 'string') {
    const match = option.trim().match(OPTION_PREFIX);
    return {
      label: normalizeOptionLabel(match?.[1], index),
      content: (match?.[2] || option).trim(),
    };
  }
  return {
    label: normalizeOptionLabel(option?.label, index),
    content: String(option?.content || option?.text || '').trim(),
  };
}

export function splitPackedOptions(options: NormalizedQuestionOption[]): NormalizedQuestionOption[] {
  const expanded = options.flatMap(option => splitPackedOption(option));
  return expanded.length >= options.length ? expanded : options;
}

function splitPackedOption(option: NormalizedQuestionOption): NormalizedQuestionOption[] {
  const raw = `${option.label}. ${option.content}`;
  const labelPattern = /(^|[\r\n\t\f])\s*([A-G])(?:[.\uff0e\u3001\u3002:\uff1a)\uff09])\s*/g;
  const labels = Array.from(raw.matchAll(labelPattern)).map(match => {
    const prefix = match[1] || '';
    const labelStart = (match.index || 0) + prefix.length;
    return {
      label: normalizeOptionLabel(match[2], 0),
      labelStart,
      contentStart: (match.index || 0) + match[0].length,
    };
  });
  if (labels.length < 2) return [option];
  const matches = labels.map((match, index) => {
    const next = labels[index + 1];
    return {
      label: match.label,
      content: raw.slice(match.contentStart, next?.labelStart ?? raw.length).trim(),
    };
  });
  const filtered = matches.filter(item => item.content);
  return filtered.length >= 2 ? filtered : [option];
}

export function normalizeOptions(options: any[]): NormalizedQuestionOption[] {
  const rows = (Array.isArray(options) ? options : [])
    .map(normalizeOption)
    .filter(option => option.content);
  return splitPackedOptions(rows);
}

export function imageSourcesFromHtml(value: string): string[] {
  return Array.from(String(value || '').matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)).map(match => match[1]);
}

export function isImageOnlyOption(value: string): boolean {
  const html = String(value || '').trim();
  if (!/<img\b/i.test(html)) return false;
  return html.replace(/<img\b[^>]*>/gi, '').replace(/<br\s*\/?>/gi, '').replace(/&nbsp;/gi, '').trim() === '';
}

function visibleOptionText(value: string): string {
  return String(value || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;|&#160;|&#xa0;/gi, ' ')
    .replace(/&(?:amp|lt|gt|quot|apos);/gi, 'x')
    .replace(/&#x[0-9a-f]+;|&#\d+;/gi, 'x')
    .replace(/\s+/g, ' ')
    .trim();
}

export function classifyOptionLength(options: NormalizedQuestionOption[]): QuestionOptionLengthClass {
  let maxLength = 0;
  for (const option of options) {
    maxLength = Math.max(maxLength, Array.from(visibleOptionText(option.content)).length);
  }
  if (maxLength <= OPTION_SHORT_TEXT_LIMIT) return 'short';
  if (maxLength <= OPTION_MEDIUM_TEXT_LIMIT) return 'medium';
  return 'long';
}

export function columnsForOptions(options: NormalizedQuestionOption[]): number {
  if (options.length > 4) return 1;
  if (options.length < 2) return 1;
  if (options.length === 3) return 1;
  if (options.length === 4 && options.every(option => isImageOnlyOption(option.content))) return 4;
  const lengthClass = classifyOptionLength(options);
  if (options.length === 4) {
    if (lengthClass === 'short') return 4;
    if (lengthClass === 'medium') return 2;
    return 1;
  }
  if (options.length === 2 && lengthClass !== 'long') return 2;
  return 1;
}
