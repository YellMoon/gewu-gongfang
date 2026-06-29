const assert = require('assert');

(async () => {
  const {
    SLOT_HEIGHT,
    timeToSlot,
    slotToTime,
    pointerYToAbsoluteSlot,
    selectionIntersectsSchedule,
    moveTimeBySlots,
    applyBatchScheduleDrag,
    formatBatchConflictMessage,
  } = await import('./batchSelectionGeometry.mjs');

assert.strictEqual(timeToSlot(8, 0), 0);
assert.deepStrictEqual(slotToTime(0), { hour: 8, minute: 0 });

// The day body may start before/after 8:00. Pointer coordinates are relative to
// the visible body, so they must be shifted by data-min-start-slot before being
// compared with absolute schedule slots.
assert.strictEqual(pointerYToAbsoluteSlot(0, -12), -12);
assert.strictEqual(pointerYToAbsoluteSlot(2 * SLOT_HEIGHT + 0.1, -12), -10);

// A schedule that starts exactly at the selection's lower edge is visually
// outside the rectangle and must not be selected as an extra row.
assert.strictEqual(
  selectionIntersectsSchedule({ selectionStartSlot: 0, selectionEndSlotExclusive: 24, scheduleStartSlot: 24, scheduleEndSlot: 36 }),
  false
);
assert.strictEqual(
  selectionIntersectsSchedule({ selectionStartSlot: 0, selectionEndSlotExclusive: 24, scheduleStartSlot: 23, scheduleEndSlot: 36 }),
  true
);

// Drag preview and final persisted time must apply the same slot delta to both
// start and end, preserving duration and matching the visible ghost position.
assert.deepStrictEqual(moveTimeBySlots('10:00', '12:00', -12), {
  start: { hour: 9, minute: 0 },
  end: { hour: 11, minute: 0 },
});

const schedules = [
  {
    id: 'lesson-a',
    course_name: '数学',
    start_time: '2026-06-29 10:00',
    end_time: '2026-06-29 11:00',
    status: 1,
  },
  {
    id: 'lesson-a_cpy_old',
    course_name: '旧复制课',
    start_time: '2026-06-30 14:00',
    end_time: '2026-06-30 15:00',
    status: 1,
  },
];

const copied = applyBatchScheduleDrag({
  schedules,
  selectedIds: ['lesson-a'],
  weekDates: ['2026-06-29', '2026-06-30'],
  dayDelta: 1,
  slotDelta: 0,
  isCopy: true,
  generateId: () => 'lesson-a-copy',
});

assert.strictEqual(copied.success, true);
assert.strictEqual(copied.nextSchedules.length, 3);
assert.ok(copied.nextSchedules.some(item => item.id === 'lesson-a-copy'));
assert.strictEqual(copied.nextSchedules.find(item => item.id === 'lesson-a').start_time, '2026-06-29 10:00');
assert.deepStrictEqual(copied.changedIds, ['lesson-a-copy']);

const moved = applyBatchScheduleDrag({
  schedules,
  selectedIds: ['lesson-a'],
  weekDates: ['2026-06-29', '2026-06-30'],
  dayDelta: 1,
  slotDelta: 12,
  isCopy: false,
});

assert.strictEqual(moved.success, true);
assert.strictEqual(moved.nextSchedules.find(item => item.id === 'lesson-a').start_time, '2026-06-30 11:00');
assert.strictEqual(moved.nextSchedules.find(item => item.id === 'lesson-a').end_time, '2026-06-30 12:00');
assert.deepStrictEqual(moved.changedIds, ['lesson-a']);

const conflict = applyBatchScheduleDrag({
  schedules,
  selectedIds: ['lesson-a'],
  weekDates: ['2026-06-29', '2026-06-30'],
  dayDelta: 1,
  slotDelta: 48,
  isCopy: false,
});

assert.strictEqual(conflict.success, false);
assert.strictEqual(conflict.conflictName, '旧复制课');
assert.strictEqual(formatBatchConflictMessage('旧复制课'), '时间冲突：与「旧复制课」时间段重叠，批量操作已取消');

  console.log('batchSelectionGeometry tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
