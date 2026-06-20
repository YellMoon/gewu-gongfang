import {
  AlignmentType,
  Document,
  Footer,
  HeadingLevel,
  Packer,
  PageNumber,
  PageBreak,
  Paragraph,
  TextRun,
} from 'docx';
import type { Question } from '../types';
import { PROPERTY_SUBSCRIPTS, CHEMICAL_SUBSCRIPTS, UNIT_SYMBOLS, MATH_FUNCTIONS } from '../utils/physicsNotation';

declare const require: any;
const { QUESTION_PAPER_TEMPLATE } = require('./docxPaperTemplate');

export type DocxAnswerPosition = 'separate' | 'after-question' | 'hidden';

export interface DocxPaperQuestion {
  id: string;
  number: number;
  sectionTitle: string;
  score: number;
  question: Question;
}

export interface DocxPaperExportInput {
  title: string;
  questions: DocxPaperQuestion[];
  answerPosition: DocxAnswerPosition;
  includeSource?: boolean;
  includeAnswerArea?: boolean;
}

export interface DocxExportRecord {
  id: string;
  title: string;
  fileName: string;
  questionCount: number;
  totalScore: number;
  answerPosition: DocxAnswerPosition;
  createdAt: string;
}

const EXPORT_RECORD_STORAGE_KEY = 'question_bank_docx_export_records';
const DEFAULT_FONT = QUESTION_PAPER_TEMPLATE.font.chinese;
const PHYSICS_FONT = QUESTION_PAPER_TEMPLATE.font.latin;
const LABEL_SOURCE = String.fromCharCode(26469, 28304, 65306);
const LABEL_HINT_PREFIX = String.fromCharCode(25552, 31034, 65306, 26412, 39064, 21253, 21547);
const LABEL_HINT_SUFFIX = String.fromCharCode(65292, 68, 79, 67, 88, 32, 23548, 20986, 24050, 20445, 30041, 25991, 26412, 21344, 20301, 12290);
const LABEL_ANSWER = String.fromCharCode(31572, 26696, 65306);
const LABEL_ANALYSIS = String.fromCharCode(35299, 26512, 65306);
const LABEL_UNFILLED_ANSWER = String.fromCharCode(26410, 22635, 20889, 31572, 26696);

function safeText(value: unknown, fallback = ''): string {
  return String(value ?? fallback).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function sanitizeFileName(value: string): string {
  const name = safeText(value, '试卷').trim() || '试卷';
  return name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
}

function splitLines(value: unknown, fallback = '未填写'): string[] {
  const text = safeText(value, fallback).trim() || fallback;
  return text.split('\n');
}

function containsRichPlaceholder(question: Question): string[] {
  const markers: string[] = [];
  const text = [question.content, question.answer, question.analysis].map(item => safeText(item)).join('\n');
  if (question.has_image || /<img\b|!\[[^\]]*]\([^)]+\)/i.test(text)) markers.push('图片');
  if (question.has_formula || /\$\$|\\\(|\\\[|<math\b/i.test(text)) markers.push('公式');
  return markers;
}

function sourceText(question: Question): string {
  const parts = [question.year, question.region, question.school, question.exam_type, question.source].filter(Boolean);
  return parts.length > 0 ? parts.join(' / ') : '未填写来源';
}

function stripHtml(value: string): string {
  return safeText(value)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '');
}

