import presentation from '../components/authorityDraftPresentation.js';
const { describeAuthorityDraft } = presentation;
export async function describePendingChanges(items, cache = {}, loadProjection = async () => ({})) {
  const descriptions = {};
  let projection;
  for (const item of items) {
    let description = describeAuthorityDraft(item, cache);
    if (/^(student|teacher|course|schedule|room|institution|school|payment|consumption|grade|personal-asset-record|personal-asset-category)\.delete\./.test(item.type)) {
      const identified = value => value.details.some(detail => ['\u540d\u79f0', '\u8bfe\u7a0b', '\u5b66\u751f', '\u5206\u7c7b'].includes(detail.label));
      if (!identified(description)) {
        try {
          if (!projection) projection = await loadProjection();
          description = describeAuthorityDraft(item, projection || {});
        } catch { /* Never confirm an unidentified deletion. */ }
        if (!identified(description)) description = { ...description, blocked: true };
      }
    }
    descriptions[item.id] = description;
  }
  return descriptions;
}
