import type { Question } from '../types';

export type TaxonomyValues = Record<string, string[]>;

export function questionTaxonomyValues(question: Partial<Question>): TaxonomyValues {
  return { knowledge: question.knowledge_ids ?? question.knowledge_point_ids ?? [],
    model: question.model_ids ?? question.model_point_ids ?? [], ...question.taxonomy_ids };
}

// Preserve unrelated systems and the existing cloud wire contract.
export function questionTaxonomyPatch(question: Partial<Question>, changes: TaxonomyValues, mode: 'replace' | 'add' | 'remove' = 'replace') {
  const taxonomy_ids = { ...questionTaxonomyValues(question) };
  for (const [systemId, values] of Object.entries(changes)) {
    const previous = taxonomy_ids[systemId] || [];
    taxonomy_ids[systemId] = mode === 'add' ? [...new Set([...previous, ...values])]
      : mode === 'remove' ? previous.filter(id => !values.includes(id)) : [...new Set(values)];
  }
  return { taxonomy_ids, knowledge_ids: taxonomy_ids.knowledge || [], knowledge_point_ids: taxonomy_ids.knowledge || [], model_ids: taxonomy_ids.model || [], model_point_ids: taxonomy_ids.model || [] };
}

export function parseQuestionNumbers(input: string, total: number): number[] {
  if (!input.trim()) throw new Error('请输入题号');
  const result = new Set<number>();
  for (const token of input.trim().split(/[,，、;；\s]+/)) {
    const match = /^(\d+)(?:[-–—~～](\d+))?$/.exec(token);
    if (!match) throw new Error(`题号格式有误：${token}`);
    const start = Number(match[1]), end = Number(match[2] || match[1]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start || end > total) {
      throw new Error(`题号须在 1 至 ${total} 之间：${token}`);
    }
    for (let number = start; number <= end; number++) result.add(number);
  }
  return [...result];
}
