import { v4 as uuid } from 'uuid';
import type { SyncAction, SyncChange, SyncTable } from './syncEngine';

export type RiskLevel = 'low' | 'medium' | 'high';

export type SyncOperation = {
  operationId: string;
  tenantId: string;
  deviceId: string;
  tableName: SyncTable;
  recordId: string;
  action: SyncAction;
  baseVersion: string | null;
  newVersion: string;
  payload: Record<string, any>;
  riskLevel: RiskLevel;
  createdAt: string;
};

const HIGH_RISK_TABLES = new Set<SyncTable>([
  'payments',
  'consumptions',
  'schedules',
  'courses',
  'questions',
  'assetRecords',
]);

export function classifyRisk(tableName: SyncTable, payload: Record<string, any> = {}): RiskLevel {
  if (HIGH_RISK_TABLES.has(tableName)) return 'high';
  if ('balance_money' in payload || 'tuition_total' in payload || 'answer' in payload || 'analysis' in payload) {
    return 'high';
  }
  if ('notes' in payload || 'tags' in payload) return 'low';
  return 'medium';
}

export function createSyncOperation(input: {
  tenantId?: string;
  deviceId: string;
  tableName: SyncTable;
  recordId: string;
  action: SyncAction;
  baseVersion?: string | null;
  payload?: Record<string, any>;
}): SyncOperation {
  const createdAt = new Date().toISOString();
  const payload: Record<string, any> = { ...(input.payload || {}), id: input.recordId };
  return {
    operationId: uuid(),
    tenantId: input.tenantId || payload.tenant_id || 'default',
    deviceId: input.deviceId,
    tableName: input.tableName,
    recordId: input.recordId,
    action: input.action,
    baseVersion: input.baseVersion || null,
    newVersion: payload.updated_at || createdAt,
    payload,
    riskLevel: classifyRisk(input.tableName, payload),
    createdAt,
  };
}

export function operationToChange(operation: SyncOperation): SyncChange {
  return {
    id: operation.operationId,
    table: operation.tableName,
    action: operation.action,
    data: {
      ...operation.payload,
      _base_version: operation.baseVersion,
      _risk_level: operation.riskLevel,
    },
    version: operation.newVersion,
    updatedAt: operation.newVersion,
    tenantId: operation.tenantId,
    deviceId: operation.deviceId,
  };
}

export interface MutationQueueStorage {
  get<T>(key: string): T | null;
  set<T>(key: string, value: T): void;
}

export class LocalMutationQueue {
  private key = 'gewu_mutation_queue_v1';

  constructor(private storage: MutationQueueStorage) {}

  list(): SyncOperation[] {
    return this.storage.get<SyncOperation[]>(this.key) || [];
  }

  add(operation: SyncOperation): SyncOperation[] {
    const next = [...this.list(), operation];
    this.storage.set(this.key, next);
    return next;
  }

  clearApplied(appliedOperationIds: string[]): SyncOperation[] {
    const applied = new Set(appliedOperationIds);
    const next = this.list().filter(op => !applied.has(op.operationId));
    this.storage.set(this.key, next);
    return next;
  }

  replace(operations: SyncOperation[]): void {
    this.storage.set(this.key, operations);
  }
}
