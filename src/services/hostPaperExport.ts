import { requestHostPaperExportRuntime } from './hostPaperExportRuntime.mjs';

export type FormulaExportMode = 'word-native' | 'eq-field' | 'mathtype-compatible' | 'latex-vector';
export type PaperArtifactFormat = 'word' | 'pdf';
export type AnswerPosition = 'end' | 'after-each' | 'hidden';

export interface HostPaperExportInput {
  title: string;
  format: PaperArtifactFormat;
  formulaMode: FormulaExportMode;
  questionIds: string[];
  answerPosition: AnswerPosition;
  subject?: string;
}

export interface HostPaperExportResult {
  artifactId: string;
  fileName: string;
  fileUrl: string;
  accessUrl: string;
  token: string;
  requestedFormulaMode: FormulaExportMode;
  effectiveFormulaModes: FormulaExportMode[];
  fallbackCount: number;
  formulaCount: number;
}

export async function requestHostPaperExport(apiBase: string, input: HostPaperExportInput): Promise<HostPaperExportResult> {
  return requestHostPaperExportRuntime(apiBase, input) as Promise<HostPaperExportResult>;
}

export async function downloadHostArtifact(result: HostPaperExportResult): Promise<void> {
  const { downloadHostArtifactRuntime } = await import('./hostPaperExportRuntime.mjs');
  await downloadHostArtifactRuntime('/api/question-bank', result);
}
