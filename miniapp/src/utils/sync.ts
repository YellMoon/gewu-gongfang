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
  addPendingChange,
  onNetworkChange,
} from './storage';
import { getApiBaseUrl } from './api';

type SyncAction = 'create' | 'update' | 'delete';

interface SyncChange {
  id: string;
  table: SyncTable;
  action: SyncAction;
  data: any;
  version: string;
  updatedAt: string;
  tenantId: string;
  deviceId: string;
}

type SyncCallback = (info: { type: 'confirm'; count: number; changes: PendingChange[] } | { type: 'done'; success: boolean; message: string }) => void;

let syncCallback: SyncCallback | null = null;

export function setSyncCallback(callback: SyncCallback): void {
  syncCallback = callback;
}

function getDeviceId(): string {
  const key = 'sch_sync_device_id';
  let id = Taro.getStorageSync(key);
  if (!id) {
    id = `miniapp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 11)}`;
    Taro.setStorageSync(key, id);
  }
  return id;
}

function toIsoTime(value: number | string | undefined, fallbackNow = true): string {
  if (!value) return fallbackNow ? new Date().toISOString() : '1970-01-01T00:00:00.000Z';
  if (typeof value === 'number') return value > 0 ? new Date(value).toISOString() : '1970-01-01T00:00:00.000Z';
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? (fallbackNow ? new Date().toISOString() : '1970-01-01T00:00:00.000Z') : new Date(parsed).toISOString();
}

function toTimestamp(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Date.now();
}

function toSyncChange(change: PendingChange): SyncChange {
  const updatedAt = toIsoTime(change.timestamp || change.data?.updated_at);
  return {
    id: `${change.table}:${change.id}:${updatedAt}:${change.action}`,
    table: change.table,
    action: change.action,
    data: { ...(change.data || {}), id: change.id },
    version: updatedAt,
    updatedAt,
    tenantId: change.data?.tenant_id || 'default',
    deviceId: getDeviceId(),
  };
}

function normalizeServerChange(change: any): SyncChange {
  const data = { ...(change.data || {}) };
  const updatedAt = toIsoTime(change.updatedAt || change.updated_at || data.updated_at || Date.now());
  return {
    id: change.id || `${change.table}:${data.id}:${updatedAt}`,
    table: change.table,
    action: change.action || (data.deleted ? 'delete' : 'update'),
    data,
    version: change.version || updatedAt,
    updatedAt,
    tenantId: change.tenantId || change.tenant_id || data.tenant_id || 'default',
    deviceId: change.deviceId || change.device_id || 'server',
  };
}

export function initSyncManager(): void {
  const pending = getPendingChanges();
  if (pending.length > 0) {
    notifyUser(pending);
  }

  onNetworkChange((res) => {
    if (res.isConnected) {
      console.log('[Sync] 网络已恢复，检查待同步项...');
      const pendingNow = getPendingChanges();
      if (pendingNow.length > 0) {
        notifyUser(pendingNow);
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
  changes.forEach((change) => {
    const key = `${actionNames[change.action] || change.action}${tableNames[change.table] || change.table}`;
    groups[key] = (groups[key] || 0) + 1;
  });
  return Object.entries(groups)
    .map(([key, value]) => `- ${key} ${value} 条`)
    .join('\n');
}

async function requestSync(path: string, options: { method: 'GET' | 'POST'; data?: any }): Promise<any> {
  const token = Taro.getStorageSync('auth_token');
  const res = await Taro.request({
    url: `${getApiBaseUrl()}${path}`,
    method: options.method,
    header: {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : '',
    },
    data: options.data,
    timeout: 30000,
  });
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(`HTTP ${res.statusCode}`);
  }
  return res.data;
}

async function pushToServer(): Promise<boolean> {
  const pending = getPendingChanges();
  if (pending.length === 0) {
    Taro.showToast({ title: '无待同步数据', icon: 'none' });
    return true;
  }
  Taro.showLoading({ title: '同步中...' });
  try {
    const changes = pending.map(toSyncChange);
    const res = await requestSync('/api/sync/push', {
      method: 'POST',
      data: {
        changes,
        deviceId: getDeviceId(),
        tenantId: 'default',
        lastSyncTimestamp: getLastSyncTimestamp(),
      },
    });
    if (res.success) {
      clearPendingChanges();
      Taro.hideLoading();
      Taro.showToast({ title: `同步成功 (${pending.length}条)`, icon: 'success' });
      await pullFromServer();
      return true;
    }
    Taro.hideLoading();
    Taro.showToast({ title: '同步失败，请重试', icon: 'error' });
    if (syncCallback) {
      syncCallback({ type: 'done', success: false, message: res.error || '同步失败' });
    }
    return false;
  } catch (err: any) {
    Taro.hideLoading();
    Taro.showToast({ title: err.message || '同步失败', icon: 'error' });
    return false;
  }
}

async function pullFromServer(): Promise<boolean> {
  const lastTs = getLastSyncTimestamp();
  try {
    const data = await requestSync(`/api/sync?since=${encodeURIComponent(toIsoTime(lastTs, false))}&deviceId=${encodeURIComponent(getDeviceId())}`, {
      method: 'GET',
    });
    if (data.success) {
      const changes = ((data.changes || []) as any[]).map(normalizeServerChange);
      applyServerChanges(changes);
      setLastSyncTimestamp(toTimestamp(data.serverTimestamp || data.serverTime || data.server_time));
      console.log('[Sync] 云端数据拉取成功');
      return true;
    }
    return false;
  } catch (err: any) {
    console.error('[Sync] 拉取失败:', err);
    return false;
  }
}

function applyServerChanges(changes: SyncChange[]): void {
  const grouped = new Map<SyncTable, SyncChange[]>();
  for (const change of changes) {
    const list = grouped.get(change.table) || [];
    list.push(change);
    grouped.set(change.table, list);
  }
  for (const [table, tableChanges] of grouped.entries()) {
    const cached = getCachedList<any>(table);
    const merged = mergeChanges(cached, tableChanges);
    setCachedList(table, merged);
  }
}

function mergeChanges<T extends { id: string; updated_at?: string }>(cached: T[], changes: SyncChange[]): T[] {
  const map = new Map<string, T>();
  for (const item of cached) map.set(item.id, item);
  for (const change of changes) {
    const id = change.data?.id;
    if (!id) continue;
    if (change.action === 'delete' || change.data?.deleted) {
      map.delete(id);
      continue;
    }
    const existing = map.get(id);
    if (!existing || change.updatedAt >= (existing.updated_at || '')) {
      map.set(id, change.data as T);
    }
  }
  return Array.from(map.values());
}

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
  addPendingChange({
    id: item.id,
    table,
    action: 'update',
    data: item,
    timestamp: Date.now(),
  });
}

export function addLocalItem<T extends { id: string }>(table: SyncTable, item: T): void {
  addCachedItem(table, item);
  addPendingChange({
    id: item.id,
    table,
    action: 'create',
    data: item,
    timestamp: Date.now(),
  });
}

export function removeLocalItem(table: SyncTable, id: string): void {
  removeCachedItem(table, id);
  addPendingChange({
    id,
    table,
    action: 'delete',
    data: { id },
    timestamp: Date.now(),
  });
}

export async function triggerSync(): Promise<{ success: boolean; message: string }> {
  try {
    await manualSync();
    return { success: true, message: '同步完成' };
  } catch (e: any) {
    return { success: false, message: e.message || '同步失败' };
  }
}

export async function pullFromCloud(): Promise<boolean> {
  return pullFromServer();
}
