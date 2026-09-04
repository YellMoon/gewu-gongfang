import { SyncTable } from '../types';
import {
  setLastSyncTimestamp,
  getCachedList,
  setCachedList,
  onNetworkChange,
} from './storage';
import { miniappCloudBusinessApi } from './api';
import { authSessionRuntime } from './authSession';
import { createCloudBusinessProjectionRuntime } from './cloudBusinessProjection';

type SyncCallback = (info: { type: 'done'; success: boolean; message: string }) => void;

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

const cloudBusinessProjectionRuntime = createCloudBusinessProjectionRuntime({
  readProjection: miniappCloudBusinessApi.readBusinessProjection,
  writeCache: (table: SyncTable, rows: any[]) => setCachedList(table, rows),
});

export async function pullFromCloudBusinessProjection(): Promise<boolean> {
  try {
    const session = authSessionRuntime.capture();
    await cloudBusinessProjectionRuntime.refresh(session.token, () => authSessionRuntime.isSameSession(session));
    setLastSyncTimestamp(timestamp(Date.now()));
    syncCallback?.({ type: 'done', success: true, message: 'CLOUD_BUSINESS_PROJECTION_REFRESHED' });
    return true;
  } catch (error: any) {
    console.error('[CloudBusinessProjection] refresh failed:', error);
    syncCallback?.({ type: 'done', success: false, message: error?.message || 'CLOUD_BUSINESS_PROJECTION_REFRESH_FAILED' });
    return false;
  }
}

export function initSyncManager(): void {
  onNetworkChange((network) => {
    if (!network.isConnected) return;
    void pullFromCloudBusinessProjection();
  });
}

export async function manualSync(): Promise<boolean> {
  return pullFromCloudBusinessProjection();
}

export function getLocalData<T>(table: SyncTable): T[] {
  return getCachedList<T>(table);
}

export function getLocalItem<T extends { id: string }>(table: SyncTable, id: string): T | undefined {
  return getCachedList<T>(table).find((item: T) => item.id === id);
}

function rejectLegacyCoreMutation(): never {
  throw new Error('MINIAPP_CORE_EDIT_REQUIRES_CLOUD_AUTHORITY');
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
    message: success ? 'CLOUD_BUSINESS_PROJECTION_REFRESHED' : 'CLOUD_BUSINESS_PROJECTION_UNAVAILABLE',
  };
}

export async function pullFromCloud(): Promise<boolean> {
  return pullFromCloudBusinessProjection();
}
