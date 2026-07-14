import type { JSONContent } from '@tiptap/react';
import type { QuestionRichDocument, RichOption, RichSubQuestion } from '../../types/questionRichContent';

export type StructureCollection = 'options' | 'subQuestions';
const emptyRichDoc = (): JSONContent => ({ type: 'doc', content: [] });

export function hasRichContent(value?: JSONContent): boolean {
  if (!value) return false;
  if (value.type === 'text') return Boolean(String(value.text || '').trim());
  if (value.type === 'formula' || value.type === 'formulaBlock' || value.type === 'image') return true;
  return Array.isArray(value.content) && value.content.some(hasRichContent);
}

function patchCollection<T extends RichOption | RichSubQuestion>(value: QuestionRichDocument, collection: StructureCollection, items: T[]): QuestionRichDocument {
  const normalized = items.map((item, index) => ({ ...item, label: collection === 'options' ? String.fromCharCode(65 + index) : `(${index + 1})` })) as T[];
  const next = { ...value, sections: { ...value.sections, [collection]: normalized } };
  if (collection !== 'options') return next;
  const selected = (normalized as RichOption[]).filter(item => item.isCorrect).map(item => item.label).join('');
  return selected ? { ...next, sections: { ...next.sections, answer: textAnswer(selected) } } : next;
}

const textAnswer = (text: string): JSONContent => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

export type ChoiceMode = 'single' | 'multiple' | 'other';
export function choiceMode(questionType?: string): ChoiceMode {
  const type = String(questionType || '').toLowerCase();
  if (/multiple|multi|\u591a\u9009/.test(type)) return 'multiple';
  if (/single|\u5355\u9009|\u9009\u62e9/.test(type)) return 'single';
  return 'other';
}

export function setCorrectSelection(value: QuestionRichDocument, id: string, checked: boolean, mode: ChoiceMode): QuestionRichDocument {
  const current = value.sections.options;
  if (mode === 'multiple' && !checked && current.filter(item => item.isCorrect).length <= 1 && current.find(item => item.id === id)?.isCorrect) return value;
  const options = current.map(item => ({ ...item, isCorrect: mode === 'single' ? item.id === id && checked : item.id === id ? checked : item.isCorrect }));
  const selected = options.filter(item => item.isCorrect).map(item => item.label).join('');
  return { ...value, sections: { ...value.sections, options, answer: selected ? textAnswer(selected) : emptyRichDoc() } };
}

export function normalizeStructureOrder(value: QuestionRichDocument): QuestionRichDocument {
  const options = patchCollection(value, 'options', value.sections.options);
  return patchCollection(options, 'subQuestions', options.sections.subQuestions);
}

export function mergeQuestionAssets(existing: any[] = [], additions: any[] = []): any[] {
  const result: any[] = [];
  const seen = new Set<string>();
  const keyOf = (asset: any) => String(asset?.assetKey || asset?.asset_key || asset?.oss_key || asset?.id || asset?.oss_url || asset?.url || '').trim().toLowerCase();
  for (const asset of [...existing, ...additions]) {
    const key = keyOf(asset) || JSON.stringify(asset);
    if (seen.has(key)) continue;
    seen.add(key); result.push(asset);
  }
  return result;
}

export function addOption(value: QuestionRichDocument, createId: () => string): QuestionRichDocument {
  const index = value.sections.options.length;
  return patchCollection(value, 'options', [...value.sections.options, { id: createId(), label: String.fromCharCode(65 + index), isCorrect: false, content: emptyRichDoc() }]);
}

export function addSubQuestion(value: QuestionRichDocument, createId: () => string): QuestionRichDocument {
  const index = value.sections.subQuestions.length;
  return patchCollection(value, 'subQuestions', [...value.sections.subQuestions, { id: createId(), label: `(${index + 1})`, content: emptyRichDoc(), answer: emptyRichDoc() }]);
}

export function updateEntity(value: QuestionRichDocument, collection: StructureCollection, id: string, patch: Partial<RichOption & RichSubQuestion>): QuestionRichDocument {
  const items = value.sections[collection];
  return patchCollection(value, collection, items.map(item => item.id === id ? { ...item, ...patch } : item) as any);
}

export function moveEntity(value: QuestionRichDocument, collection: StructureCollection, id: string, offset: -1 | 1): QuestionRichDocument {
  const items = [...value.sections[collection]];
  const index = items.findIndex(item => item.id === id);
  const target = index + offset;
  if (index < 0 || target < 0 || target >= items.length) return value;
  [items[index], items[target]] = [items[target], items[index]];
  return patchCollection(value, collection, items as any);
}

export function removeEntity(value: QuestionRichDocument, collection: StructureCollection, id: string, confirmNonEmpty: () => boolean): QuestionRichDocument {
  const items: Array<RichOption | RichSubQuestion> = value.sections[collection];
  const item = items.find(candidate => candidate.id === id);
  if (!item) return value;
  const nonEmpty = hasRichContent(item.content) || ('answer' in item && hasRichContent(item.answer));
  if (nonEmpty && !confirmNonEmpty()) return value;
  return patchCollection(value, collection, items.filter(candidate => candidate.id !== id) as any);
}

export function validateQuestionStructure(value: QuestionRichDocument, questionType?: string): string[] {
  const errors: string[] = [];
  if (!hasRichContent(value.sections.stem)) errors.push('\u8bf7\u8f93\u5165\u9898\u5e72');
  const ids = [...value.sections.options, ...value.sections.subQuestions].map(item => item.id);
  if (ids.some((id, index) => !id || ids.indexOf(id) !== index)) errors.push('\u9009\u9879\u548c\u5c0f\u9898\u5fc5\u987b\u5177\u6709\u552f\u4e00\u7a33\u5b9a\u6807\u8bc6');
  if (value.sections.options.some(option => !option.label.trim())) errors.push('\u9009\u9879\u6807\u7b7e\u4e0d\u80fd\u4e3a\u7a7a');
  if (value.sections.subQuestions.some(sub => !sub.label.trim())) errors.push('\u5c0f\u9898\u5e8f\u53f7\u4e0d\u80fd\u4e3a\u7a7a');
  if (value.sections.options.some((option, index) => option.label !== String.fromCharCode(65 + index))) errors.push('\u9009\u9879\u5fc5\u987b\u6309 A/B/C \u987a\u5e8f\u7f16\u53f7');
  if (value.sections.subQuestions.some((sub, index) => sub.label !== `(${index + 1})`)) errors.push('\u5c0f\u9898\u5fc5\u987b\u6309 (1)/(2) \u987a\u5e8f\u7f16\u53f7');
  const mode = choiceMode(questionType);
  const correctCount = value.sections.options.filter(option => option.isCorrect).length;
  if (mode === 'single' && correctCount !== 1) errors.push('\u5355\u9009\u9898\u5fc5\u987b\u4e14\u53ea\u80fd\u6709\u4e00\u4e2a\u6b63\u786e\u9009\u9879');
  if (mode === 'multiple' && correctCount < 1) errors.push('\u591a\u9009\u9898\u81f3\u5c11\u9700\u8981\u4e00\u4e2a\u6b63\u786e\u9009\u9879');
  return errors;
}
