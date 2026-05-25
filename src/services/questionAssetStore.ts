const DB_NAME = 'question_asset_store_v1';
const STORE_NAME = 'assets';
const REF_PREFIX = 'question-asset://';

type StoredAsset = {
  key: string;
  dataUrl: string;
  updatedAt: string;
};

let dbPromise: Promise<IDBDatabase> | null = null;
const dataUrlCache = new Map<string, string>();

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
  });
  return dbPromise;
}

export function assetRef(key?: string): string {
  return key ? `${REF_PREFIX}${key}` : '';
}

export function isAssetRef(value?: string): boolean {
  return String(value || '').startsWith(REF_PREFIX);
}

export function assetKeyFromRef(value?: string): string {
  const text = String(value || '');
  return text.startsWith(REF_PREFIX) ? text.slice(REF_PREFIX.length) : text;
}

export async function storeQuestionAsset(key: string, dataUrl: string): Promise<string> {
  if (!key || !dataUrl?.startsWith('data:')) return dataUrl;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({ key, dataUrl, updatedAt: new Date().toISOString() } satisfies StoredAsset);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  dataUrlCache.set(key, dataUrl);
  return assetRef(key);
}

export async function getQuestionAssetDataUrl(keyOrRef: string): Promise<string> {
  const key = assetKeyFromRef(keyOrRef);
  if (!key) return '';
  const cached = dataUrlCache.get(key);
  if (cached) return cached;
  const db = await openDb();
  const result = await new Promise<StoredAsset | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result as StoredAsset | undefined);
    request.onerror = () => reject(request.error);
  });
  if (result?.dataUrl) dataUrlCache.set(key, result.dataUrl);
  return result?.dataUrl || '';
}

export async function prepareQuestionAssetsForStorage<T extends Record<string, any>>(question: T): Promise<T> {
  const next: any = JSON.parse(JSON.stringify(question || {}));
  const assets = Array.isArray(next.assets) ? next.assets : [];
  const hashText = (value: string): string => {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return `inline-${(hash >>> 0).toString(16)}-${value.length}`;
  };
  const inlineDataUrls = new Set<string>();
  const collectInlineAssets = (value: any) => {
    if (typeof value === 'string') {
      for (const match of value.matchAll(/<img\b[^>]*\bsrc=["'](data:[^"']+)["'][^>]*>/gi)) {
        inlineDataUrls.add(match[1]);
      }
    } else if (Array.isArray(value)) {
      value.forEach(item => {
        if (typeof item === 'string') collectInlineAssets(item);
        else if (item && typeof item === 'object') collectInlineAssets(item.content || item.text || '');
      });
    }
  };
  ['content', 'stem', 'answer', 'analysis'].forEach(field => collectInlineAssets(next[field]));
  collectInlineAssets(next.options);
  inlineDataUrls.forEach(dataUrl => {
    if (!assets.some((asset: any) => [asset?.data_url, asset?.url, asset?.oss_url].includes(dataUrl))) {
      assets.push({
        asset_type: 'image',
        file_name: `${hashText(dataUrl)}.png`,
        content_hash: hashText(dataUrl),
        data_url: dataUrl,
      });
    }
  });
  next.assets = assets;
  for (const asset of assets) {
    const dataUrl = asset?.data_url || asset?.url || asset?.oss_url;
    const key = asset?.content_hash || asset?.id || asset?.file_name;
    if (key && typeof dataUrl === 'string' && dataUrl.startsWith('data:')) {
      const ref = await storeQuestionAsset(key, dataUrl);
      for (const field of ['content', 'stem', 'answer', 'analysis']) {
        if (typeof next[field] === 'string') next[field] = next[field].split(dataUrl).join(ref);
      }
      if (Array.isArray(next.options)) {
        next.options = next.options.map((option: any) => {
          if (typeof option === 'string') return option.split(dataUrl).join(ref);
          if (option && typeof option === 'object') {
            const copy = { ...option };
            if (typeof copy.content === 'string') copy.content = copy.content.split(dataUrl).join(ref);
            if (typeof copy.text === 'string') copy.text = copy.text.split(dataUrl).join(ref);
            return copy;
          }
          return option;
        });
      }
      asset.data_url = ref;
      if (asset.url === dataUrl) asset.url = ref;
      if (asset.oss_url === dataUrl) asset.oss_url = ref;
    }
  }
  return next;
}

export function stripQuestionAssetPayload<T extends Record<string, any>>(question: T): T {
  const next: any = JSON.parse(JSON.stringify(question || {}));
  const assets = Array.isArray(next.assets) ? next.assets : [];
  for (const asset of assets) {
    if (typeof asset?.data_url === 'string' && asset.data_url.startsWith('data:')) asset.data_url = assetRef(asset.content_hash || asset.id || asset.file_name);
    if (typeof asset?.url === 'string' && asset.url.startsWith('data:')) asset.url = assetRef(asset.content_hash || asset.id || asset.file_name);
    if (typeof asset?.oss_url === 'string' && asset.oss_url.startsWith('data:')) asset.oss_url = assetRef(asset.content_hash || asset.id || asset.file_name);
  }
  for (const field of ['content', 'stem', 'answer', 'analysis']) {
    if (typeof next[field] === 'string') next[field] = next[field].replace(/data:[^"'\s>]+/g, '');
  }
  if (Array.isArray(next.options)) {
    next.options = next.options.map((option: any) => {
      if (typeof option === 'string') return option.replace(/data:[^"'\s>]+/g, '');
      if (option && typeof option === 'object') {
        const copy = { ...option };
        if (typeof copy.content === 'string') copy.content = copy.content.replace(/data:[^"'\s>]+/g, '');
        if (typeof copy.text === 'string') copy.text = copy.text.replace(/data:[^"'\s>]+/g, '');
        return copy;
      }
      return option;
    });
  }
  return next;
}
