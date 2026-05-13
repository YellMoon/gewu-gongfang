import type { SyncBatch } from "./syncEngine";

const BASE_URL = (process.env.REACT_APP_API_BASE || '').replace(/\/$/, '');

export async function pushSyncBatch(batch: SyncBatch): Promise<{ success: boolean; serverTimestamp: number }>{
  try {
    const res = await fetch(`${BASE_URL}/sync/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batch),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    console.error('[syncApi] push error:', e);
    return { success: false, serverTimestamp: Date.now() };
  }
}

export async function pullSyncOps(sinceTs: number): Promise<{ success: boolean; operations: any[]; serverTimestamp: number }>{
  try {
    const res = await fetch(`${BASE_URL}/sync/pull?since=${sinceTs}`, { method: 'GET' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    console.error('[syncApi] pull error:', e);
    return { success: false, operations: [], serverTimestamp: Date.now() };
  }
}
