const assert = require('assert');
const dayjs = require('dayjs');

(async () => {
  const {
    normalizeRefreshDateRange,
    updateRefreshDateRangeBoundary,
  } = await import('./scheduleRefreshRange.mjs');

  const initialRange = [dayjs('2026-07-10'), dayjs('2026-07-20')];

  const changedStart = updateRefreshDateRangeBoundary(initialRange, 'start', dayjs('2026-07-05'));
  assert.strictEqual(changedStart[0].format('YYYY-MM-DD'), '2026-07-05');
  assert.strictEqual(changedStart[1].format('YYYY-MM-DD'), '2026-07-20');

  const changedEnd = updateRefreshDateRangeBoundary(initialRange, 'end', dayjs('2026-07-25'));
  assert.strictEqual(changedEnd[0].format('YYYY-MM-DD'), '2026-07-10');
  assert.strictEqual(changedEnd[1].format('YYYY-MM-DD'), '2026-07-25');

  const startAfterEnd = updateRefreshDateRangeBoundary(initialRange, 'start', dayjs('2026-08-01'));
  assert.strictEqual(startAfterEnd[0].format('YYYY-MM-DD'), '2026-08-01');
  assert.strictEqual(startAfterEnd[1].format('YYYY-MM-DD'), '2026-08-01');

  const endBeforeStart = updateRefreshDateRangeBoundary(initialRange, 'end', dayjs('2026-07-01'));
  assert.strictEqual(endBeforeStart[0].format('YYYY-MM-DD'), '2026-07-01');
  assert.strictEqual(endBeforeStart[1].format('YYYY-MM-DD'), '2026-07-01');

  const reversed = normalizeRefreshDateRange([dayjs('2026-07-20'), dayjs('2026-07-10')]);
  assert.strictEqual(reversed[0].format('YYYY-MM-DD'), '2026-07-10');
  assert.strictEqual(reversed[1].format('YYYY-MM-DD'), '2026-07-20');
  assert.strictEqual(normalizeRefreshDateRange(null), null);

  console.log('scheduleRefreshRange tests passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
