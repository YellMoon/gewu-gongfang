const MIN_START_HOUR = 8;
const SLOT_DURATION_MINUTES = 5;
const SLOT_HEIGHT = 2.5;

function timeToSlot(hour, minute) {
  return Math.floor(((hour - MIN_START_HOUR) * 60 + minute) / SLOT_DURATION_MINUTES);
}

function slotToTime(slot) {
  const totalMins = MIN_START_HOUR * 60 + slot * SLOT_DURATION_MINUTES;
  return {
    hour: Math.floor(totalMins / 60),
    minute: ((totalMins % 60) + 60) % 60,
  };
}

function pointerYToAbsoluteSlot(relativeY, bodyMinStartSlot) {
  return bodyMinStartSlot + Math.floor(relativeY / SLOT_HEIGHT);
}

function slotToDisplayTop(slot, bodyMinStartSlot) {
  return (slot - bodyMinStartSlot) * SLOT_HEIGHT;
}

function selectionIntersectsSchedule({
  selectionStartSlot,
  selectionEndSlotExclusive,
  scheduleStartSlot,
  scheduleEndSlot,
}) {
  return scheduleEndSlot > selectionStartSlot && scheduleStartSlot < selectionEndSlotExclusive;
}

function moveTimeBySlots(startTime, endTime, slotDelta) {
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  const newStartSlot = timeToSlot(sh, sm) + slotDelta;
  const newEndSlot = timeToSlot(eh, em) + slotDelta;
  return {
    start: slotToTime(newStartSlot),
    end: slotToTime(newEndSlot),
  };
}

export {
  MIN_START_HOUR,
  SLOT_DURATION_MINUTES,
  SLOT_HEIGHT,
  timeToSlot,
  slotToTime,
  pointerYToAbsoluteSlot,
  slotToDisplayTop,
  selectionIntersectsSchedule,
  moveTimeBySlots,
};
