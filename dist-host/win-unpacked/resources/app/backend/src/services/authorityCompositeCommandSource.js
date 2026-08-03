function sourceError(code) {
  return Object.assign(new Error(code), { code });
}

function createAuthorityCompositeCommandSource({ sources = [] } = {}) {
  const entries = sources.map(entry => ({
    id: String(entry?.id || '').trim(),
    source: entry?.source,
  }));
  if (entries.length === 0 || entries.some(entry => !entry.id
    || typeof entry.source?.claim !== 'function'
    || typeof entry.source?.renew !== 'function'
    || typeof entry.source?.publishReceipt !== 'function')) {
    throw sourceError('AUTHORITY_COMPOSITE_SOURCE_INVALID');
  }
  const byId = new Map(entries.map(entry => [entry.id, entry.source]));

  function select(sourceId) {
    const source = byId.get(String(sourceId || ''));
    if (!source) throw sourceError('AUTHORITY_COMMAND_SOURCE_UNKNOWN');
    return source;
  }

  return Object.freeze({
    async claim(input = {}) {
      const claimed = [];
      const failures = [];
      for (const entry of entries) {
        const remaining = Math.max(0, Number(input.limit || 0) - claimed.length);
        if (remaining === 0) break;
        try {
          const commands = await entry.source.claim({ ...input, limit: remaining });
          for (const command of Array.isArray(commands) ? commands : []) {
            claimed.push(Object.freeze({ ...command, sourceId: entry.id }));
          }
        } catch (error) {
          failures.push(error);
        }
      }
      if (claimed.length === 0 && failures.length === entries.length) throw failures[0];
      return Object.freeze(claimed);
    },
    renew(input = {}) {
      return select(input.sourceId).renew(input);
    },
    publishReceipt(receipt, claim = {}) {
      return select(claim.sourceId).publishReceipt(receipt, claim);
    },
  });
}

module.exports = { createAuthorityCompositeCommandSource, sourceError };
