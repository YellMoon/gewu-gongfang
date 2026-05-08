import Taro from '@tarojs/taro';
import { PendingChange, SyncTable } from '../types';
import {
  getPendingChanges,
  clearPendingChanges,
  getLastSyncTimestamp,
  setLastSyncTimestamp,
  getCachedList,
  setCachedList,
  addCachedItem,
  removeCachedItem,
  onNetworkChange,
} from './storage';
import { syncApi } from './api';

// ========== 同步管理器 ==========

type SyncCallback = (info: { type: 'confirm'; count: number; changes: PendingChange[] } | { type: 'done'; success: boolean; message: string }) => void;

let syncCallback: SyncCallback | null = null;

export function setSyncCallback(callback: SyncCallback): void {
  syncCallback = callback;
}

/**
 * 初始化同步管理器：监听网络状态，在线后自动检查待同步项
 */
export function initSyncManager(): void {
  const pending = getPendingChanges();
  if (pending.length > 0) {
    notifyUser(pending);
  }

  onNetworkChange((res) => {
    if (res.isConnected) {
      console.log('[Sync] 网络已恢复，检查待同步项...');
      const pending = getPendingChanges();
      if (pending.length > 0) {
        notifyUser(pending);
      } else {
        pullFromServer();
      }
    } else {
      console.log('[Sync] 网络已断开');
    }
  });
}

function notifyUser(pending: PendingChange[]): void {
  const recordCount = pending.length;
  Taro.showModal({
    title: '同步提醒',
    content: `有 ${recordCount} 条离线操作待同步到云端，同步前请确认：\n\n${summarizeChanges(pending)}\n\n确认后将更新云端数据`,
    confirmText: '确认同步',
    cancelText: '稍后再说',
    success: (res) => {
      if (res.confirm) {
        pushToServer();
      }
    },
  });
}

function summarizeChanges(changes: PendingChange[]): string {
  const tableNames: Record<string, string> = {
    students: '学生',
    courses: '课程',
    schedules: '排课',
    payments: '缴费',
    consumptions: '课时消耗',
    teachers: '老师',
    grades: '成绩',
  };
  const actionNames: Record<string, string> = {
    create: '新增',
    update: '修改',
    delete: '删除',
  };
  const groups: Record<string, number> = {};
  changes.forEach((c) => {
    const key = `${actionNames[c.action] || c.action}${tableNames[c.table] || c.table}`;
    groups[key] = (groups[key] || 0) + 1;
  });
  return Object.entries(groups)
    .map(([k, v]) => `· ${k} ${v} 条`)
    .join('\n');
}

async function pushToServer(): Promise<boolean> {
  const pending = getPendingChanges();
  if (pending.length === 0) {
    Taro.showToast({ title: '无待同步数据', icon: 'none' });
    return true;
  }
  Taro.showLoading({ title: '同步中...' });
  try {
    const res = await syncApi.push(pending);
    if (res.success) {
      clearPendingChanges();
      Taro.hideLoading();
      Taro.showToast({ title: `同步成功 (${pending.length}条)`, icon: 'success' });
      await pullFromServer();
      return true;
    } else {
      Taro.hideLoading();
      Taro.showToast({ title: '同步失败，请重试', icon: 'error' });
      if (syncCallback) {
        syncCallback({ type: 'done', success: false, message: res.error || '同步失败' });
      }
      return false;
    }
  } catch (err: any) {
    Taro.hideLoading();
    Taro.showToast({ title: err.message || '同步失败', icon: 'error' });
    return false;
  }
}

async function pullFromServer(): Promise<boolean> {
  const lastTs = getLastSyncTimestamp();
  try {
    const res = await syncApi.pull(lastTs);
    if (res.success && res.data) {
      const { updates, serverTimestamp } = res.data;
      if (updates) {
        for (const update of updates) {
          const table = update.table as SyncTable;
          const items = update.data || [];
          if (items.length > 0) {
            const cached = getCachedList<any>(table);
            const merged = mergeLists(cached, items);
            setCachedList(table, merged);
          }
        }
      }
      setLastSyncTimestamp(serverTimestamp || Date.now());
      console.log('[Sync] 云端数据拉取成功');
      return true;
    }
    return false;
  } catch (err: any) {
    console.error('[Sync] 拉取失败:', err);
    return false;
  }
}

function mergeLists<T extends { id: string; updated_at?: string }>(cached: T[], server: T[]): T[] {
  const map = new Map<string, T>();
  for (const item of cached) map.set(item.id, item);
  for (const item of server) {
    const existing = map.get(item.id);
    if (!existing || (item.updated_at && existing.updated_at && item.updated_at > existing.updated_at)) {
      map.set(item.id, item);
    }
  }
  return Array.from(map.values());
}

/**
 * 手动触发同步（用户在设置页点击"立即同步"）
 */
export async function manualSync(): Promise<void> {
  const pending = getPendingChanges();
  if (pending.length > 0) {
    notifyUser(pending);
  } else {
    const ok = await pullFromServer();
    if (ok) {
      Taro.showToast({ title: '数据已是最新', icon: 'success' });
    } else {
      Taro.showToast({ title: '同步失败，请检查网络', icon: 'error' });
    }
  }
}

export function getLocalData<T>(table: SyncTable): T[] {
  return getCachedList<T>(table);
}

export function getLocalItem<T extends { id: string }>(table: SyncTable, id: string): T | undefined {
  const list = getCachedList<T>(table);
  return list.find((item: T) => item.id === id);
}

export function updateLocalItem<T extends { id: string }>(table: SyncTable, item: T): void {
  addCachedItem(table, item);
}

export function addLocalItem<T extends { id: string }>(table: SyncTable, item: T): void {
  addCachedItem(table, item);
}

export function removeLocalItem(table: SyncTable, id: string): void {
  removeCachedItem(table, id);
}

// ========== 兼容 settings 页面导入 ==========

export async function triggerSync(): Promise<{ success: boolean; message: string }> {
  try {
    await manualSync();
    return { success: true, message: '同步完成' };
  } catch (e: any) {
    return { success: false, message: e.message || '同步失败' };
  }
}

/** 兼容 settings 页面调用名 */
export async function pullFromCloud(): Promise<boolean> {
  return pullFromServer();
}
