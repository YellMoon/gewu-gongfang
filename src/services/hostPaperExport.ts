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
  fileName: string;
  fileUrl: string;
  requestedFormulaMode: FormulaExportMode;
  effectiveFormulaModes: FormulaExportMode[];
  fallbackCount: number;
  formulaCount: number;
}

export async function requestHostPaperExport(apiBase: string, input: HostPaperExportInput): Promise<HostPaperExportResult> {
  return requestHostPaperExportRuntime(apiBase, input) as Promise<HostPaperExportResult>;
}

export function downloadHostArtifact(result: HostPaperExportResult): void {
  const anchor = document.createElement('a');
  anchor.href = result.fileUrl;
  anchor.download = result.fileName;
  anchor.rel = 'noopener';
  anchor.click();
}
