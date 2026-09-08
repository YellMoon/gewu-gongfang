// UTF-8: a derived record may include unfinished local edits; never confirm them here.
export async function hasPendingBusinessDraft(bridge, entity, recordId) {
  if (!recordId) return false;
  const types = new Set(['create', 'update', 'delete'].map(action => `${entity}.${action}.v1`));
  return (await bridge?.list?.() || []).some(item => types.has(item.type)
    && item.status !== 'completed' && (item.payload?.record?.id || item.payload?.id) === recordId);
}
