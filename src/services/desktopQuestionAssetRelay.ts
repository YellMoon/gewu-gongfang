import { getQuestionAssetDataUrl, assetKeyFromRef } from './questionAssetStore';
const { createDesktopQuestionImportClient } = require('./desktopQuestionImportClient.mjs');
type AuthorityOutboxItem = {
  id: string;
  type: string;
  payload?: Record<string, any>;
  preview?: Record<string, unknown>;
  status: 'awaiting_confirmation' | 'confirmed' | 'submitted' | 'completed' | 'conflict';
  submission?: { transportUsed?: string } | null;
  receipt?: any;
  conflict?: { code?: string } | null;
};

type AssetRelayState = {
  assetId: string;
  taskId: string;
  objectId: string;
  objectVersion: number;
  status: 'queued' | 'verified' | 'failed';
  updatedAt: string;
  errorCode?: string;
};

const assetRelayStatePrefix = 'gewu.question-asset-relay.v1:';

function questionIdForRelay(item: AuthorityOutboxItem, receipt: any): string {
  const fromReceipt = receipt?.result?.id;
  const payload = item.payload || {};
  const fromPayload = item.type === 'question.create.v1' ? payload?.record?.id : payload?.id;
  const id = String(fromReceipt || fromPayload || '').trim();
  if (!id || id.length > 128) throw new Error('QUESTION_ASSET_RELAY_QUESTION_INVALID');
  return id;
}

function questionAssetKeys(value: unknown): string[] {
  const keys = new Set<string>();
  const seen = new Set<object>();
  const walk = (current: any) => {
    if (typeof current === 'string') {
      for (const match of current.matchAll(/question-asset:\/\/([A-Za-z0-9._-]{1,512})/g)) keys.add(assetKeyFromRef(match[0]));
      return;
    }
    if (!current || typeof current !== 'object' || seen.has(current)) return;
    seen.add(current);
    if (Array.isArray(current)) current.forEach(walk);
    else Object.values(current).forEach(walk);
  };
  walk(value);
  return [...keys].sort();
}

export function hasPendingQuestionAssetVerification(item: AuthorityOutboxItem): boolean {
  if (!/^question\.(create|update)\.v\d+$/.test(item.type)) return false;
  const keys = questionAssetKeys(item.payload || {});
  if (!keys.length) return false;
  let questionId = '';
  try {
    questionId = questionIdForRelay(item, item.receipt);
  } catch (_error) {
    return true;
  }
  return keys.some(assetKey => {
    try {
      const stored = localStorage.getItem(assetRelayStateKey(questionId, assetKey));
      const state = stored ? JSON.parse(stored) as AssetRelayState : null;
      return state?.status !== 'verified';
    } catch (_error) {
      return true;
    }
  });
}

function assetRelayStateKey(questionId: string, assetKey: string): string {
  return `${assetRelayStatePrefix}${encodeURIComponent(questionId)}:${encodeURIComponent(assetKey)}`;
}

export async function refreshQuestionAssetVerification(items: AuthorityOutboxItem[]): Promise<boolean> {
  let changed = false;
  for (const item of items) {
    if (item.status !== 'completed' || !hasPendingQuestionAssetVerification(item)) continue;
    let questionId = '';
    try {
      questionId = questionIdForRelay(item, item.receipt);
    } catch (_error) {
      continue;
    }
    for (const assetKey of questionAssetKeys(item.payload || {})) {
      const stateKey = assetRelayStateKey(questionId, assetKey);
      let state: AssetRelayState | null = null;
      try {
        state = JSON.parse(localStorage.getItem(stateKey) || 'null') as AssetRelayState | null;
      } catch (_error) {
        state = null;
      }
      if (state?.status !== 'queued') continue;
      try {
        const remote = await createDesktopQuestionImportClient().readAssetRelay(state.taskId);
        if (remote.state === 'verified') {
          localStorage.setItem(stateKey, JSON.stringify({
            ...state,
            status: 'verified',
            updatedAt: new Date().toISOString(),
            errorCode: undefined,
          }));
          changed = true;
        }
      } catch (_error) {
        // Polling must never turn a read failure into a new media upload.
      }
    }
  }
  return changed;
}