function textRunsWithPhysicsNotation(text: string, options: { bold?: boolean; italics?: boolean; size?: number } = {}): TextRun[] {
  const runs: TextRun[] = [];
  const source = stripHtml(text);
  const tokenRe = /([A-Za-zα-ωΑ-Ω])(?:<sub>([^<]+)<\/sub>|([0-9]+|[A-Za-z]{1,3}))?|([0-9]+(?:\.[0-9]+)?|[+\-−=×÷·/(),，。；：、\s]+|[\u4e00-\u9fa5]+)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(source)) !== null) {
    if (match.index > last) {
      runs.push(new TextRun({ text: source.slice(last, match.index), font: DEFAULT_FONT, size: options.size ?? 22, bold: options.bold, italics: options.italics }));
    }
    const [raw, symbol, explicitSub, suffix, other] = match;
    if (other !== undefined) {
      runs.push(new TextRun({ text: other, font: /[A-Za-zα-ωΑ-Ω]/.test(other) ? PHYSICS_FONT : DEFAULT_FONT, size: options.size ?? 22, bold: options.bold, italics: options.italics }));
    } else if (symbol) {
      const isUnit = UNIT_SYMBOLS.has(raw);
      const isFunction = MATH_FUNCTIONS.includes(raw);
      const sub = explicitSub || suffix || '';
      const hasSub = !!sub && raw !== symbol;
      runs.push(new TextRun({
        text: symbol,
        font: PHYSICS_FONT,
        size: options.size ?? 22,
        bold: options.bold,
        italics: !isUnit && !isFunction,
      }));
      if (hasSub) {
        const subIsUpright = PROPERTY_SUBSCRIPTS.has(sub) || CHEMICAL_SUBSCRIPTS.has(sub) || /^[0-9]+$/.test(sub);
        runs.push(new TextRun({
          text: sub,
          font: PHYSICS_FONT,
          size: Math.max(14, (options.size ?? 22) - 4),
          subScript: true,
          italics: !subIsUpright,
        }));
      }
    }
    last = tokenRe.lastIndex;
  }
  if (last < source.length) {
    runs.push(new TextRun({ text: source.slice(last), font: DEFAULT_FONT, size: options.size ?? 22, bold: options.bold, italics: options.italics }));
  }
  return runs.length > 0 ? runs : [new TextRun({ text: source, font: DEFAULT_FONT, size: options.size ?? 22, bold: options.bold, italics: options.italics })];
}

function textParagraph(text: string, options: { bold?: boolean; italics?: boolean; size?: number } = {}): Paragraph {
  return new Paragraph({
    spacing: {
      after: QUESTION_PAPER_TEMPLATE.paragraph.after,
      line: QUESTION_PAPER_TEMPLATE.paragraph.line,
      lineRule: QUESTION_PAPER_TEMPLATE.paragraph.lineRule,
    },
    children: textRunsWithPhysicsNotation(text, options),
  });
}

function paperParagraph(
  text: string,
  options: { bold?: boolean; italics?: boolean; size?: number; alignment?: (typeof AlignmentType)[keyof typeof AlignmentType]; leftIndent?: number } = {}
): Paragraph {
  return new Paragraph({
    alignment: options.alignment,
    indent: options.leftIndent ? { left: options.leftIndent } : undefined,
    spacing: {
      after: QUESTION_PAPER_TEMPLATE.paragraph.after,
      line: QUESTION_PAPER_TEMPLATE.paragraph.line,
      lineRule: QUESTION_PAPER_TEMPLATE.paragraph.lineRule,
    },
    children: textRunsWithPhysicsNotation(text, options),
  });
}

function optionParagraph(label: string, content: string): Paragraph {
  return paperParagraph(label + '．' + content, {
    leftIndent: QUESTION_PAPER_TEMPLATE.option.leftIndent,
    size: QUESTION_PAPER_TEMPLATE.size.body,
  });
}

function lineParagraphs(lines: string[], prefix = ''): Paragraph[] {
  return lines.map((line, index) => textParagraph(`${index === 0 ? prefix : ''}${line}`));
}

function answerAreaParagraphs(): Paragraph[] {
  return [
    textParagraph('作答区：'),
    new Paragraph({
      spacing: { before: 80, after: 260 },
      border: {
        bottom: { color: 'C9D4E5', size: 6, style: 'single' },
      },
      children: [new TextRun({ text: ' ', font: DEFAULT_FONT })],
    }),
  ];
}

