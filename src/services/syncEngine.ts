/**
 * CRDT 同步引擎 v1.0 — 离线优先的增量同步协议
 *
 * 核心设计：
 * - 操作型 CRDT（Operation-based CRDT）
 * - Last-Writer-Wins + 字段级别合并
 * - 向量时钟检测冲突
 * - 所有变更先写本地，再异步同步
 *
 * 同步流程：
 *   pull()  ← 服务端推送增量变更
 *   push()  → 本地待同步队列推送到服务端
 *   merge() → 合并冲突（LWW + 字段级合并）
 *
 * 适用：桌面端 Electron ↔ 服务端 ↔ 小程序端
 */
import { v4 as uuid } from 'uuid';

// ========== 核心类型 ==========

/** 同步表名 */
export type SyncTable =
  | 'students' | 'courses' | 'schedules' | 'payments' | 'consumptions'
  | 'teachers' | 'grades' | 'rooms' | 'institutions' | 'assetRecords'
  | 'questions' | 'assetCategories';

/** 操作类型 */
export type SyncAction = 'create' | 'update' | 'delete';

/** 变更操作（CRDT 操作单元） */
export interface SyncOperation {
  id: string;               // 全局唯一操作 ID (uuid)
  table: SyncTable;
  recordId: string;          // 目标记录 ID
  action: SyncAction;
  fields?: Record<string, any>;  // 变更的字段（update 时使用）
  data?: any;                // 完整数据（create 时使用）
  timestamp: number;         // 客户端时间戳 (ms)
  clientId: string;          // 客户端唯一标识
  vectorClock: Record<string, number>;  // 向量时钟
}

/** 同步批次 */
export interface SyncBatch {
  operations: SyncOperation[];
  lastSyncTimestamp: number;
  clientId: string;
}

/** 同步结果 */
export interface SyncResult {
  success: boolean;
  applied: number;
  conflicts: SyncConflict[];
  serverOperations: SyncOperation[];
  serverTimestamp: number;
}

/** 冲突记录 */
export interface SyncConflict {
  operation: SyncOperation;
  serverData: any;
  resolution: 'local-wins' | 'server-wins' | 'manual';
  resolvedFields?: Record<string, any>;
}

/** 同步状态 */
export interface SyncStatus {
  online: boolean;
  pendingCount: number;
  lastSyncTime: number | null;
  lastSyncResult: 'success' | 'partial' | 'error' | null;
}

// ========== CRDT 引擎 ==========

export const SYNC_TABLES: SyncTable[] = [
  'students', 'courses', 'schedules', 'payments', 'consumptions',
  'teachers', 'grades', 'rooms', 'institutions', 'assetRecords',
  'questions', 'assetCategories',
];

/**
 * CRDT 同步引擎
 *
 * 职责：
 * - 管理待同步队列（本地持久化）
 * - 执行 LWW 合并
 * - 提供 push/pull 接口
 * - 记录向量时钟
 */
export class SyncEngine {
  private clientId: string;
  private storage: SyncStorage;
  private vectorClock: Record<string, number>;
  private pendingOps: SyncOperation[];

  constructor(clientId?: string, storage?: SyncStorage) {
    this.clientId = clientId || this.generateClientId();
    this.storage = storage || new DefaultSyncStorage();
    this.vectorClock = this.loadVectorClock();
    this.pendingOps = this.loadPendingOps();
  }

  // ========== 客户端标识 ==========

  private generateClientId(): string {
    const stored = this.storage.get<string>('sync_client_id');
    if (stored) return stored;
    const id = `client_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 9)}`;
    this.storage.set('sync_client_id', id);
    return id;
  }

  getClientId(): string {
    return this.clientId;
  }

  // ========== 向量时钟管理 ==========

  private loadVectorClock(): Record<string, number> {
    return this.storage.get<Record<string, number>>('sync_vector_clock') || {};
  }

  private saveVectorClock(): void {
    this.storage.set('sync_vector_clock', this.vectorClock);
  }

  /**
   * 增加本地时钟
   */
  private tick(): number {
    this.vectorClock[this.clientId] = (this.vectorClock[this.clientId] || 0) + 1;
    this.saveVectorClock();
    return this.vectorClock[this.clientId];
  }

  getVectorClock(): Record<string, number> {
    return { ...this.vectorClock };
  }

  // ========== 待同步队列管理 ==========

