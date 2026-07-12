import type { JSONContent } from '@tiptap/react';
export interface RichOption { id: string; label: string; isCorrect: boolean; content: JSONContent; }
export interface RichSubQuestion { id: string; label: string; content: JSONContent; answer: JSONContent; }
export interface QuestionRichDocument { version: 1; type: 'question-document'; sections: { stem: JSONContent; options: RichOption[]; subQuestions: RichSubQuestion[]; answer: JSONContent; analysis: JSONContent; }; }
export const emptyRichDoc = (): JSONContent => ({ type: 'doc', content: [] });
export function createQuestionRichDocument(existing?: Partial<QuestionRichDocument> | null): QuestionRichDocument {
  const sections = existing?.sections;
  const options = sections?.options;
  const subQuestions = sections?.subQuestions;
  return { version: 1, type: 'question-document', sections: { stem: sections?.stem || emptyRichDoc(), options: Array.isArray(options) ? options : [], subQuestions: Array.isArray(subQuestions) ? subQuestions : [], answer: sections?.answer || emptyRichDoc(), analysis: sections?.analysis || emptyRichDoc() } };
}
