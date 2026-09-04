'use strict';

function normalizeIds(ids) {
  const seen = new Set();
  const result = [];
  for (const value of Array.isArray(ids) ? ids : []) {
    const id = typeof value === 'string' ? value.trim() : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

async function fetchQuestionPreviewsByIds(ids, dependencies) {
  const requestedIds = normalizeIds(ids);
  if (!requestedIds.length) {
    return { success: true, questions: [], unavailableIds: [], unresolvedIds: [], pagesFetched: 0 };
  }
  if (!dependencies || typeof dependencies.fetchPage !== 'function') {
    return { success: false, questions: [], unavailableIds: [], unresolvedIds: requestedIds, pagesFetched: 0, error: 'Question preview fetcher is unavailable' };
  }

  const pageSize = Number.isInteger(dependencies.pageSize)
    ? Math.max(1, Math.min(200, dependencies.pageSize))
    : 200;
  const wanted = new Set(requestedIds);
  const found = new Map();
  const seenCursors = new Set();
  let cursor = null;
  let pagesFetched = 0;

  while (wanted.size) {
    let page;
    try {
      page = await dependencies.fetchPage({ limit: pageSize, ...(cursor ? { cursor } : {}) });
    } catch (error) {
      return {
        success: false,
        questions: requestedIds.filter(id => found.has(id)).map(id => found.get(id)),
        unavailableIds: [],
        unresolvedIds: requestedIds.filter(id => !found.has(id)),
        pagesFetched,
        error: error && error.message ? error.message : 'Question preview request unavailable',
      };
    }
    pagesFetched += 1;
    const questions = Array.isArray(page?.data?.questions) ? page.data.questions : [];
    if (!page?.success) {
      return {
        success: false,
        questions: requestedIds.filter(id => found.has(id)).map(id => found.get(id)),
        unavailableIds: [],
        unresolvedIds: requestedIds.filter(id => !found.has(id)),
        pagesFetched,
        error: page?.error || 'Question preview request unavailable',
      };
    }
    for (const question of questions) {
      const id = typeof question?.id === 'string' ? question.id.trim() : '';
      if (!wanted.has(id)) continue;
      found.set(id, question);
      wanted.delete(id);
    }
    if (!wanted.size) break;
    if (page.data?.hasMore !== true) {
      return {
        success: true,
        questions: requestedIds.filter(id => found.has(id)).map(id => found.get(id)),
        unavailableIds: requestedIds.filter(id => !found.has(id)),
        unresolvedIds: [],
        pagesFetched,
      };
    }
    const nextCursor = typeof page.data?.nextCursor === 'string' ? page.data.nextCursor.trim() : '';
    if (!nextCursor || seenCursors.has(nextCursor)) {
      return {
        success: false,
        questions: requestedIds.filter(id => found.has(id)).map(id => found.get(id)),
        unavailableIds: [],
        unresolvedIds: requestedIds.filter(id => !found.has(id)),
        pagesFetched,
        error: 'Question preview pagination is incomplete',
      };
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  return {
    success: true,
    questions: requestedIds.map(id => found.get(id)).filter(Boolean),
    unavailableIds: [],
    unresolvedIds: [],
    pagesFetched,
  };
}

module.exports = {
  fetchQuestionPreviewsByIds,
  normalizeIds,
};