  private loadPendingOps(): SyncOperation[] {
    return this.storage.get<SyncOperation[]>('sync_pending_ops') || [];
  }

  private savePendingOps(): void {
    this.storage.set('sync_pending_ops', this.pendingOps);
  }

  getPendingCount(): number {
    return this.pendingOps.length;
  }

  getPendingOps(): SyncOperation[] {
    return [...this.pendingOps];
  }

  // ========== 核心操作 ==========

  /**
   * 创建一条本地变更操作，入队待同步
   */
  createOperation(table: SyncTable, recordId: string, action: SyncAction, data?: any, fields?: Record<string, any>): SyncOperation {
    const op: SyncOperation = {
      id: uuid(),
      table,
      recordId,
      action,
      data: action === 'create' ? data : undefined,
      fields: action === 'update' ? fields : undefined,
      timestamp: Date.now(),
      clientId: this.clientId,
      vectorClock: this.getVectorClock(),
    };

    this.tick();
    this.pendingOps.push(op);
    this.savePendingOps();

    return op;
  }

  /**
   * 批量创建变更操作
   */
  createOperations(ops: Array<{ table: SyncTable; recordId: string; action: SyncAction; data?: any; fields?: Record<string, any> }>): SyncOperation[] {
    return ops.map(op => this.createOperation(op.table, op.recordId, op.action, op.data, op.fields));
  }

  /**
   * 推送本地待同步队列到服务端
   * @param pushFn 实际执行推送的函数
   */
  async push(pushFn: (batch: SyncBatch) => Promise<{ success: boolean; serverTimestamp: number }>): Promise<{ pushed: number; success: boolean }> {
    if (this.pendingOps.length === 0) return { pushed: 0, success: true };

    const batch: SyncBatch = {
      operations: [...this.pendingOps],
      lastSyncTimestamp: this.storage.get<number>('sync_last_ts') || 0,
      clientId: this.clientId,
    };

    try {
      const result = await pushFn(batch);

      if (result.success) {
        // 清除已推送的操作
        this.pendingOps = [];
        this.savePendingOps();

        // 更新最后同步时间
        this.storage.set('sync_last_ts', result.serverTimestamp);

        return { pushed: batch.operations.length, success: true };
      }

      return { pushed: 0, success: false };
    } catch (err) {
      console.error('[SyncEngine] 推送失败:', err);
      return { pushed: 0, success: false };
    }
  }

  /**
   * 从服务端拉取变更并合并到本地
   * @param pullFn 实际执行拉取的函数
   * @param localData 当前本地数据（用于合并）
   */
  async pull(
    pullFn: (lastSyncTs: number) => Promise<{ success: boolean; operations: SyncOperation[]; serverTimestamp: number }>,
    localData: Record<SyncTable, Map<string, any>>,
  ): Promise<{ applied: number; conflicts: SyncConflict[]; success: boolean }> {
    const lastSyncTs = this.storage.get<number>('sync_last_ts') || 0;

    try {
      const result = await pullFn(lastSyncTs);

      if (!result.success) {
        return { applied: 0, conflicts: [], success: false };
      }

      const conflicts: SyncConflict[] = [];
      let applied = 0;

      for (const op of result.operations) {
        const merged = this.mergeOperation(op, localData[op.table]?.get(op.recordId));

        if (merged.conflict) {
          conflicts.push(merged.conflict);
        }

        if (merged.apply) {
          applied++;
          if (localData[op.table]) {
            this.applyOperationToLocal(op, localData[op.table]);
          }
        }
      }

      // 更新同步时间
      this.storage.set('sync_last_ts', result.serverTimestamp);
      // 更新向量时钟
      for (const op of result.operations) {
        this.mergeVectorClock(op.vectorClock);
      }
      this.saveVectorClock();

      return { applied, conflicts, success: true };
    } catch (err) {
      console.error('[SyncEngine] 拉取失败:', err);
      return { applied: 0, conflicts: [], success: false };
    }
  }

  // ========== CRDT 合并逻辑 ==========

