import { normalizeOption } from '../utils/questionOptions';

/** Inspect content without changing the saved document or attempting to judge correctness. */
export function richNodeText(node: any): string {
  if (!node) return '';
  if (Array.isArray(node)) return node.map(richNodeText).join(' ');
  if (node.type === 'text') return String(node.text || '');
  if (node.type === 'formula' || node.type === 'formulaBlock') return String(node.attrs?.canonicalLatex || node.attrs?.latex || '');
  if (node.type === 'image') return String(node.attrs?.alt || '');
  return richNodeText(node.content);
}

export function hasQuestionContent(value: any): boolean {
  if (typeof value === 'string') return /<img\b|<math\b/i.test(value) || Boolean(value.replace(/<[^>]*>/g, '').replace(/&(?:nbsp|#160);/g, ' ').trim());
  if (!value) return false;
  if (Array.isArray(value)) return value.some(hasQuestionContent);
  if (value.type === 'image') return Boolean(value.attrs?.src || value.attrs?.assetKey);
  if (value.type === 'formula' || value.type === 'formulaBlock') return Boolean(value.attrs?.canonicalLatex || value.attrs?.latex);
  return Boolean(value.type === 'text' && String(value.text || '').trim()) || hasQuestionContent(value.content);
}

export function questionSections(question: any) {
  const sections = question.rich_content?.type === 'question-document' ? question.rich_content.sections : null;
  return {
    stem: sections ? sections.stem : question.content || question.stem,
    answer: sections ? sections.answer : question.answer,
    analysis: sections ? sections.analysis : question.analysis || question.explanation,
    options: sections ? sections.options || [] : question.options || [],
    subQuestions: sections ? sections.subQuestions || [] : [],
    structured: Boolean(sections),
  };
}

export function inspectQuestion(question: any): string[] {
  const sections = questionSections(question);
  const issues: string[] = [];
  if (!hasQuestionContent(sections.stem)) issues.push('题干为空');
  if (!hasQuestionContent(sections.answer) && !sections.subQuestions.some((sub: any) => hasQuestionContent(sub.answer))) issues.push('答案为空');
  if (!hasQuestionContent(sections.analysis) && !sections.subQuestions.some((sub: any) => hasQuestionContent(sub.analysis))) issues.push('解析为空');
  for (const [index, sub] of sections.subQuestions.entries()) {
    if (!hasQuestionContent(sub.answer)) issues.push(`第 ${index + 1} 小题答案为空`);
  }
  const choice = ['单选题', '多选题', 'single_choice', 'multiple_choice'].includes(question.type);
  if (choice) {
    if (sections.options.length < 2) issues.push('选择题选项不足');
    const labels = sections.options.map((option: any, i: number) => normalizeOption(option, i).label);
    if (new Set(labels).size !== labels.length) issues.push('选项标号重复');
    if (sections.options.some((option: any) => !hasQuestionContent(typeof option === 'string' ? option : option.content || option.text))) issues.push('选项内容为空');
    const answer = (sections.structured ? richNodeText(sections.answer) : String(sections.answer || '')).trim().toUpperCase();
    if (/^[A-Z\s,，、;；]+$/.test(answer)) {
      const selected = answer.replace(/[\s,，、;；]/g, '').split('');
      if (selected.some(label => !labels.includes(label))) issues.push('答案选项不存在，请核对');
      if (['单选题', 'single_choice'].includes(question.type) && new Set(selected).size > 1) issues.push('单选题存在多个答案，请核对');
    }
  }
  const visit = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if ((node.type === 'formula' || node.type === 'formulaBlock') && !String(node.attrs?.canonicalLatex || node.attrs?.latex || '').trim()) issues.push('公式待补全，请对照原稿核对');
    Object.values(node).forEach(value => { if (value && typeof value === 'object') visit(value); });
  };
  visit(question.rich_content);
  return [...new Set(issues)];
}

/** Text visible in the prompt only; answers, explanations and metadata stay outside this index. */
export function questionStemSearchText(question: any): string {
  const sections = questionSections(question);
  const promptText = (value: any): string => typeof value === 'string'
    ? value.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ')
    : richNodeText(value);
  const optionsText = (options: any[]) => options.map((option: any) => typeof option === 'string'
    ? promptText(option) : [option.label, promptText(option.content || option.text)].filter(Boolean).join(' '));
  const subText = (sub: any): string => [promptText(sub.stem || sub.content),
    ...optionsText(sub.options || []), ...(sub.subQuestions || sub.sub_questions || []).map(subText)].join(' ');
  const subQuestions = sections.structured ? sections.subQuestions : question.subQuestions || question.sub_questions || [];
  return [promptText(sections.stem), ...optionsText(sections.options), ...subQuestions.map(subText)]
    .join('\n').toLocaleLowerCase();
}

export function questionSearchText(question: any): string {
  const sections = questionSections(question);
  const structured = sections.structured ? [richNodeText(sections.stem), richNodeText(sections.answer), richNodeText(sections.analysis),
    ...sections.options.map((o: any) => `${o.label || ''} ${richNodeText(o.content)}`),
    ...sections.subQuestions.map((s: any) => [richNodeText(s.stem || s.content), richNodeText(s.answer), richNodeText(s.analysis)].join(' '))] : [];
  return [question.id, question.content, question.stem, question.answer, question.analysis, question.explanation,
    question.source, question.exam_type, question.region, question.school, question.year,
    ...(question.tags || []), ...(question.options || []).map((o: any) => typeof o === 'string' ? o : `${o.label || ''} ${o.content || o.text || ''}`),
    ...(question.formulas || []).map((f: any) => f.latex || f.canonicalLatex || ''), ...structured,
    ...(question.knowledge_ids || question.knowledge_point_ids || []), ...(question.model_ids || question.model_point_ids || [])]
    .filter(Boolean).map(value => String(value).replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ')).join('\n').toLocaleLowerCase();
}
