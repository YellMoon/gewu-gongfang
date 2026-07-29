import Taro from '@tarojs/taro';
import { PendingChange, SyncTable } from '../types';
import {
  getPendingChanges,
  getLastSyncTimestamp,
  setLastSyncTimestamp,
  getCachedList,
  setCachedList,
  onNetworkChange,
} from './storage';
import { getApiBaseUrl } from './api';
import { authSessionRuntime } from './authSession';
import { createSessionBoundOperation } from './miniappApiSessionRuntime';
import { projectionCacheEntries, projectionCacheTables } from './authorityProjectionCache';

type SyncCallback = (info: { type: 'confirm'; count: number; changes: PendingChange[] } | { type: 'done'; success: boolean; message: string }) => void;

let syncCallback: SyncCallback | null = null;

export function setSyncCallback(callback: SyncCallback): void {
  syncCallback = callback;
}

function timestamp(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Date.now();
}

async function requestAuthorityProjection(): Promise<any> {
  const sessionBoundary = createSessionBoundOperation(authSessionRuntime);
  const response = await sessionBoundary.run((requestSession: any) => Taro.request({
    url: `${getApiBaseUrl()}/api/miniapp/projection`,
    method: 'GET',
    header: {
      'Content-Type': 'application/json',
      Authorization: requestSession.token ? `Bearer ${requestSession.token}` : '',
    },
    timeout: 30000,
  }));
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`HTTP ${response.statusCode}`);
  }
  return response.data;
}

function applyAuthorityProjection(projection: any): void {
  const payload = projection?.payload;
  if (!payload || typeof payload !== 'object') {
    throw new Error('AUTHORITY_PROJECTION_PAYLOAD_REQUIRED');
  }
  for (const table of projectionCacheTables) setCachedList(table as SyncTable, []);
  for (const [table, rows] of projectionCacheEntries(payload)) {
    setCachedList(table as SyncTable, rows);
  }
  setLastSyncTimestamp(timestamp(projection.generatedAt || projection.generated_at));
}

async function pullFromAuthority(): Promise<boolean> {
  try {
    const data = await requestAuthorityProjection();
    const projection = data?.projection || data?.data?.projection;
    if (!data?.success || !projection) return false;
    applyAuthorityProjection(projection);
    syncCallback?.({ type: 'done', success: true, message: 'AUTHORITY_PROJECTION_REFRESHED' });
    return true;
  } catch (error: any) {
    console.error('[AuthorityProjection] refresh failed:', error);
    syncCallback?.({ type: 'done', success: false, message: error?.message || 'AUTHORITY_PROJECTION_REFRESH_FAILED' });
    return false;
  }
}

function notifyPendingAuthorityHost(pending: PendingChange[]): void {
  syncCallback?.({ type: 'confirm', count: pending.length, changes: pending });
  Taro.showModal({
    title: 'Authority host required',
    content: `${pending.length} pending core changes must be reviewed and submitted by the authorized desktop host.`,
    showCancel: false,
  });
}

export function initSyncManager(): void {
  const pending = getPendingChanges();
  if (pending.length > 0) notifyPendingAuthorityHost(pending);
  onNetworkChange((network) => {
    if (!network.isConnected) return;
    const pendingNow = getPendingChanges();
    if (pendingNow.length > 0) {
      notifyPendingAuthorityHost(pendingNow);
      return;
    }
    void pullFromAuthority();
  });
}

export async function manualSync(): Promise<boolean> {
  const pending = getPendingChanges();
  if (pending.length > 0) {
    notifyPendingAuthorityHost(pending);
    return false;
  }
  return pullFromAuthority();
}

export function getLocalData<T>(table: SyncTable): T[] {
  return getCachedList<T>(table);
}

export function getLocalItem<T extends { id: string }>(table: SyncTable, id: string): T | undefined {
  return getCachedList<T>(table).find((item: T) => item.id === id);
}

function rejectLegacyCoreMutation(): never {
  throw new Error('MINIAPP_CORE_EDIT_REQUIRES_AUTHORITY_HOST');
}

export function updateLocalItem<T extends { id: string }>(_table: SyncTable, _item: T): void {
  rejectLegacyCoreMutation();
}

export function addLocalItem<T extends { id: string }>(_table: SyncTable, _item: T): void {
  rejectLegacyCoreMutation();
}

export function removeLocalItem(_table: SyncTable, _id: string): void {
  rejectLegacyCoreMutation();
}

export async function triggerSync(): Promise<{ success: boolean; message: string }> {
  const success = await manualSync();
  return {
    success,
    message: success ? 'AUTHORITY_PROJECTION_REFRESHED' : 'AUTHORITY_HOST_REVIEW_REQUIRED',
  };
}

export async function pullFromCloud(): Promise<boolean> {
  return pullFromAuthority();
}

export { applyAuthorityProjection };
