/**
 * CRDT 同步引擎 — 小程序适配版
 * 与桌面端 src/services/syncEngine.ts 共享相同的同步协议
 * 使用 Taro 存储替代 localStorage
 */
import Taro from '@tarojs/taro';

// ========== 核心类型（与桌面端一致） ==========

export type SyncTable =
  | 'students' | 'courses' | 'schedules' | 'payments' | 'consumptions'
  | 'teachers' | 'grades' | 'rooms' | 'institutions' | 'assetRecords'
  | 'questions' | 'assetCategories';

export type SyncAction = 'create' | 'update' | 'delete';

export interface SyncOperation {
  id: string;
  table: SyncTable;
  recordId: string;
  action: SyncAction;
  fields?: Record<string, any>;
  data?: any;
  timestamp: number;
  clientId: string;
  vectorClock: Record<string, number>;
}

export interface SyncBatch {
  operations: SyncOperation[];
  lastSyncTimestamp: number;
  clientId: string;
}

export interface SyncResult {
  success: boolean;
  applied: number;
  conflicts: SyncConflict[];
  serverOperations: SyncOperation[];
  serverTimestamp: number;
}

export interface SyncConflict {
  operation: SyncOperation;
  serverData: any;
  resolution: 'local-wins' | 'server-wins' | 'manual';
}

export interface SyncStatus {
  online: boolean;
  pendingCount: number;
  lastSyncTime: number | null;
  lastSyncResult: 'success' | 'partial' | 'error' | null;
}

// ========== 小程序专用存储适配 ==========

class TaroSyncStorage {
  private prefix = 'sync_engine_';

  get<T>(key: string): T | null {
    try {
      const val = Taro.getStorageSync(this.prefix + key);
      return val || null;
    } catch {
      return null;
    }
  }

  set<T>(key: string, value: T): void {
    try {
      Taro.setStorageSync(this.prefix + key, value);
    } catch (e) {
      console.error('[SyncEngine/Storage] 写入失败:', key, e);
    }
  }

  remove(key: string): void {
    try {
      Taro.removeStorageSync(this.prefix + key);
    } catch {
      // ignore
    }
  }
}

// ========== 小程序同步引擎 ==========

export class MiniSyncEngine {
  private clientId: string;
  private storage: TaroSyncStorage;
  private vectorClock: Record<string, number>;
  private pendingOps: SyncOperation[];

  constructor() {
    this.storage = new TaroSyncStorage();
    this.clientId = this.loadClientId();
    this.vectorClock = this.loadVectorClock();
    this.pendingOps = this.loadPendingOps();
  }

  private generateClientId(): string {
    return `miniapp_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private loadClientId(): string {
    const stored = this.storage.get<string>('sync_client_id');
    if (stored) return stored;
    const id = this.generateClientId();
    this.storage.set('sync_client_id', id);
    return id;
  }

  getClientId(): string { return this.clientId; }

  private loadVectorClock(): Record<string, number> {
    return this.storage.get<Record<string, number>>('sync_vector_clock') || {};
  }

  private saveVectorClock(): void {
    this.storage.set('sync_vector_clock', this.vectorClock);
  }

  private tick(): number {
    this.vectorClock[this.clientId] = (this.vectorClock[this.clientId] || 0) + 1;
    this.saveVectorClock();
    return this.vectorClock[this.clientId];
  }

  getVectorClock(): Record<string, number> { return { ...this.vectorClock }; }

  private loadPendingOps(): SyncOperation[] {
    return this.storage.get<SyncOperation[]>('sync_pending_ops') || [];
  }

  private savePendingOps(): void {
    this.storage.set('sync_pending_ops', this.pendingOps);
  }

  getPendingCount(): number { return this.pendingOps.length; }

  createOperation(table: SyncTable, recordId: string, action: SyncAction, data?: any, fields?: Record<string, any>): SyncOperation {
    const op: SyncOperation = {
      id: `op_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`,
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

  async push(baseUrl: string, token: string): Promise<{ pushed: number; success: boolean }> {
    if (this.pendingOps.length === 0) return { pushed: 0, success: true };

    try {
      const res = await Taro.request({
        url: `${baseUrl}/api/sync/push`,
        method: 'POST',
        header: {
          'Content-Type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : '',
        },
        data: {
          operations: this.pendingOps,
          clientId: this.clientId,
          lastSyncTimestamp: this.storage.get<number>('sync_last_ts') || 0,
        } as SyncBatch,
        timeout: 30000,
      });

      if (res.statusCode === 200 && res.data?.success) {
        this.pendingOps = [];
        this.savePendingOps();
        this.storage.set('sync_last_ts', res.data.serverTimestamp || Date.now());
        return { pushed: this.pendingOps.length, success: true };
      }

      return { pushed: 0, success: false };
    } catch (err) {
      console.error('[MiniSyncEngine] 推送失败:', err);
      return { pushed: 0, success: false };
    }
  }

  async pull(baseUrl: string, token: string): Promise<{ operations: SyncOperation[]; success: boolean }> {
    const lastSyncTs = this.storage.get<number>('sync_last_ts') || 0;

    try {
      const res = await Taro.request({
        url: `${baseUrl}/api/sync/pull?lastSyncTs=${lastSyncTs}`,
        method: 'GET',
        header: {
          'Authorization': token ? `Bearer ${token}` : '',
        },
        timeout: 30000,
      });

      if (res.statusCode === 200 && res.data?.success) {
        const ops = res.data.operations || [];

        // 合并向量时钟
        for (const op of ops) {
          if (op.vectorClock) {
            for (const [client, clock] of Object.entries(op.vectorClock)) {
              this.vectorClock[client] = Math.max(this.vectorClock[client] || 0, clock as number);
            }
          }
        }
        this.saveVectorClock();
        this.storage.set('sync_last_ts', res.data.serverTimestamp || Date.now());

        return { operations: ops, success: true };
      }

      return { operations: [], success: false };
    } catch (err) {
      console.error('[MiniSyncEngine] 拉取失败:', err);
      return { operations: [], success: false };
    }
  }

  clearPending(): void {
    this.pendingOps = [];
    this.savePendingOps();
  }

  reset(): void {
    this.pendingOps = [];
    this.vectorClock = {};
    this.savePendingOps();
    this.saveVectorClock();
    this.storage.remove('sync_last_ts');
    this.storage.remove('sync_last_result');
  }

  getStatus(): SyncStatus {
    return {
      online: true,
      pendingCount: this.pendingOps.length,
      lastSyncTime: this.storage.get<number>('sync_last_ts') || null,
      lastSyncResult: this.storage.get<SyncStatus['lastSyncResult']>('sync_last_result') || null,
    };
  }
}

export default MiniSyncEngine;
