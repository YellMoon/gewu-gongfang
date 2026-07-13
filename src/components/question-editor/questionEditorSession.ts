export type SaveAttempt = { ok: true } | { ok: false; error: unknown };
export type SaveGateAttempt = ({ ok: true } | { ok: false; error: unknown }) & { owned: boolean };

export function shouldProtectEditorExit(open: boolean, dirty: boolean): boolean {
  return open && dirty;
}

const spaExitGuards = new Set<() => boolean>();
export function registerEditorSpaExitGuard(guard: () => boolean): () => void {
  spaExitGuards.add(guard);
  return () => spaExitGuards.delete(guard);
}
export function confirmEditorSpaExit(confirmExit: () => boolean): boolean {
  return !Array.from(spaExitGuards).some(guard => guard()) || confirmExit();
}
export function requestEditorSpaNavigation(applyNavigation: () => void, confirmExit: () => boolean): boolean {
  if (!confirmEditorSpaExit(confirmExit)) return false;
  applyNavigation();
  return true;
}
export function mergeImportedQuestionMetadata(original: Record<string, any>, edited: Record<string, any>): Record<string, any> {
  return { ...original, ...edited };
}

export type RichDirtySnapshot = { dirty: boolean; changed: boolean; version: number };

function canonicalRichValue(value: unknown): string {
  const normalize = (entry: any): any => {
    if (Array.isArray(entry)) return entry.map(normalize);
    if (!entry || typeof entry !== 'object') return entry;
    return Object.keys(entry).sort().reduce((result, key) => {
      const raw = entry[key];
      if (raw === undefined || raw === null) return result;
      if (key === 'content' && Array.isArray(raw) && raw.length === 0) return result;
      if (key === 'attrs' && raw && typeof raw === 'object') {
        const attrs = Object.keys(raw).sort().reduce((next, attrKey) => {
          const attrValue = raw[attrKey];
          if (attrValue === undefined || attrValue === null) return next;
          if (entry.type === 'image' && attrKey === 'align' && attrValue === 'center') return next;
          if ((entry.type === 'paragraph' || entry.type === 'heading') && attrKey === 'indent' && attrValue === 0) return next;
          next[attrKey] = normalize(attrValue);
          return next;
        }, {} as Record<string, any>);
        if (Object.keys(attrs).length > 0) result[key] = attrs;
        return result;
      }
      result[key] = normalize(raw);
      return result;
    }, {} as Record<string, any>);
  };
  return JSON.stringify(normalize(value ?? null));
}

export function createRichDocumentDirtyCoordinator(initial: unknown) {
  let baseline = canonicalRichValue(initial);
  let current = baseline;
  let version = 1;
  const snapshot = (changed = false): RichDirtySnapshot => ({ dirty: current !== baseline, changed, version });
  return {
    snapshot: () => snapshot(),
    reset(value: unknown): RichDirtySnapshot {
      baseline = canonicalRichValue(value);
      current = baseline;
      version += 1;
      return snapshot(true);
    },
    update(value: unknown): RichDirtySnapshot {
      const next = canonicalRichValue(value);
      if (next === current) return snapshot(false);
      current = next;
      version += 1;
      return snapshot(true);
    },
    markSaved(value?: unknown): RichDirtySnapshot {
      if (value !== undefined) {
        const next = canonicalRichValue(value);
        if (next !== current) {
          current = next;
          version += 1;
        }
      }
      baseline = current;
      return snapshot(false);
    },
  };
}

export async function runQuestionEditorSave(save: () => Promise<void>): Promise<SaveAttempt> {
  try {
    await save();
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}
export function createQuestionEditorSaveGate() {
  let active = false;
  return async (save: () => Promise<void>): Promise<SaveGateAttempt> => {
    if (active) return { ok: false, error: new Error('SAVE_IN_PROGRESS'), owned: false };
    active = true;
    try { return { ...(await runQuestionEditorSave(save)), owned: true }; } finally { active = false; }
  };
}

export async function persistRemoteThenLocal(
  remote: () => Promise<{ ok: boolean; json: () => Promise<any> }>,
  local: () => void | Promise<void>,
): Promise<void> {
  const response = await remote();
  let payload: any = null;
  try { payload = await response.json(); } catch (_error) { payload = null; }
  if (!response.ok || payload?.success !== true) throw new Error(payload?.error || `REMOTE_SAVE_FAILED_${response.ok ? 'PAYLOAD' : 'HTTP'}`);
  await local();
}

export function nextDirtyState(current: boolean, event: 'load' | 'change' | 'save-success' | 'save-failure'): boolean {
  if (event === 'load' || event === 'save-success') return false;
  if (event === 'change' || event === 'save-failure') return event === 'save-failure' ? current : true;
  return current;
}
