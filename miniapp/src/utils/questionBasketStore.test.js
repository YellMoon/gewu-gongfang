'use strict';

const assert = require('assert');
const { createQuestionBasketStore, paperSelectionCacheKey } = require('./questionBasketStoreRuntime');

const teacherA = { id: 'account-a', role: 'teacher', tenant_id: 'tenant-a', teacher_id: 'teacher-a' };
const teacherB = { id: 'account-b', role: 'teacher', tenant_id: 'tenant-b', teacher_id: 'teacher-b' };
let identity = teacherA;
const persisted = new Map();
let now = 1000;
const store = createQuestionBasketStore({
  readIdentity: () => identity,
  read: key => persisted.get(key),
  write: (key, value) => persisted.set(key, JSON.parse(JSON.stringify(value))),
  now: () => now,
});

let notifications = 0;
const unsubscribe = store.subscribe(() => { notifications += 1; });
const initial = store.snapshot();
assert.ok(initial.scopeKey, 'a formal teacher must receive an account-isolated basket scope');
assert.deepStrictEqual(initial.ids, []);

assert.strictEqual(store.toggle('q-2').written, true);
assert.strictEqual(store.toggle('q-1').written, true);
assert.strictEqual(store.toggle('q-2').written, true);
assert.deepStrictEqual(store.snapshot().ids, ['q-1'], 'toggle must preserve order and remove an existing question');
store.replace(['q-2', 'q-1', 'q-2'], store.snapshot().scopeKey);
assert.deepStrictEqual(store.snapshot().ids, ['q-2', 'q-1'], 'replace must deduplicate without reordering');
store.move('q-1', -1);
assert.deepStrictEqual(store.snapshot().ids, ['q-1', 'q-2']);
assert.strictEqual(store.move('q-1', -1).written, false, 'moving past the first item must be a no-op');

const beforeSeedNotifications = notifications;
store.seedQuestions([{ id: 'q-1', stemPreview: 'first' }, { id: 'q-2', stemPreview: 'second' }]);
assert.strictEqual(store.question('q-1').stemPreview, 'first');
assert.ok(notifications > beforeSeedNotifications, 'late question metadata must update an already mounted basket drawer');
const beforeCatalogReplaceNotifications = notifications;
store.replaceQuestions([{ id: 'q-2', stemPreview: 'second-updated' }]);
assert.strictEqual(store.question('q-1'), null, 'an authoritative cloud catalog refresh must prune stale question metadata');
assert.deepStrictEqual(store.snapshot().ids, ['q-1', 'q-2'], 'catalog pruning must retain the basket id so the user can remove an unavailable question');
assert.ok(notifications > beforeCatalogReplaceNotifications, 'catalog pruning must refresh every mounted basket view');
const unavailableHandoff = store.beginPaper(['q-1']);
assert.strictEqual(unavailableHandoff.written, false, 'an unavailable question must never be silently omitted from a paper');
assert.strictEqual(unavailableHandoff.reason, 'unavailable-questions');
assert.deepStrictEqual(unavailableHandoff.unavailableIds, ['q-1']);
now = 2000;
const handoff = store.beginPaper(['q-2']);
assert.strictEqual(handoff.written, true);
assert.deepStrictEqual(store.readPaperSelection().selectedIds, ['q-2']);
assert.deepStrictEqual(persisted.get(paperSelectionCacheKey(initial.scopeKey)).selectedIds, ['q-2']);
store.removeMany(['q-2']);
assert.deepStrictEqual(store.readPaperSelection().selectedIds, [], 'an emptied handoff must stay explicit instead of falling back to every basket item');

const staleScope = initial.scopeKey;
identity = teacherB;
const switched = store.reconcileIdentity();
assert.notStrictEqual(switched.scopeKey, staleScope);
assert.deepStrictEqual(switched.ids, [], 'another account must never inherit the prior basket');
assert.strictEqual(store.question('q-1'), null, 'question display cache must clear with the account scope');
assert.strictEqual(store.replace(['leak'], staleScope).written, false, 'a stale page must not write through another account scope');

identity = { id: 'visitor', role: 'visitor', account_state: 'visitor' };
assert.strictEqual(store.reconcileIdentity().scopeKey, '');
assert.strictEqual(store.toggle('q-visitor').written, false, 'restricted identities must not create a basket namespace');
assert.strictEqual(store.beginPaper(['q-visitor']).written, false);

identity = teacherA;
const failingStore = createQuestionBasketStore({
  readIdentity: () => identity,
  read: key => String(key).startsWith('question_basket_v1_') ? ['q-write-failure'] : null,
  write: () => false,
});
failingStore.seedQuestions([{ id: 'q-write-failure', stemPreview: 'persist me' }]);
const failedToggle = failingStore.toggle('q-write-failure');
assert.strictEqual(failedToggle.written, false, 'a failed durable basket write must never be reported as successful');
assert.strictEqual(failedToggle.reason, 'persistence-failed', 'the UI must be able to distinguish storage failure from an invalid selection');
const failedHandoff = failingStore.beginPaper(['q-write-failure']);
assert.strictEqual(failedHandoff.written, false);
assert.strictEqual(failedHandoff.reason, 'persistence-failed');

const restartedStore = createQuestionBasketStore({
  readIdentity: () => teacherA,
  read: key => persisted.get(key),
  write: (key, value) => persisted.set(key, JSON.parse(JSON.stringify(value))),
});
restartedStore.replace(['q-after-page-40', 'q-on-first-page'], restartedStore.snapshot().scopeKey);
restartedStore.seedQuestions([{ id: 'q-on-first-page', stemPreview: 'visible page' }]);
const beforeHydration = restartedStore.beginPaper(restartedStore.snapshot().ids);
assert.strictEqual(beforeHydration.reason, 'unavailable-questions', 'a restarted store must wait for cloud hydration instead of silently dropping uncached ids');
assert.deepStrictEqual(beforeHydration.unavailableIds, ['q-after-page-40']);
restartedStore.seedQuestions([{ id: 'q-after-page-40', stemPreview: 'recovered from a later cloud page' }]);
const afterHydration = restartedStore.beginPaper(restartedStore.snapshot().ids);
assert.strictEqual(afterHydration.written, true, 'all valid ids must enter paper composition after exact cloud hydration');
assert.deepStrictEqual(afterHydration.selection.selectedIds, ['q-after-page-40', 'q-on-first-page']);

unsubscribe();
assert.ok(notifications >= 5, 'every successful write and identity change must notify mounted pages');
console.log('miniapp question basket store checks passed');