function buildQuestionParagraphs(item: DocxPaperQuestion, input: DocxPaperExportInput): Paragraph[] {
  const question = item.question;
  const freshContentLines = splitLines(question.content, '');
  const freshParagraphs: Paragraph[] = [];
  const freshFirstLine = freshContentLines.shift() || '';
  freshParagraphs.push(paperParagraph(String(item.number) + '．' + freshFirstLine, { size: QUESTION_PAPER_TEMPLATE.size.body }));
  freshContentLines.filter(line => line.trim()).forEach(line => {
    freshParagraphs.push(paperParagraph(line, { size: QUESTION_PAPER_TEMPLATE.size.body }));
  });
  const freshOptions: any[] = (question.options || []) as any[];
  for (const option of normalizeExportOptions(freshOptions)) {
    freshParagraphs.push(optionParagraph(option.label, option.content));
  }
  if (input.includeSource !== false) {
    freshParagraphs.push(paperParagraph(LABEL_SOURCE + sourceText(question), { italics: true, size: QUESTION_PAPER_TEMPLATE.size.meta }));
  }
  const freshPlaceholders = containsRichPlaceholder(question);
  if (freshPlaceholders.length > 0) {
    freshParagraphs.push(paperParagraph(LABEL_HINT_PREFIX + freshPlaceholders.join(String.fromCharCode(12289)) + LABEL_HINT_SUFFIX, { italics: true, size: QUESTION_PAPER_TEMPLATE.size.meta }));
  }
  if (input.includeAnswerArea !== false) {
    freshParagraphs.push(...answerAreaParagraphs());
  }
  if (input.answerPosition === 'after-question') {
    freshParagraphs.push(...lineParagraphs(splitLines(question.answer, LABEL_UNFILLED_ANSWER), LABEL_ANSWER));
    if (question.analysis) freshParagraphs.push(...lineParagraphs(splitLines(question.analysis), LABEL_ANALYSIS));
  }
  return freshParagraphs;
  const contentLines = splitLines(question.content, '');
  const nextParagraphs: Paragraph[] = [];
  const firstLine = contentLines.shift() || '';
  nextParagraphs.push(paperParagraph(String(item.number) + '．' + firstLine, { size: QUESTION_PAPER_TEMPLATE.size.body }));
  contentLines.filter(line => line.trim()).forEach(line => {
    nextParagraphs.push(paperParagraph(line, { size: QUESTION_PAPER_TEMPLATE.size.body }));
  });
  const nextOptions: any[] = (question.options || []) as any[];
  for (const option of normalizeExportOptions(nextOptions)) {
    nextParagraphs.push(optionParagraph(option.label, option.content));
  }
  if (input.includeSource !== false) {
    nextParagraphs.push(paperParagraph('来源：' + sourceText(question), { italics: true, size: QUESTION_PAPER_TEMPLATE.size.meta }));
  }
  const richPlaceholders = containsRichPlaceholder(question);
  if (richPlaceholders.length > 0) {
    nextParagraphs.push(paperParagraph('提示：本题包含' + richPlaceholders.join('、') + '，DOCX 导出已保留文本占位。', { italics: true, size: QUESTION_PAPER_TEMPLATE.size.meta }));
  }
  if (input.includeAnswerArea !== false) {
    nextParagraphs.push(...answerAreaParagraphs());
  }
  if (input.answerPosition === 'after-question') {
    nextParagraphs.push(...lineParagraphs(splitLines(question.answer, '未填写答案'), '答案：'));
    if (question.analysis) nextParagraphs.push(...lineParagraphs(splitLines(question.analysis), '解析：'));
  }
  return nextParagraphs;
  const placeholders = containsRichPlaceholder(question);
  const paragraphs: Paragraph[] = [
    textParagraph(`${item.number}.（${item.score}分）${safeText(question.type, '试题')} `, { bold: true }),
    ...lineParagraphs(splitLines(question.content, '未填写题干')),
  ];
  const options: any[] = (question.options || []) as any[];
  for (const option of normalizeExportOptions(options)) {
    paragraphs.push(textParagraph(`${option.label}. ${option.content}`));
  }

  if (input.includeSource !== false) {
    paragraphs.push(textParagraph(`来源：${sourceText(question)}`, { italics: true, size: 18 }));
  }

  if (placeholders.length > 0) {
    paragraphs.push(textParagraph(`提示：本题包含${placeholders.join('、')}，DOCX 导出已保留文本占位。`, { italics: true, size: 18 }));
  }

  if (input.includeAnswerArea !== false) {
    paragraphs.push(...answerAreaParagraphs());
  }

  if (input.answerPosition === 'after-question') {
    paragraphs.push(...lineParagraphs(splitLines(question.answer, '未填写答案'), '答案：'));
    if (question.analysis) paragraphs.push(...lineParagraphs(splitLines(question.analysis), '解析：'));
  }

  return paragraphs;
}

