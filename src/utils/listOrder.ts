function timestamp(value: string | null | undefined): number {
  const parsed = Date.parse(value || '');
  return Number.isNaN(parsed) ? -Infinity : parsed;
}

export function newestFirst<Row extends { id: string }>(
  rows: readonly Row[],
  timeOf: (row: Row) => string | null | undefined,
): Row[] {
  return [...rows].sort((left, right) =>
    timestamp(timeOf(right)) - timestamp(timeOf(left)) || left.id.localeCompare(right.id));
}
