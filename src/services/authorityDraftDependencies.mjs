// Only local draft relationships; no network access or implicit confirmation.
export function courseRoomDraftDependencies(draft, items) {
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