function normalizeExportOptions(options: any[]): Array<{ label: string; content: string }> {
  const rows = (options || []).map((option, index) => {
    if (typeof option === 'string') {
      const match = option.trim().match(/^([A-G])[\.\u3001\uff0e\s]+([\s\S]*)$/i);
      return {
        label: (match?.[1] || String.fromCharCode(65 + index)).toUpperCase(),
        content: (match?.[2] || option).trim(),
      };
    }
    return {
      label: String(option?.label || String.fromCharCode(65 + index)).toUpperCase(),
      content: String(option?.content || option?.text || '').trim(),
    };
  }).filter(option => option.content);
  if (rows.length !== 1) return rows;
  const raw = `${rows[0].label}. ${rows[0].content}`;
  const matches = Array.from(raw.matchAll(/(?:^|\s)([A-G])[\.\u3001\uff0e\s]+([\s\S]*?)(?=\s+[A-G][\.\u3001\uff0e\s]+|$)/g));
  if (matches.length < 2) return rows;
  return matches.map(match => ({ label: match[1].toUpperCase(), content: match[2].trim() })).filter(option => option.content);
}

function buildAnswerParagraphs(items: DocxPaperQuestion[]): Paragraph[] {
  const answerChildren: Paragraph[] = [
    paperParagraph('参考答案与解析', { bold: true, size: QUESTION_PAPER_TEMPLATE.size.body }),
  ];
  items.forEach(item => {
    answerChildren.push(...lineParagraphs(splitLines(item.question.answer, '未填写答案'), String(item.number) + '．答案：'));
    if (item.question.analysis) answerChildren.push(...lineParagraphs(splitLines(item.question.analysis), '解析：'));
  });
  return answerChildren;
  const children: Paragraph[] = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 240, after: 180 },
      children: [new TextRun({ text: '参考答案与解析', font: DEFAULT_FONT, bold: true })],
    }),
  ];

  items.forEach(item => {
    children.push(...lineParagraphs(splitLines(item.question.answer, '未填写答案'), `${item.number}. 答案：`));
    if (item.question.analysis) children.push(...lineParagraphs(splitLines(item.question.analysis), '解析：'));
  });

  return children;
}

