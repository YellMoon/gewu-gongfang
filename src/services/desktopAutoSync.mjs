import { readDesktopAuthorizationSession } from './desktopAuthorizationSession.mjs';
import { courseRoomDraftDependencies, draftConfirmationSnapshot } from './authorityDraftDependencies.mjs';

// UTF-8: online edits auto-submit; offline drafts need one aggregate confirmation; conflicts pause auto-sync.

export function draftCreatedOffline(draft) {
  // Historical drafts without a recorded online decision must remain explicit.
  return draft?.createdOffline !== false;
}

export function planDesktopAutoSync(drafts) {
  const list = Array.isArray(drafts) ? drafts : [];
  const awaiting = list.filter(draft => draft?.status === 'awaiting_confirmation');
  const offlineIds = new Set(awaiting.filter(draftCreatedOffline).map(draft => draft.id));
  let blocked = list.some(draft => draft?.status === 'conflict');
  for (const draft of awaiting) {
    try {
      const dependencies = courseRoomDraftDependencies(draft, list);
      if (dependencies.some(item => item.status === 'awaiting_confirmation' && draftCreatedOffline(item))) offlineIds.add(draft.id);
    } catch { blocked = true; }
  }
  return {
    blocked,
    onlineIds: awaiting.filter(draft => !offlineIds.has(draft.id)).map(draft => draft.id),
    offlineIds: awaiting.filter(draft => offlineIds.has(draft.id)).map(draft => draft.id),
    retryIds: list.filter(draft => draft?.status === 'confirmed' || draft?.status === 'submitted').map(draft => draft.id),
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

export async function submitDraftById({ bridge, items, id, sessionToken, approvedIds, shouldContinue = () => true }) {
  const current = await bridge.list();
  if (!shouldContinue()) throw new Error('AUTHORITY_DRAFT_SUBMISSION_STOPPED');
  if (current.some(item => item.status === 'conflict')) throw new Error('AUTHORITY_DRAFT_CONFLICT_PENDING');
  const draft = current.find(item => item.id === id);
  if (!draft) throw new Error('AUTHORITY_DRAFT_CONFIRMATION_CHANGED');
  if (draft.status === 'completed') return { id, skipped: true };
  const confirmation = confirmationForDraft(id, current);
  // Read current dependency status without broadening the content/IDs approved.
  for (const snapshot of confirmation.items) {
    const reviewed = items.find(item => item.id === snapshot.id);
    const fresh = current.find(item => item.id === snapshot.id);
    if (!reviewed || JSON.stringify(draftConfirmationSnapshot([reviewed])[0]) !== JSON.stringify(snapshot)
      || (fresh.status === 'awaiting_confirmation' && !approvedIds.includes(snapshot.id))) {
      throw new Error('AUTHORITY_DRAFT_CONFIRMATION_CHANGED');
    }
  }
  const result = await bridge.confirmAndSubmit(id, { sessionToken }, confirmation);
  return { id, result, rejected: result?.receipt?.status === 'rejected' };
}

export async function submitSequentially({ bridge, items, ids, sessionToken, shouldContinue = () => true }) {
  const outcomes = [];
  for (const id of ids) {
    try {
      if (!shouldContinue()) throw new Error('AUTHORITY_DRAFT_SUBMISSION_STOPPED');
      const outcome = await submitDraftById({ bridge, items, id, sessionToken, approvedIds: ids, shouldContinue });
      outcomes.push(outcome);
      if (outcome.rejected) break;
    } catch (error) {
      outcomes.push({ id, error: error?.code || error?.message || 'SUBMIT_FAILED' });
      break;
    }
  }
  return outcomes;
}
