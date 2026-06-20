const assert = require('assert');

const {
  SLOT_HEIGHT,
  timeToSlot,
  slotToTime,
  pointerYToAbsoluteSlot,
  selectionIntersectsSchedule,
  moveTimeBySlots,
} = require('./batchSelectionGeometry');

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

console.log('batchSelectionGeometry tests passed');
