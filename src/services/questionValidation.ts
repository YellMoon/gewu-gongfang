import type { Question } from '../types';

export type ImportValidationStatus = 'success' | 'warning' | 'failed';

export type ImportValidationIssue = {
  level: ImportValidationStatus;
  message: string;
};

export type ImportValidationRow = {
  key: string;
  index: number;
  question: any;
  status: ImportValidationStatus;
  issues: ImportValidationIssue[];
  autoTags?: string[];
};

export type ImportValidationSummary = {
  success: number;
  warning: number;
  failed: number;
  total: number;
};

function textOf(value: unknown): string {
  return String(value || '').trim();
}

function normalizeContent(value: unknown): string {
  return textOf(value).replace(/\s+/g, '');
}

function hasKnowledgeMatch(question: any): boolean {
  return Boolean(
    textOf(question.knowledge_point) ||
    (Array.isArray(question.knowledge_points) && question.knowledge_points.length > 0) ||
    (Array.isArray(question.knowledge_ids) && question.knowledge_ids.length > 0) ||
    (Array.isArray(question.knowledge_point_ids) && question.knowledge_point_ids.length > 0)
  );
}

function questionContent(question: any): string {
  return textOf(question.content || question.stem);
}

function questionAnswer(question: any): string {
  return textOf(question.answer);
}

export function validateImportQuestions(
  parsedQuestions: any[],
  existingQuestions: Question[] = []
): { rows: ImportValidationRow[]; summary: ImportValidationSummary } {
  const existingContent = new Set(existingQuestions.map(item => normalizeContent(item.content || item.stem)).filter(Boolean));
  const seenInBatch = new Set<string>();

  const rows = (parsedQuestions || []).map((question, index) => {
    const issues: ImportValidationIssue[] = [];
    const content = questionContent(question);
    const answer = questionAnswer(question);
    const fingerprint = normalizeContent(content);

    if (!content) issues.push({ level: 'failed', message: '题干为空' });
    if (!answer) issues.push({ level: 'warning', message: '答案为空' });
    if (!hasKnowledgeMatch(question)) issues.push({ level: 'warning', message: '知识点未匹配' });
    if (fingerprint && (existingContent.has(fingerprint) || seenInBatch.has(fingerprint))) {
      issues.push({ level: 'warning', message: '疑似重复题目' });
    }
    if (fingerprint) seenInBatch.add(fingerprint);

    const status: ImportValidationStatus = issues.some(item => item.level === 'failed')
      ? 'failed'
      : issues.length > 0
        ? 'warning'
        : 'success';

    const autoTags = Array.isArray(question.autoTagMatches)
      ? question.autoTagMatches.map((item: any) => `${item.tagName}(${item.keyword})`)
      : [];

    return {
      key: `${index}-${fingerprint || Date.now()}`,
      index: index + 1,
      question,
      status,
      issues,
      autoTags,
    };
  });

  const summary = rows.reduce<ImportValidationSummary>((acc, row) => {
    acc[row.status] += 1;
    acc.total += 1;
    return acc;
  }, { success: 0, warning: 0, failed: 0, total: 0 });

  return { rows, summary };
}

export function buildImportValidationReport(rows: ImportValidationRow[]): string {
  const header = ['序号', '状态', '问题', '题干摘要', '自动标签'].join(',');
  const body = rows.map(row => [
    row.index,
    row.status,
    row.issues.map(issue => issue.message).join('；') || '通过',
    `"${questionContent(row.question).replace(/"/g, '""').slice(0, 120)}"`,
    `"${(row.autoTags || []).join('；').replace(/"/g, '""')}"`,
  ].join(','));
  return [header, ...body].join('\n');
}

export function downloadImportValidationReport(rows: ImportValidationRow[], fileName = 'import-validation-report.csv'): void {
  const blob = new Blob(['\ufeff' + buildImportValidationReport(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
