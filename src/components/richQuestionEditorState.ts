export function serializeEditorValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value || { type: 'doc', content: [] });
}

export function enqueueEmission(queue: string[], value: unknown, limit = 8): string[] {
  return [...queue, serializeEditorValue(value)].slice(-limit);
}

export function decideExternalSync(incoming: unknown, current: unknown, pendingEmissions: string[]): { apply: boolean; pendingEmissions: string[] } {
  const next = serializeEditorValue(incoming);
  const present = serializeEditorValue(current);
  const echoIndex = pendingEmissions.lastIndexOf(next);
  if (echoIndex >= 0) return { apply: false, pendingEmissions: pendingEmissions.slice(echoIndex + 1) };
  if (next === present) return { apply: false, pendingEmissions };
  return { apply: true, pendingEmissions: [] };
}

export function clampSelection(selection: { from: number; to: number }, docSize: number): { from: number; to: number } {
  const max = Math.max(1, docSize - 1);
  const from = Math.min(max, Math.max(1, selection.from));
  return { from, to: Math.min(max, Math.max(from, selection.to)) };
}

export function requireStoredAssetRef(assetKey: string, value: string): string {
  const expected = `question-asset://${assetKey}`;
  if (value !== expected) throw new Error('image store returned a mismatched asset reference');
  return value;
}

export async function resolveAssetForDisplay(ref: string, resolver: (value: string) => Promise<string>): Promise<string> {
  if (!ref.startsWith('question-asset://')) throw new Error('image source is not a persisted asset reference');
  const resolved = await resolver(ref);
  if (!resolved) throw new Error('persisted image asset is unavailable');
  return resolved;
}

export function mapPendingPositions(pending: Map<number, number>, mapPosition: (position: number) => number): Map<number, number> {
  return new Map(Array.from(pending, ([sequence, position]) => [sequence, mapPosition(position)]));
}

export type PendingBookmark = { from: number; to: number };
export function mapPendingBookmarks(pending: Map<number, PendingBookmark>, mapPosition: (position: number, assoc: -1 | 1) => number): Map<number, PendingBookmark> {
  return new Map(Array.from(pending, ([sequence, range]) => range.from === range.to
    ? [sequence, { from: mapPosition(range.from, 1), to: mapPosition(range.to, 1) }]
    : [sequence, { from: mapPosition(range.from, -1), to: mapPosition(range.to, 1) }]));
}

export function assetDisplayRef(src: unknown, assetKey: unknown): string {
  return String(src || (assetKey ? `question-asset://${assetKey}` : ''));
}

export type PersistedAssetHtmlPart =
  | { kind: 'html'; html: string }
  | { kind: 'asset'; src: string; alt: string; width?: number };

function imageAttribute(tag: string, name: string): string {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'));
  return match?.[2] || '';
}

export function splitPersistedAssetImages(html: string): PersistedAssetHtmlPart[] {
  const source = String(html || '');
  const parts: PersistedAssetHtmlPart[] = [];
  const pattern = /<img\b[^>]*\bsrc\s*=\s*(["'])(question-asset:\/\/[^"']+)\1[^>]*>/gi;
  let cursor = 0;
  for (const match of source.matchAll(pattern)) {
    const index = match.index || 0;
    if (index > cursor) parts.push({ kind: 'html', html: source.slice(cursor, index) });
    const widthValue = Number(imageAttribute(match[0], 'width'));
    parts.push({
      kind: 'asset',
      src: match[2],
      alt: imageAttribute(match[0], 'alt'),
      ...(Number.isFinite(widthValue) && widthValue > 0 ? { width: widthValue } : {}),
    });
    cursor = index + match[0].length;
  }
  if (cursor < source.length) parts.push({ kind: 'html', html: source.slice(cursor) });
  return parts.length > 0 ? parts : [{ kind: 'html', html: source }];
}

export function replacePersistedAssetImageSources(html: string, resolvedSources: ReadonlyMap<string, string>): string {
  return String(html || '').replace(
    /<img\b[^>]*\bsrc\s*=\s*(["'])(question-asset:\/\/[^"']+)\1[^>]*>/gi,
    (tag, quote: string, ref: string) => {
      const resolved = resolvedSources.get(ref);
      if (!resolved) return '<span role="status">\u56fe\u7247\u52a0\u8f7d\u5931\u8d25</span>';
      return tag.replace(new RegExp(`(\\bsrc\\s*=\\s*)${quote}[^${quote}]*${quote}`, 'i'), `$1${quote}${resolved}${quote}`);
    },
  );
}

export const EDITOR_IMAGE_PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

function mapEditorImageValue(value: any, direction: 'mask' | 'restore'): any {
  if (Array.isArray(value)) return value.map(item => mapEditorImageValue(item, direction));
  if (!value || typeof value !== 'object') return value;
  const next: any = { ...value };
  if (next.type === 'image' && next.attrs && typeof next.attrs === 'object') {
    const attrs = { ...next.attrs };
    if (direction === 'mask' && String(attrs.src || '').startsWith('question-asset://')) {
      attrs.persistedSrc = attrs.src;
      attrs.src = EDITOR_IMAGE_PLACEHOLDER;
    } else if (direction === 'restore' && String(attrs.persistedSrc || '').startsWith('question-asset://')) {
      attrs.src = attrs.persistedSrc;
      delete attrs.persistedSrc;
    }
    next.attrs = attrs;
  }
  for (const [key, item] of Object.entries(next)) {
    if (key !== 'attrs') next[key] = mapEditorImageValue(item, direction);
  }
  return next;
}

export function maskPersistedImagesForEditor<T>(value: T): T {
  if (typeof value !== 'string') return mapEditorImageValue(value, 'mask') as T;
  return value.replace(/<img\b[^>]*\bsrc\s*=\s*(["'])(question-asset:\/\/[^"']+)\1[^>]*>/gi, tag => {
    const ref = imageAttribute(tag, 'src');
    const masked = tag.replace(/(\bsrc\s*=\s*)(["'])[^"']*\2/i, `$1$2${EDITOR_IMAGE_PLACEHOLDER}$2`);
    return masked.replace(/\s*\/?\s*>$/, ending => ` data-persisted-src="${ref}"${ending}`);
  }) as T;
}

export function restorePersistedImagesFromEditor<T>(value: T): T {
  if (typeof value !== 'string') return mapEditorImageValue(value, 'restore') as T;
  return value.replace(/<img\b[^>]*\bdata-persisted-src\s*=\s*(["'])(question-asset:\/\/[^"']+)\1[^>]*>/gi, tag => {
    const ref = imageAttribute(tag, 'data-persisted-src');
    return tag
      .replace(/(\bsrc\s*=\s*)(["'])[^"']*\2/i, `$1$2${ref}$2`)
      .replace(/\s+data-persisted-src\s*=\s*(["']).*?\1/i, '');
  }) as T;
}

export function appendSequentialTask(queue: Promise<void>, task: () => Promise<void>): Promise<void> {
  return queue.then(task, task);
}
