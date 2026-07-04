function hasDateApi(value) {
  return Boolean(value && typeof value.isBefore === 'function' && typeof value.isAfter === 'function');
}

export function normalizeRefreshDateRange(range) {
  if (!Array.isArray(range) || !hasDateApi(range[0]) || !hasDateApi(range[1])) return null;
  const [startDate, endDate] = range;
  return startDate.isAfter(endDate, 'day') ? [endDate, startDate] : [startDate, endDate];
}

export function updateRefreshDateRangeBoundary(range, boundary, nextDate) {
  if (!hasDateApi(nextDate)) return normalizeRefreshDateRange(range) || range;

  const currentRange = Array.isArray(range) && hasDateApi(range[0]) && hasDateApi(range[1])
    ? range
    : [nextDate, nextDate];
  const [currentStart, currentEnd] = currentRange;

  if (boundary === 'start') {
    return nextDate.isAfter(currentEnd, 'day') ? [nextDate, nextDate] : [nextDate, currentEnd];
  }
  return nextDate.isBefore(currentStart, 'day') ? [nextDate, nextDate] : [currentStart, nextDate];
}
