import type { JSONContent } from '@tiptap/react';

export const QUESTION_RICH_CONTENT_VERSION = 1 as const;

export interface FormulaNodeAttrs {
  id: string;
  canonicalLatex: string;
  displayMode: 'inline' | 'block';
  sourceRef?: string;
  warnings?: string[];
}

export interface ImageNodeAttrs {
  assetKey: string;
  alt: string;
  width?: number;
  height?: number;
  align?: 'left' | 'center' | 'right';
}

export interface RichOption { id: string; label: string; isCorrect: boolean; content: JSONContent; }
export interface RichSubQuestion { id: string; label: string; content: JSONContent; answer: JSONContent; }
export interface QuestionRichDocument {
  version: typeof QUESTION_RICH_CONTENT_VERSION;
  type: 'question-document';
  sections: {
    stem: JSONContent;
    options: RichOption[];
    subQuestions: RichSubQuestion[];
    answer: JSONContent;
    analysis: JSONContent;
  };
}

export const emptyRichDoc = (): JSONContent => ({ type: 'doc', content: [] });

export function createQuestionRichDocument(existing?: Partial<QuestionRichDocument> | null): QuestionRichDocument {
  const sections = existing?.sections;
  const options = sections?.options;
  const subQuestions = sections?.subQuestions;
  return {
    version: QUESTION_RICH_CONTENT_VERSION,
    type: 'question-document',
    sections: {
      stem: sections?.stem || emptyRichDoc(),
      options: Array.isArray(options) ? options : [],
      subQuestions: Array.isArray(subQuestions) ? subQuestions : [],
      answer: sections?.answer || emptyRichDoc(),
      analysis: sections?.analysis || emptyRichDoc(),
    },
  };
}
