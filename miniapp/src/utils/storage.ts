import Taro from '@tarojs/taro';
import { PendingChange, SyncTable } from '../types';
import { businessCacheIdentityKey } from './miniappAuthorizationRuntime';

const PREFIX = 'sch_';
const CACHE_IDENTITY_KEY = 'cache_identity';
const BUSINESS_TABLES: SyncTable[] = ['students', 'courses', 'schedules', 'teachers', 'payments', 'consumptions', 'questions', 'grades'];
let activeCacheIdentity = '';

// ========== 通用存储操作 ==========

export const storage = {
  get<T>(key: string): T | null {
    try {
      const val = Taro.getStorageSync(PREFIX + key);
      return val !== '' ? val : null;
    } catch {
      return null;
    }
  },

  set<T>(key: string, value: T): void {
    try {
      Taro.setStorageSync(PREFIX + key, value);
    } catch (e) {
      console.error('[Storage] 写入失败:', key, e);
    }
  },

  remove(key: string): void {
    try {
      Taro.removeStorageSync(PREFIX + key);
    } catch (e) {
      console.error('[Storage] 删除失败:', key, e);
    }
  },
};

// ========== 实体缓存 ==========
// 每类数据缓存在独立的 key 下，用于离线查看

export function getCachedList<T>(table: SyncTable): T[] {
  if (!activeCacheIdentity) return [];
  return storage.get<T[]>(`cache_${activeCacheIdentity}_${table}`) || [];
}

export function setCachedList<T>(table: SyncTable, data: T[]): void {
  if (!activeCacheIdentity) return;
  storage.set(`cache_${activeCacheIdentity}_${table}`, data);
}

export function setBusinessCacheIdentity(user: any): string {
  const nextIdentity = businessCacheIdentityKey(user);
  const previousIdentity = storage.get<string>(CACHE_IDENTITY_KEY) || '';
  if (previousIdentity && previousIdentity !== nextIdentity) {
    BUSINESS_TABLES.forEach(table => storage.remove(`cache_${previousIdentity}_${table}`));
  }
  activeCacheIdentity = nextIdentity;
  if (nextIdentity) storage.set(CACHE_IDENTITY_KEY, nextIdentity);
  else storage.remove(CACHE_IDENTITY_KEY);
  return nextIdentity;
}

export function clearBusinessCache(): void {
  const identity = activeCacheIdentity || storage.get<string>(CACHE_IDENTITY_KEY) || '';
  if (identity) BUSINESS_TABLES.forEach(table => storage.remove(`cache_${identity}_${table}`));
  activeCacheIdentity = '';
  storage.remove(CACHE_IDENTITY_KEY);
}

export function findCachedItem<T extends { id: string }>(table: SyncTable, id: string): T | undefined {
  const list = getCachedList<T>(table);
  return list.find((item: T) => item.id === id);
}

export function addCachedItem<T extends { id: string }>(table: SyncTable, item: T): void {
  const list = getCachedList<T>(table);
  const idx = list.findIndex((x: T) => x.id === item.id);
  if (idx >= 0) {
    list[idx] = item;
  } else {
    list.unshift(item);
  }
  setCachedList(table, list);
}

export function removeCachedItem(table: SyncTable, id: string): void {
  const list = getCachedList<any>(table);
  setCachedList(table, list.filter((x: any) => x.id !== id));
}

// ========== 离线操作队列 ==========

const PENDING_KEY = 'pending_changes';

export function getPendingChanges(): PendingChange[] {
  return storage.get<PendingChange[]>(PENDING_KEY) || [];
}

export function addPendingChange(change: PendingChange): void {
  const queue = getPendingChanges();
  queue.push(change);
  storage.set(PENDING_KEY, queue);
  console.log(`[Queue] 新增待同步: ${change.table}:${change.action}:${change.data?.id}`);
}

/**
 * 包装一个操作：在线直接执行 API，离线则入队
 */
export async function withOfflineSupport<T>(
  table: SyncTable,
  action: 'create' | 'update' | 'delete',
  data: any,
  onlineFn: () => Promise<T>,
): Promise<{ success: boolean; data?: T; offline?: boolean; error?: string }> {
  // 优先直接调 API；如果当前离线或网络波动，请求失败后再入队。
  // 避免在开发者工具中主动调用 getNetworkType 触发基础库内部 timeout。
  try {
    const result = await onlineFn();
    return { success: true, data: result };
  } catch (err: any) {
    // API 失败也入队（可能是网络波动）
    addPendingChange({
      id: data.id || generateTempId(),
      table,
      action,
      data,
      timestamp: Date.now(),
    });
    return { success: true, offline: true, error: err.message };
  }
}

// ========== 网络状态 ==========

type NetworkType = 'wifi' | '2g' | '3g' | '4g' | '5g' | 'unknown' | 'none';

let currentNetworkType: NetworkType = 'unknown';

export function getNetworkType(): Promise<NetworkType> {
  return Promise.resolve(currentNetworkType);
}

export function isOnline(): boolean {
  return currentNetworkType !== 'none';
}

// 监听网络状态变化
let networkChangeListener: ((res: { isConnected: boolean; networkType: string }) => void) | null = null;

export function onNetworkChange(callback: (res: { isConnected: boolean; networkType: string }) => void): void {
  networkChangeListener = callback;
  Taro.onNetworkStatusChange((res) => {
    currentNetworkType = (res.networkType as NetworkType) || 'unknown';
    callback({
      isConnected: res.isConnected,
      networkType: res.networkType,
    });
  });
}

export function offNetworkChange(): void {
  if (networkChangeListener) {
    Taro.offNetworkStatusChange(() => {});
    networkChangeListener = null;
  }
}

// ========== 辅助 ==========

function generateTempId(): string {
  return `local_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 9)}`;
}

export function getLastSyncTimestamp(): number {
  return storage.get<number>('last_sync_ts') || 0;
}

export function setLastSyncTimestamp(ts: number): void {
  storage.set('last_sync_ts', ts);
}

export function clearPendingChanges(): void {
  storage.set(PENDING_KEY, []);
}

/** 获取本地缓存的实体列表（兼容 sync.ts 调用） */
export function getLocalData<T>(table: SyncTable): T[] {
  return getCachedList<T>(table);
}
