export type FormulaExportMode = 'word-native' | 'eq-field' | 'mathtype-compatible' | 'latex-vector';
export type PaperArtifactFormat = 'word' | 'pdf';

export interface HostPaperExportInput {
  title: string;
  format: PaperArtifactFormat;
  formulaMode: FormulaExportMode;
  questionIds: string[];
  includeAnswers: boolean;
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
  const response = await fetch(`${apiBase}/paper-export`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  const payload = await response.json();
  if (!response.ok || !payload.success) throw new Error(payload.error || 'host paper export failed');
  return payload.data as HostPaperExportResult;
}

export function downloadHostArtifact(result: HostPaperExportResult): void {
  const anchor = document.createElement('a');
  anchor.href = result.fileUrl;
  anchor.download = result.fileName;
  anchor.rel = 'noopener';
  anchor.click();
}
