const assert = require('assert');
const dayjs = require('dayjs');

(async () => {
  const {
    normalizeDateStepDays,
    appendSteppedBatchDate,
  } = await import('./scheduleBatchDates.mjs');

  assert.strictEqual(normalizeDateStepDays(undefined), 1);
  assert.strictEqual(normalizeDateStepDays(0), 1);
  assert.strictEqual(normalizeDateStepDays(2.8), 2);

  const start = dayjs('2026-06-29');
  const daily = appendSteppedBatchDate([start], 1, dayjs('2026-01-01'));
  assert.deepStrictEqual(daily.map(item => item.format('YYYY-MM-DD')), [
    '2026-06-29',
    '2026-06-30',
  ]);

  const everyThreeDays = appendSteppedBatchDate(daily, 3, dayjs('2026-01-01'));
  assert.deepStrictEqual(everyThreeDays.map(item => item.format('YYYY-MM-DD')), [
    '2026-06-29',
    '2026-06-30',
    '2026-07-03',
  ]);

  const fromFallback = appendSteppedBatchDate([], 7, start);
  assert.deepStrictEqual(fromFallback.map(item => item.format('YYYY-MM-DD')), [
    '2026-07-06',
  ]);

  console.log('scheduleBatchDates tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
