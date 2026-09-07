import { createAuthorityDraftFromLocalMutation } from './authorityDraftAdapter.mjs';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}

// Compare the same business-field allowlist used for cloud submission, not
// course labels, display metadata, timestamps or JSON object insertion order.
export function sameScheduleDraftContent(left, right) {
  const content = row => createAuthorityDraftFromLocalMutation({
    collection: 'schedules', action: 'update', recordId: row.id, value: row,
  }).payload.changes;
  return JSON.stringify(canonical(content(left))) === JSON.stringify(canonical(content(right)));
}
