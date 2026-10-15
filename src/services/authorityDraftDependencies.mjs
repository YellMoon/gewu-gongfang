// Only local draft relationships; no network access or implicit confirmation.
export function courseRoomDraftDependencies(draft, items) {
  if (/^schedule\.(update|delete)\.v1$/.test(draft?.type || '') && (draft.baseDraftId || !draft.payload?.expectedVersion)) {
    const index = items.findIndex(item => item.id === draft.id);
    const earlier = items.slice(0, Math.max(0, index));
    const matches = earlier.filter(item => (draft.baseDraftId ? item.id === draft.baseDraftId : item.type === 'schedule.create.v1')
      && item.payload?.record?.id === draft.payload?.id && item.status !== 'completed'
      && item.draftScope?.userId === draft.draftScope?.userId
      && item.draftScope?.businessAuthority === draft.draftScope?.businessAuthority
      && item.draftScope?.activeRole === draft.draftScope?.activeRole);
    if (draft.baseDraftId) {
      const base = earlier.find(item => item.id === draft.baseDraftId);
      if (!base || (base.payload?.record?.id || base.payload?.id) !== draft.payload.id
        || base.draftScope?.userId !== draft.draftScope?.userId || base.draftScope?.activeRole !== draft.draftScope?.activeRole
        || base.draftScope?.businessAuthority !== draft.draftScope?.businessAuthority || base.status === 'conflict') {
        throw Object.assign(new Error('AUTHORITY_DRAFT_DEPENDENCY_BLOCKED'), { code: 'AUTHORITY_DRAFT_DEPENDENCY_BLOCKED' });
      }
      return base.status === 'completed' ? [] : [base];
    }
    return matches;
  }
  if (!/^course\.(create|update)\.v1$/.test(draft?.type || '')) return [];
  const roomId = (draft.payload?.record || draft.payload?.changes)?.room_id;
  if (!roomId) return [];
  const matches = items.filter(item => item.type === 'room.create.v1'
    && item.payload?.record?.id === roomId && item.status !== 'completed'
    && item.draftScope?.userId === draft.draftScope?.userId
    && item.draftScope?.businessAuthority === draft.draftScope?.businessAuthority);
  if (matches.length > 1 || matches.some(item => item.status === 'conflict')) {
    throw Object.assign(new Error('AUTHORITY_DRAFT_DEPENDENCY_BLOCKED'), { code: 'AUTHORITY_DRAFT_DEPENDENCY_BLOCKED' });
  }
  return matches;
}

export function draftConfirmationSnapshot(items) {
  return items.map(({ id, type, payload }) => ({ id, type, payload: JSON.parse(JSON.stringify(payload)) }));
}