function freshRelayId(prefix: 'asset' | 'task' | 'obj'): string {
  const raw = globalThis.crypto?.randomUUID?.().replace(/-/g, '') || `${Date.now()}${Math.random()}`.replace(/[^A-Za-z0-9]/g, '');
  return `${prefix}_${raw.slice(0, 120)}`;
}

async function dataUrlBytes(dataUrl: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const match = /^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,([\s\S]*)$/i.exec(dataUrl);
  if (!match) throw new Error('QUESTION_ASSET_RELAY_SOURCE_UNAVAILABLE');
  const mimeType = String(match[1] || 'application/octet-stream').split(';')[0];
  const payload = match[3] || '';
  let bytes: Uint8Array;
  try {
    if (match[2]) {
      const binary = atob(payload.replace(/\s/g, ''));
      bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    } else {
      bytes = new TextEncoder().encode(decodeURIComponent(payload));
    }
  } catch (_error) {
    throw new Error('QUESTION_ASSET_RELAY_SOURCE_INVALID');
  }
  if (!bytes.byteLength || !/^[A-Za-z0-9][A-Za-z0-9!#$&^_.+/-]{0,254}$/.test(mimeType)) throw new Error('QUESTION_ASSET_RELAY_SOURCE_INVALID');
  return { bytes, mimeType };
}

export async function relayQuestionAssetsAfterReceipt(item: AuthorityOutboxItem, receipt: any, shouldContinue = () => true): Promise<number> {
  if (!/^question\.(create|update)\.v\d+$/.test(item.type) || receipt?.status !== 'committed') return 0;
  const questionId = questionIdForRelay(item, receipt);
  const keys = questionAssetKeys(item.payload || {});
  let queued = 0;
  for (const assetKey of keys) {
    if (!shouldContinue()) return queued;
    const stateKey = assetRelayStateKey(questionId, assetKey);
    let state: AssetRelayState | null = null;
    try {
      state = JSON.parse(localStorage.getItem(stateKey) || 'null') as AssetRelayState | null;
    } catch (_error) {
      state = null;
    }
    if (state?.status === 'verified') continue;
    const client = createDesktopQuestionImportClient();
    if (state?.status === 'queued') {
      const remote = await client.readAssetRelay(state.taskId);
      if (remote.state === 'verified') {
        localStorage.setItem(stateKey, JSON.stringify({ ...state, status: 'verified', updatedAt: new Date().toISOString(), errorCode: undefined }));
        continue;
      }
      if (remote.state === 'queued' || remote.state === 'leased') {
        queued += 1;
        continue;
      }
      state = { ...state, status: 'failed', updatedAt: new Date().toISOString(), errorCode: `QUESTION_ASSET_RELAY_${remote.state.toUpperCase()}` };
      localStorage.setItem(stateKey, JSON.stringify(state));
    }
    const nextState: AssetRelayState = state && state.status !== 'failed' && state.assetId && state.taskId && state.objectId
      ? { ...state, status: 'failed', updatedAt: new Date().toISOString() }
      : { assetId: freshRelayId('asset'), taskId: freshRelayId('task'), objectId: freshRelayId('obj'), objectVersion: 1, status: 'failed', updatedAt: new Date().toISOString() };
    try {
      const dataUrl = await getQuestionAssetDataUrl(assetKey);
      const source = await dataUrlBytes(dataUrl);
      if (!shouldContinue()) return queued;
      await client.relayAsset({
        questionId, assetId: nextState.assetId, assetType: source.mimeType.startsWith('image/') ? 'image' : 'attachment',
        fileName: `${assetKey.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 480) || 'asset'}.bin`, mimeType: source.mimeType,
        bytes: source.bytes, storage: { taskId: nextState.taskId, objectId: nextState.objectId, objectVersion: nextState.objectVersion },
      });
      localStorage.setItem(stateKey, JSON.stringify({ ...nextState, status: 'queued', updatedAt: new Date().toISOString(), errorCode: undefined }));
      queued += 1;
    } catch (error: any) {
      localStorage.setItem(stateKey, JSON.stringify({ ...nextState, status: 'failed', updatedAt: new Date().toISOString(), errorCode: error?.code || error?.message || 'QUESTION_ASSET_RELAY_FAILED' }));
      throw error;
    }
  }
  return queued;
}

