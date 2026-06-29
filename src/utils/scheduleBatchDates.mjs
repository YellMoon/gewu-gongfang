function normalizeDateStepDays(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.floor(parsed));
}

function appendSteppedBatchDate(dates, stepDays, fallbackDate) {
  const sourceDates = Array.isArray(dates) ? dates : [];
  const baseDate = sourceDates[sourceDates.length - 1] || fallbackDate;
  if (!baseDate || typeof baseDate.add !== 'function') {
    return sourceDates;
  }
  return [...sourceDates, baseDate.add(normalizeDateStepDays(stepDays), 'day')];
}

export {
  normalizeDateStepDays,
  appendSteppedBatchDate,
};
