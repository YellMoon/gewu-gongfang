const assert = require('assert');
const fs = require('fs');
const path = require('path');

let sortPaymentsNewestFirst;
try {
  ({ sortPaymentsNewestFirst } = require('./paymentsRuntime'));
} catch (_error) {
  // The first TDD run intentionally reaches the contract assertion first.
}

assert.strictEqual(
  typeof sortPaymentsNewestFirst,
  'function',
  'payments rendering needs an immutable sorting helper',
);

const oldest = { id: 'oldest', created_at: '2026-07-01T08:00:00.000Z' };
const newest = { id: 'newest', created_at: '2026-07-03T08:00:00.000Z' };
const middle = { id: 'middle', created_at: '2026-07-02T08:00:00.000Z' };
const stateValue = Object.freeze([oldest, newest, middle]);

const sorted = sortPaymentsNewestFirst(stateValue);
assert.deepStrictEqual(sorted.map((item) => item.id), ['newest', 'middle', 'oldest']);
assert.deepStrictEqual(stateValue.map((item) => item.id), ['oldest', 'newest', 'middle']);
assert.notStrictEqual(sorted, stateValue, 'render sorting must return a new array');

const pageSource = fs.readFileSync(path.resolve(__dirname, 'index.tsx'), 'utf8');
assert.ok(pageSource.includes('sortPaymentsNewestFirst(filteredPayments)'));
assert.strictEqual(pageSource.includes('filteredPayments.sort('), false);

console.log('miniapp payments immutable sorting tests passed');
