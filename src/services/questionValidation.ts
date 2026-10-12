import type { Question } from '../types';
import { inspectQuestion, questionSections, richNodeText } from './questionInspection';
const { similarity, DEFAULT_SIMILARITY_THRESHOLD } = require('../../shared/questionDeduplication');

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
    || Object.values(question.taxonomy_ids || {}).some(ids => Array.isArray(ids) && ids.length > 0)
  );
}

function questionContent(question: any): string {
  const sections = questionSections(question);
  return sections.structured ? richNodeText(sections.stem) : textOf(question.content || question.stem);
}

export function validateImportQuestions(
  parsedQuestions: any[],
  existingQuestions: Question[] = [],
  similarityThreshold: number = DEFAULT_SIMILARITY_THRESHOLD
): { rows: ImportValidationRow[]; summary: ImportValidationSummary } {
  const compared: any[] = existingQuestions.filter(item => !(item as any).deleted && (item as any).storage_state !== 'local_draft');

  const rows = (parsedQuestions || []).map((question, index) => {
    const issues: ImportValidationIssue[] = [];
    const content = questionContent(question);
    const fingerprint = normalizeContent(content);

    inspectQuestion(question).forEach(message => issues.push({ level: message === '题干为空' ? 'failed' : 'warning', message }));
    if (!hasKnowledgeMatch(question)) issues.push({ level: 'warning', message: '知识点未匹配' });
    if (Array.isArray(question.format_warnings)) {
      question.format_warnings.forEach((warning: unknown) => {
        const message = textOf(warning);
        if (message && !issues.some(issue => issue.message === message)) issues.push({ level: 'warning', message });
      });
    }
    let match: any = null, highest = 0;
    for (const prior of compared) {
      const score = similarity(question, prior);
      if (score > highest) { highest = score; match = prior; }
    }
    if (highest >= similarityThreshold && match) issues.push({ level: 'warning', message: highest === 100
      ? '重复率 100%：提交时自动合并标签并补齐缺失答案、解析（已有内容差异保留并提示）'
      : `相似度 ${highest.toFixed(2)}%：请核对${match.id ? '题目 ' + match.id : '本批前面的题目'}` });
    compared.push(question);

    const status: ImportValidationStatus = issues.some(item => item.level === 'failed')
      ? 'failed'
      : issues.length > 0
        ? 'warning'
        : 'success';

    const autoTags = Array.isArray(question.autoTagMatches)
      ? question.autoTagMatches.map((item: any) => `${item.tagName}(${item.keyword})`)
      : [];

    return {
      key: `${index}-${fingerprint || 'empty'}`,
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

export function mergeImportValidation<T extends { status: ImportValidationStatus; issues: ImportValidationIssue[] }>(row: T, remote: any, format: (code: string) => string): T {
  const codes: string[] = Array.isArray(remote?.codes) ? remote.codes : [];
  // UTF-8: show the cloud merge receipt rather than local guesses.
  const dedup = remote?.deduplication;
  const dedupIssues: ImportValidationIssue[] = dedup?.merged ? [{ level: 'warning', message: `已合并到题目 ${dedup.questionId}，重复率 100%${dedup.conflicts?.length ? '；答案或解析存在差异，原内容已保留' : ''}` }] : [];
  const remoteLevel: ImportValidationStatus = remote?.status === 'rejected' ? 'failed' : 'warning';
  const issues = [...row.issues, ...dedupIssues];
  for (const code of codes) {
    const message = format(code);
    if (!issues.some(issue => issue.message === message)) issues.push({ level: remoteLevel, message });
  }
  const status = row.status === 'failed' || remote?.status === 'rejected' ? 'failed'
    : row.status === 'warning' || remote?.status === 'warning' || issues.length ? 'warning' : 'success';
  return { ...row, status, issues };
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
