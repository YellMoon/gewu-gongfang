import { readDesktopAuthorizationSession } from './desktopAuthorizationSession.mjs';
import { courseRoomDraftDependencies, draftConfirmationSnapshot } from './authorityDraftDependencies.mjs';

// UTF-8: online edits auto-submit; offline drafts need one aggregate confirmation; conflicts pause auto-sync.

export function draftCreatedOffline(draft) {
  return draft?.createdOffline === true;
}

export function planDesktopAutoSync(drafts) {
  const awaiting = (Array.isArray(drafts) ? drafts : []).filter(draft => draft?.status === 'awaiting_confirmation');
  return {
    blocked: (Array.isArray(drafts) ? drafts : []).some(draft => draft?.status === 'conflict'),
    onlineIds: awaiting.filter(draft => !draftCreatedOffline(draft)).map(draft => draft.id),
    offlineIds: awaiting.filter(draftCreatedOffline).map(draft => draft.id),
  };
}

export function sessionTokenFromStore() {
  const session = readDesktopAuthorizationSession();
  const match = /^Bearer (.+)$/.exec(session?.authorization || '');
  if (!match) throw Object.assign(new Error('DESKTOP_CLOUD_SESSION_REQUIRED'), { code: 'DESKTOP_CLOUD_SESSION_REQUIRED' });
  return match[1];
}

export function confirmationForDraft(id, items) {
  const item = (items || []).find(candidate => candidate.id === id);
  if (!item) return null;
  return { items: draftConfirmationSnapshot([...courseRoomDraftDependencies(item, items), item]) };
}

export async function submitDraftById({ bridge, items, id, sessionToken }) {
  const confirmation = confirmationForDraft(id, items);
  if (!confirmation) return { id, skipped: true };
  const result = await bridge.confirmAndSubmit(id, { sessionToken }, confirmation);
  return { id, result, rejected: result?.receipt?.status === 'rejected' };
}

export async function submitSequentially({ bridge, items, ids, sessionToken }) {
  const outcomes = [];
  for (const id of ids) {
    try {
      const outcome = await submitDraftById({ bridge, items, id, sessionToken });
      outcomes.push(outcome);
      if (outcome.rejected) break;
    } catch (error) {
      outcomes.push({ id, error: error?.code || error?.message || 'SUBMIT_FAILED' });
      break;
    }
  }
  return outcomes;
}
