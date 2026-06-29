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

function formatTime(hour, minute) {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function splitScheduleTime(value) {
  const [date, time] = String(value || '').split(' ');
  return { date, time };
}

function isInactiveSchedule(schedule) {
  return Number(schedule && schedule.status) === 3 || Number(schedule && schedule.status) === 4;
}

function formatBatchConflictMessage(conflictName) {
  return `时间冲突：与「${conflictName || '其他课程'}」时间段重叠，批量操作已取消`;
}

function applyBatchScheduleDrag({
  schedules,
  selectedIds,
  weekDates,
  dayDelta,
  slotDelta,
  isCopy,
  generateId = undefined,
}) {
  const selectedSet = new Set(selectedIds || []);
  const nextSchedules = (schedules || []).map(schedule => ({ ...schedule }));
  const changedIds = [];

  for (const selectedId of selectedSet) {
    const schedule = (schedules || []).find(item => item && item.id === selectedId);
    if (!schedule) continue;

    const { date: oldDate, time: oldStart } = splitScheduleTime(schedule.start_time);
    const { time: oldEnd } = splitScheduleTime(schedule.end_time);
    if (!oldDate || !oldStart || !oldEnd) continue;

    const oldDayIndex = (weekDates || []).findIndex(date => date === oldDate);
    const newDayIndex = oldDayIndex + dayDelta;
    if (oldDayIndex < 0 || newDayIndex < 0 || newDayIndex >= (weekDates || []).length) continue;

    const moved = moveTimeBySlots(oldStart, oldEnd, slotDelta);
    const newDate = weekDates[newDayIndex];
    const updated = {
      ...schedule,
      start_time: `${newDate} ${formatTime(moved.start.hour, moved.start.minute)}`,
      end_time: `${newDate} ${formatTime(moved.end.hour, moved.end.minute)}`,
    };

    if (isCopy) {
      const id = typeof generateId === 'function'
        ? generateId(schedule)
        : `${schedule.id}_copy_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      nextSchedules.push({ ...updated, id });
      changedIds.push(id);
    } else {
      const index = nextSchedules.findIndex(item => item && item.id === selectedId);
      if (index >= 0) {
        nextSchedules[index] = updated;
        changedIds.push(selectedId);
      }
    }
  }

  for (const changedId of changedIds) {
    const checkItem = nextSchedules.find(item => item && item.id === changedId);
    if (!checkItem || isInactiveSchedule(checkItem)) continue;

    for (const other of nextSchedules) {
      if (!other || other.id === checkItem.id || isInactiveSchedule(other)) continue;
      if (checkItem.start_time < other.end_time && checkItem.end_time > other.start_time) {
        return {
          success: false,
          nextSchedules: schedules || [],
          changedIds: [],
          conflictName: other.course_name || '其他课程',
        };
      }
    }
  }

  return {
    success: true,
    nextSchedules,
    changedIds,
    conflictName: null,
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
  applyBatchScheduleDrag,
  formatBatchConflictMessage,
};
