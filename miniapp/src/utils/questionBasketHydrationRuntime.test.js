'use strict';

const assert = require('assert');
const { fetchQuestionPreviewsByIds } = require('./questionBasketHydrationRuntime');

function question(index) {
  return { id: `q-${index}`, stemPreview: `Question ${index}` };
}

(async () => {
  const catalog = Array.from({ length: 455 }, (_value, index) => question(index + 1));
  const calls = [];
  const result = await fetchQuestionPreviewsByIds(['q-405', 'q-12', 'q-405', 'deleted-question'], {
    pageSize: 200,
    fetchPage: async ({ limit, cursor }) => {
      calls.push({ limit, cursor: cursor || null });
      const start = cursor ? Number(cursor) : 0;
      const questions = catalog.slice(start, start + limit);
      const next = start + questions.length;
      return {
        success: true,
        data: {
          questions,
          hasMore: next < catalog.length,
          nextCursor: next < catalog.length ? String(next) : null,
        },
      };
    },
  });

  assert.strictEqual(result.success, true);
  assert.deepStrictEqual(result.questions.map(item => item.id), ['q-405', 'q-12'], 'results must retain basket order, not cloud page order');
  assert.deepStrictEqual(result.unavailableIds, ['deleted-question'], 'an id is unavailable only after the authoritative catalog is exhausted');
  assert.strictEqual(calls.length, 3, 'a valid basket id beyond the first 40/200 questions must be recovered from later pages');
  assert.ok(calls.every(call => call.limit === 200), 'hydration must use the largest supported cloud page');

  const early = await fetchQuestionPreviewsByIds(['q-12'], {
    pageSize: 200,
    fetchPage: async ({ limit }) => ({ success: true, data: { questions: catalog.slice(0, limit), hasMore: true, nextCursor: '200' } }),
  });
  assert.strictEqual(early.success, true);
  assert.strictEqual(early.pagesFetched, 1, 'hydration may stop as soon as every requested id is found');
  assert.deepStrictEqual(early.unavailableIds, []);

  const offline = await fetchQuestionPreviewsByIds(['q-405'], {
    fetchPage: async () => ({ success: false, error: 'offline' }),
  });
  assert.strictEqual(offline.success, false);
  assert.deepStrictEqual(offline.unavailableIds, [], 'network failure must never turn an unresolved id into an unavailable id');
  assert.deepStrictEqual(offline.unresolvedIds, ['q-405']);

  const cursorLoop = await fetchQuestionPreviewsByIds(['q-405'], {
    fetchPage: async () => ({ success: true, data: { questions: [question(1)], hasMore: true, nextCursor: 'same' } }),
  });
  assert.strictEqual(cursorLoop.success, false, 'a broken cursor contract must fail closed instead of looping forever');
  assert.deepStrictEqual(cursorLoop.unavailableIds, []);

  console.log('miniapp question basket cloud hydration checks passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