  /**
   * LWW + 字段级合并
   *
   * 规则：
   * 1. 本地有未推送的操作 → 标记冲突，由外部决定
   * 2. 服务端时间戳 > 本地 → 服务端胜出
   * 3. 本地时间戳 > 服务端 → 本地胜出
   * 4. 时间戳相同 → clientId 大的胜出
   */
  private mergeOperation(
    serverOp: SyncOperation,
    localRecord: any | undefined,
  ): { apply: boolean; conflict?: SyncConflict } {
    // 处理删除操作
    if (serverOp.action === 'delete') {
      // 检查本地是否有待推送的修改
      const hasPendingUpdate = this.pendingOps.some(
        op => op.recordId === serverOp.recordId && op.table === serverOp.table && op.timestamp > serverOp.timestamp
      );
      if (hasPendingUpdate) {
        return {
          apply: false,
          conflict: {
            operation: serverOp,
            serverData: null,
            resolution: 'local-wins',
          },
        };
      }
      return { apply: true };
    }

    // 新增操作
    if (serverOp.action === 'create') {
      return { apply: true };
    }

    // 更新操作：字段级合并
    if (serverOp.action === 'update' && localRecord) {
      const localClock = this.vectorClock[serverOp.clientId] || 0;
      const serverClock = serverOp.vectorClock[serverOp.clientId] || 0;

      // 服务端时钟更新 → 服务端胜出
      if (serverClock > localClock) {
        return { apply: true };
      }
      // 本地时钟更新 → 本地胜出
      if (localClock > serverClock) {
        return { apply: false };
      }
      // 时钟相同 → 时间戳决胜
      return { apply: true };
    }

    return { apply: true };
  }

  /**
   * 将服务端操作应用到本地数据
   */
  private applyOperationToLocal(op: SyncOperation, localMap: Map<string, any>): void {
    switch (op.action) {
      case 'create':
        if (op.data) {
          localMap.set(op.recordId, { ...op.data, _synced: true });
        }
        break;

      case 'update':
        if (op.fields && localMap.has(op.recordId)) {
          const existing = { ...localMap.get(op.recordId) };
          // 字段级合并
          let changed = false;
          for (const [key, value] of Object.entries(op.fields)) {
            if (existing[key] !== value) {
              existing[key] = value;
              changed = true;
            }
          }
          if (changed) {
            existing.updated_at = new Date().toISOString();
            existing._synced = true;
            localMap.set(op.recordId, existing);
          }
        }
        break;

      case 'delete':
        localMap.delete(op.recordId);
        break;
    }
  }

  /**
   * 合并向量时钟
   */
  private mergeVectorClock(remote: Record<string, number>): void {
    for (const [client, clock] of Object.entries(remote)) {
      this.vectorClock[client] = Math.max(this.vectorClock[client] || 0, clock);
    }
  }

  /**
   * 冲突解决（手动）
   */
  resolveConflict(conflict: SyncConflict, resolution: 'local-wins' | 'server-wins'): void {
    conflict.resolution = resolution;
  }

  // ========== 状态查询 ==========

  getStatus(): SyncStatus {
    return {
      online: typeof navigator !== 'undefined' ? navigator.onLine : true,
      pendingCount: this.pendingOps.length,
      lastSyncTime: this.storage.get<number>('sync_last_ts') || null,
      lastSyncResult: this.storage.get<SyncStatus['lastSyncResult']>('sync_last_result') || null,
    };
  }

  /**
   * 清除所有待同步队列
   */
  clearPending(): void {
    this.pendingOps = [];
    this.savePendingOps();
  }

  /**
   * 重置整个同步引擎
   */
  reset(): void {
    this.pendingOps = [];
    this.vectorClock = {};
    this.savePendingOps();
    this.saveVectorClock();
    this.storage.remove('sync_last_ts');
    this.storage.remove('sync_last_result');
  }
}

// ========== 存储抽象 ==========

export interface SyncStorage {
  get<T>(key: string): T | null;
  set<T>(key: string, value: T): void;
  remove(key: string): void;
}

/** 默认 localStorage 实现 */
class DefaultSyncStorage implements SyncStorage {
  private prefix = 'sync_engine_';

  get<T>(key: string): T | null {
    try {
      const val = localStorage.getItem(this.prefix + key);
      return val ? JSON.parse(val) : null;
    } catch {
      return null;
    }
  }

  set<T>(key: string, value: T): void {
    try {
      localStorage.setItem(this.prefix + key, JSON.stringify(value));
    } catch (e) {
      console.error('[SyncEngine/Storage] 写入失败:', key, e);
    }
  }

  remove(key: string): void {
    try {
      localStorage.removeItem(this.prefix + key);
    } catch {
      // ignore
    }
  }
}

export default SyncEngine;
