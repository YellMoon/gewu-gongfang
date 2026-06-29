function normalizeRoomValue(value) {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)[0] || '';
}

function findRoomName(roomIdOrName, rooms = []) {
  const key = normalizeRoomValue(roomIdOrName);
  if (!key) return '';
  const room = rooms.find(item => item && (item.id === key || item.name === key));
  return normalizeRoomValue((room && room.name) || key);
}

function resolveScheduleRoomDisplay(schedule = {}, course = {}, rooms = []) {
  const scheduleRoom = normalizeRoomValue(schedule.room);
  const courseRoomId = normalizeRoomValue(course && course.room_id);
  const courseRoomName = normalizeRoomValue(course && course.room_name);

  if (scheduleRoom) {
    const matchedRoom = rooms.find(item => item && (item.id === scheduleRoom || item.name === scheduleRoom));
    if (matchedRoom) return normalizeRoomValue(matchedRoom.name);
    if (courseRoomId && scheduleRoom === courseRoomId && courseRoomName) return courseRoomName;
    return scheduleRoom;
  }

  return courseRoomName || findRoomName(courseRoomId, rooms);
}

export {
  normalizeRoomValue,
  findRoomName,
  resolveScheduleRoomDisplay,
};
