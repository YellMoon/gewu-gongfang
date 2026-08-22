import type { RuntimeConfig } from './runtimeConfigClient';
import type { HostPaperExportInput, HostPaperExportResult } from './hostPaperExport';
import { downloadHostArtifact } from './hostPaperExport';
import {
  cancelPaperExportTask as cancelRuntime,
  downloadPaperExportResult,
  loadPaperExportTasks as loadRuntime,
  refreshPaperExportTask as refreshRuntime,
  refreshPendingPaperExportTasks as refreshPendingRuntime,
  retryPaperExportTask as retryRuntime,
  submitPaperExportTask as submitRuntime,
} from './paperExportTaskClient.mjs';

export type PaperExportTaskStatus = 'draft' | 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'timed_out';

export interface PaperExportTaskRecord {
  localId: string;
  serverTaskId?: string;
  idempotencyKey: string;
  request: HostPaperExportInput;
  status: PaperExportTaskStatus;
  phase: string;
  progress: number;
  accepted: boolean;
  message?: string;
  errorCode?: string;
  result?: (Partial<HostPaperExportResult> & { accessEndpoint?: string }) | null;
  createdAt: string;
  updatedAt: string;
  retryOf?: string;
}

export function loadPaperExportTasks(): PaperExportTaskRecord[] {
  return loadRuntime() as PaperExportTaskRecord[];
}

export async function submitPaperExportTask(config: RuntimeConfig, input: HostPaperExportInput) {
  return submitRuntime(config, input) as Promise<{ accepted: boolean; task: PaperExportTaskRecord; error?: Error }>;
}

export async function refreshPaperExportTask(config: RuntimeConfig, localId: string): Promise<PaperExportTaskRecord> {
  return refreshRuntime(config, localId) as Promise<PaperExportTaskRecord>;
}

export async function refreshPendingPaperExportTasks(config: RuntimeConfig): Promise<PaperExportTaskRecord[]> {
  return refreshPendingRuntime(config) as Promise<PaperExportTaskRecord[]>;
}

export async function cancelPaperExportTask(config: RuntimeConfig, localId: string): Promise<PaperExportTaskRecord> {
  return cancelRuntime(config, localId) as Promise<PaperExportTaskRecord>;
}

export async function retryPaperExportTask(config: RuntimeConfig, localId: string) {
  return retryRuntime(config, localId) as Promise<{ accepted: boolean; task: PaperExportTaskRecord; error?: Error }>;
}

export async function downloadPaperExportTask(config: RuntimeConfig, task: PaperExportTaskRecord): Promise<void> {
  const result = task.result;
  if (!result) throw new Error('PAPER_EXPORT_RESULT_REQUIRED');
  if (result.token && result.fileUrl && result.accessUrl) {
    await downloadHostArtifact(result as HostPaperExportResult);
    return;
  }
  await downloadPaperExportResult(config, result);
}
