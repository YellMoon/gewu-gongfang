export interface NormalizedQuestionOption {
  label: string;
  content: string;
}

export function normalizeOption(option: any, index: number): NormalizedQuestionOption {
  if (typeof option === 'string') {
    const match = option.trim().match(/^([A-G])[\.\uff0e]\s*([\s\S]*)$/i);
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

export function splitPackedOptions(options: NormalizedQuestionOption[]): NormalizedQuestionOption[] {
  const expanded = options.flatMap(option => splitPackedOption(option));
  return expanded.length >= options.length ? expanded : options;
}

function splitPackedOption(option: NormalizedQuestionOption): NormalizedQuestionOption[] {
  const raw = `${option.label}. ${option.content}`;
  const labelPattern = /(^|[\r\n\t\f])\s*([A-G])[\.\uff0e]\s*/g;
  const labels = Array.from(raw.matchAll(labelPattern)).map(match => {
    const prefix = match[1] || '';
    const labelStart = (match.index || 0) + prefix.length;
    return {
      label: match[2].toUpperCase(),
      labelStart,
      contentStart: labelStart + match[2].length + match[0].slice(prefix.length + match[2].length).length,
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

export function columnsForOptions(options: NormalizedQuestionOption[]): number {
  if (options.length > 4) return 1;
  if (options.length < 2) return 1;
  if (options.length === 3) return 1;
  if (options.length === 4 && options.every(option => isImageOnlyOption(option.content))) return 4;
  const maxLen = Math.max(...options.map(option => option.content.replace(/<[^>]+>/g, '').length));
  if (options.length === 4) {
    if (maxLen <= 12) return 4;
    if (maxLen <= 28) return 2;
    return 1;
  }
  if (options.length === 2 && maxLen <= 28) return 2;
  return 1;
}