export function createPaperDocxDocument(input: DocxPaperExportInput): Document {
  const nextSortedQuestions = [...input.questions].sort((a, b) => a.number - b.number);
  const nextSections = new Map<string, DocxPaperQuestion[]>();
  nextSortedQuestions.forEach(item => {
    const title = item.sectionTitle || '综合题';
    nextSections.set(title, [...(nextSections.get(title) || []), item]);
  });
  const totalScore = nextSortedQuestions.reduce((sum, item) => sum + Number(item.score || 0), 0);
  const nextChildren: Paragraph[] = [
    paperParagraph(safeText(input.title, '试卷'), {
      alignment: AlignmentType.CENTER,
      bold: true,
      size: QUESTION_PAPER_TEMPLATE.size.title,
    }),
    paperParagraph('学校:___________姓名：___________班级：___________考号：___________', {
      alignment: AlignmentType.CENTER,
      size: QUESTION_PAPER_TEMPLATE.size.meta,
    }),
    paperParagraph('题目数：' + nextSortedQuestions.length + '    总分：' + totalScore + '分', {
      alignment: AlignmentType.CENTER,
      size: QUESTION_PAPER_TEMPLATE.size.meta,
    }),
  ];
  nextSections.forEach((items, sectionTitle) => {
    nextChildren.push(paperParagraph(sectionTitle, { bold: true, size: QUESTION_PAPER_TEMPLATE.size.body }));
    items.forEach(item => nextChildren.push(...buildQuestionParagraphs(item, input)));
  });
  if (input.answerPosition === 'separate') {
    nextChildren.push(new Paragraph({ children: [new PageBreak()] }));
    nextChildren.push(...buildAnswerParagraphs(nextSortedQuestions));
  }
  return new Document({
    creator: '格物工坊',
    title: safeText(input.title, '试卷'),
    description: '格物工坊题库组卷导出',
    sections: [{
      properties: {
        page: {
          size: {
            width: QUESTION_PAPER_TEMPLATE.page.width,
            height: QUESTION_PAPER_TEMPLATE.page.height,
          },
          margin: QUESTION_PAPER_TEMPLATE.page.margin,
        },
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({ text: QUESTION_PAPER_TEMPLATE.footer.leftText, font: DEFAULT_FONT, size: QUESTION_PAPER_TEMPLATE.size.meta }),
                new TextRun({ children: [PageNumber.CURRENT], font: DEFAULT_FONT, size: QUESTION_PAPER_TEMPLATE.size.meta }),
                new TextRun({ text: '页 | ' + QUESTION_PAPER_TEMPLATE.footer.rightText, font: DEFAULT_FONT, size: QUESTION_PAPER_TEMPLATE.size.meta }),
              ],
            }),
          ],
        }),
      },
      children: nextChildren,
    }],
  });
  const sortedQuestions = [...input.questions].sort((a, b) => a.number - b.number);
  const sections = new Map<string, DocxPaperQuestion[]>();
  sortedQuestions.forEach(item => {
    const title = item.sectionTitle || '综合题';
    sections.set(title, [...(sections.get(title) || []), item]);
  });

  const children: Paragraph[] = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
      children: [new TextRun({ text: safeText(input.title, '试卷'), font: DEFAULT_FONT, bold: true, size: 36 })],
    }),
    textParagraph(`题目数：${sortedQuestions.length}    总分：${sortedQuestions.reduce((sum, item) => sum + Number(item.score || 0), 0)}分`, { size: 20 }),
  ];

  sections.forEach((items, sectionTitle) => {
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 180, after: 120 },
      children: [new TextRun({ text: sectionTitle, font: DEFAULT_FONT, bold: true })],
    }));
    items.forEach(item => children.push(...buildQuestionParagraphs(item, input)));
  });

  if (input.answerPosition === 'separate') {
    children.push(new Paragraph({ children: [new PageBreak()] }));
    children.push(...buildAnswerParagraphs(sortedQuestions));
  }

  return new Document({
    creator: '格物工坊',
    title: safeText(input.title, '试卷'),
    description: '格物工坊题库组卷导出',
    sections: [{ properties: {}, children }],
  });
}

export async function createPaperDocxBlob(input: DocxPaperExportInput): Promise<Blob> {
  const document = createPaperDocxDocument(input);
  return Packer.toBlob(document);
}

export function getDocxExportRecords(): DocxExportRecord[] {
  try {
    const rows = JSON.parse(localStorage.getItem(EXPORT_RECORD_STORAGE_KEY) || '[]');
    return Array.isArray(rows) ? rows : [];
  } catch (_err) {
    return [];
  }
}

export function recordDocxExport(input: DocxPaperExportInput, fileName: string): DocxExportRecord {
  const record: DocxExportRecord = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title: input.title,
    fileName,
    questionCount: input.questions.length,
    totalScore: input.questions.reduce((sum, item) => sum + Number(item.score || 0), 0),
    answerPosition: input.answerPosition,
    createdAt: new Date().toISOString(),
  };
  const records = [record, ...getDocxExportRecords()].slice(0, 50);
  localStorage.setItem(EXPORT_RECORD_STORAGE_KEY, JSON.stringify(records));
  return record;
}

export async function downloadPaperDocx(input: DocxPaperExportInput): Promise<DocxExportRecord> {
  const blob = await createPaperDocxBlob(input);
  const fileName = `${sanitizeFileName(input.title)}.docx`;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
  return recordDocxExport(input, fileName);
}
