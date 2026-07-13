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

export function appendSequentialTask(queue: Promise<void>, task: () => Promise<void>): Promise<void> {
  return queue.then(task, task);
}
