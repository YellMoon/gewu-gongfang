'use strict';

const { questionBasketCacheKey } = require('./miniappAuthorizationRuntime');

function paperSelectionCacheKey(scopeKey) {
  return scopeKey ? `question_paper_selection_v1_${encodeURIComponent(scopeKey)}` : '';
}

function normalizeIds(ids) {
  const seen = new Set();
  const normalized = [];
  for (const value of Array.isArray(ids) ? ids : []) {
    const id = typeof value === 'string' ? value.trim() : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    normalized.push(id);
  }
  return normalized;
}

function createQuestionBasketStore(dependencies) {
  const listeners = new Set();
  const questionCache = new Map();
  let current = { scopeKey: null, ids: [], revision: 0, questionRevision: 0 };

  function readStoredIds(scopeKey) {
    if (!scopeKey) return [];
    try {
      return normalizeIds(dependencies.read(scopeKey));
    } catch (_error) {
      return [];
    }
  }

  function notify() {
    for (const listener of Array.from(listeners)) listener();
  }

  function reconcileIdentity() {
    const scopeKey = questionBasketCacheKey(dependencies.readIdentity()) || '';
    if (scopeKey !== current.scopeKey) {
      current = {
        scopeKey,
        ids: readStoredIds(scopeKey),
        revision: current.revision + 1,
        questionRevision: current.questionRevision + 1,
      };
      questionCache.clear();
      notify();
    }
    return snapshot();
  }

  function snapshot() {
    if (current.scopeKey === null) reconcileIdentity();
    return {
      scopeKey: current.scopeKey || '',
      ids: current.ids.slice(),
      revision: current.revision,
      questionRevision: current.questionRevision,
    };
  }

  function writeIds(ids, expectedScopeKey) {
    const beforeWrite = reconcileIdentity();
    if (!beforeWrite.scopeKey || beforeWrite.scopeKey !== expectedScopeKey) {
      return { written: false, reason: 'scope-changed', snapshot: beforeWrite };
    }
    const nextIds = normalizeIds(ids);
    if (nextIds.length === beforeWrite.ids.length
      && nextIds.every((id, index) => id === beforeWrite.ids[index])) {
      return { written: false, reason: 'unchanged', snapshot: beforeWrite };
    }
    const persisted = dependencies.write(beforeWrite.scopeKey, nextIds);
    if (persisted === false) return { written: false, reason: 'persistence-failed', snapshot: beforeWrite };
    current = {
      scopeKey: beforeWrite.scopeKey,
      ids: nextIds,
      revision: beforeWrite.revision + 1,
      questionRevision: beforeWrite.questionRevision,
    };
    notify();
    return { written: true, snapshot: snapshot() };
  }

  function replace(ids, expectedScopeKey) {
    return writeIds(ids, expectedScopeKey);
  }

  function toggle(id) {
    const beforeWrite = reconcileIdentity();
    const normalizedId = typeof id === 'string' ? id.trim() : '';
    if (!normalizedId || !beforeWrite.scopeKey) {
      return { written: false, reason: normalizedId ? 'scope-changed' : 'invalid-id', snapshot: beforeWrite };
    }
    const nextIds = beforeWrite.ids.includes(normalizedId)
      ? beforeWrite.ids.filter(item => item !== normalizedId)
      : beforeWrite.ids.concat(normalizedId);
    return writeIds(nextIds, beforeWrite.scopeKey);
  }

  function removeMany(ids) {
    const beforeWrite = reconcileIdentity();
    const removals = new Set(normalizeIds(ids));
    if (!beforeWrite.scopeKey || removals.size === 0) {
      return { written: false, reason: beforeWrite.scopeKey ? 'no-selection' : 'scope-changed', snapshot: beforeWrite };
    }
    return writeIds(beforeWrite.ids.filter(id => !removals.has(id)), beforeWrite.scopeKey);
  }

  function move(id, offset) {
    const beforeWrite = reconcileIdentity();
    const currentIndex = beforeWrite.ids.indexOf(id);
    const nextIndex = currentIndex + Number(offset || 0);
    if (!beforeWrite.scopeKey || currentIndex < 0 || nextIndex < 0 || nextIndex >= beforeWrite.ids.length) {
      return { written: false, reason: beforeWrite.scopeKey ? 'out-of-range' : 'scope-changed', snapshot: beforeWrite };
    }
    const nextIds = beforeWrite.ids.slice();
    const [moved] = nextIds.splice(currentIndex, 1);
    nextIds.splice(nextIndex, 0, moved);
    return writeIds(nextIds, beforeWrite.scopeKey);
  }

  function clear() {
    const beforeWrite = reconcileIdentity();
    if (!beforeWrite.scopeKey) return { written: false, reason: 'scope-changed', snapshot: beforeWrite };
    return writeIds([], beforeWrite.scopeKey);
  }

  function seedQuestions(questions) {
    const active = reconcileIdentity();
    if (!active.scopeKey) return;
    let changed = false;
    for (const item of Array.isArray(questions) ? questions : []) {
      const id = typeof item?.id === 'string' ? item.id.trim() : '';
      if (!id) continue;
      if (questionCache.get(id) !== item) changed = true;
      questionCache.set(id, item);
    }
    if (changed) {
      current = { ...current, questionRevision: current.questionRevision + 1 };
      notify();
    }
  }

  function replaceQuestions(questions) {
    const active = reconcileIdentity();
    if (!active.scopeKey) return { changed: false, snapshot: active };
    const nextCache = new Map();
    for (const item of Array.isArray(questions) ? questions : []) {
      const id = typeof item?.id === 'string' ? item.id.trim() : '';
      if (id) nextCache.set(id, item);
    }
    let changed = nextCache.size !== questionCache.size;
    if (!changed) {
      for (const [id, item] of nextCache.entries()) {
        if (questionCache.get(id) !== item) {
          changed = true;
          break;
        }
      }
    }
    if (!changed) return { changed: false, snapshot: active };
    questionCache.clear();
    for (const [id, item] of nextCache.entries()) questionCache.set(id, item);
    current = { ...current, questionRevision: current.questionRevision + 1 };
    notify();
    return { changed: true, snapshot: snapshot() };
  }

  function question(id) {
    reconcileIdentity();
    return questionCache.get(id) || null;
  }

  function beginPaper(selectedIds) {
    const active = reconcileIdentity();
    if (!active.scopeKey) return { written: false, reason: 'scope-changed', snapshot: active };
    const requested = new Set(normalizeIds(selectedIds));
    const orderedIds = active.ids.filter(id => requested.has(id));
    if (orderedIds.length === 0) return { written: false, reason: 'no-selection', snapshot: active };
    const unavailableIds = orderedIds.filter(id => !questionCache.has(id));
    if (unavailableIds.length) {
      return { written: false, reason: 'unavailable-questions', unavailableIds, snapshot: active };
    }
    const selection = {
      scopeKey: active.scopeKey,
      selectedIds: orderedIds,
      basketRevision: active.revision,
      createdAt: typeof dependencies.now === 'function' ? dependencies.now() : Date.now(),
    };
    const persisted = dependencies.write(paperSelectionCacheKey(active.scopeKey), selection);
    if (persisted === false) return { written: false, reason: 'persistence-failed', snapshot: active };
    return { written: true, snapshot: active, selection };
  }

  function readPaperSelection() {
    const active = reconcileIdentity();
    if (!active.scopeKey) return null;
    try {
      const stored = dependencies.read(paperSelectionCacheKey(active.scopeKey));
      if (!stored || stored.scopeKey !== active.scopeKey) return null;
      const selectedIds = active.ids.filter(id => normalizeIds(stored.selectedIds).includes(id));
      return {
        scopeKey: active.scopeKey,
        selectedIds,
        basketRevision: Number(stored.basketRevision) || 0,
        createdAt: Number(stored.createdAt) || 0,
      };
    } catch (_error) {
      return null;
    }
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  reconcileIdentity();
  return {
    snapshot,
    subscribe,
    reconcileIdentity,
    replace,
    toggle,
    removeMany,
    move,
    clear,
    seedQuestions,
    replaceQuestions,
    question,
    beginPaper,
    readPaperSelection,
  };
}

module.exports = {
  createQuestionBasketStore,
  paperSelectionCacheKey,
};
