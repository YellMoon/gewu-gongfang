export const QUESTION_TYPES = ['单选题', '多选题', '实验题', '解答题', '判断题'] as const;

export type QuestionType = typeof QUESTION_TYPES[number];

const QUESTION_TYPE_SET = new Set<string>(QUESTION_TYPES);

const LEGACY_QUESTION_TYPE_MAP: Record<string, QuestionType> = {
  选择题: '单选题',
  填空题: '解答题',
  简答题: '解答题',
  作图题: '解答题',
  计算题: '解答题',
  问答题: '解答题',
  单选: '单选题',
  多选: '多选题',
  实验: '实验题',
  判断: '判断题',
};

const PARSER_QUESTION_TYPE_MAP: Record<string, QuestionType> = {
  single: '单选题',
  multi: '多选题',
  experiment: '实验题',
  judge: '判断题',
  calculation: '解答题',
  problem: '解答题',
  fill: '解答题',
  short: '解答题',
  drawing: '解答题',
};

export function normalizeQuestionType(type?: string | null): QuestionType {
  const value = String(type || '').trim();
  if (QUESTION_TYPE_SET.has(value)) return value as QuestionType;
  return LEGACY_QUESTION_TYPE_MAP[value] || '解答题';
}

export function questionTypeFromParser(questionTypes?: string[] | string | null): QuestionType {
  const types = Array.isArray(questionTypes) ? questionTypes : [questionTypes || ''];
  for (const type of types) {
    const value = String(type || '').trim();
    const mapped = PARSER_QUESTION_TYPE_MAP[value] || LEGACY_QUESTION_TYPE_MAP[value];
    if (mapped) return mapped;
    if (QUESTION_TYPE_SET.has(value)) return value as QuestionType;
  }
  return '解答题';
}
