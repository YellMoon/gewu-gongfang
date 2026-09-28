// Resolve a saved address before deciding that a typed value is a new address.
/** @param {{value:any, dbService:any, online?:boolean, existingCourse?:any}} options */
export async function resolveCourseRoomSelection({ value, dbService, online = true, existingCourse = null }) {
  const selected = String(Array.isArray(value) ? value.at(-1) || '' : value || '').split(',')[0].trim();
  if (!selected) throw new Error('COURSE_ROOM_REQUIRED');
  const find = () => {
    const rooms = (dbService.getAllRooms?.() || []).filter(room => !room.deleted);
    const exact = rooms.find(room => room.id === selected);
    if (exact) return exact;
    const matches = rooms.filter(room => room.name === selected);
    if (matches.length > 1) throw new Error('COURSE_ROOM_AMBIGUOUS');
    return matches[0];
  };
  let room = find();
  if (room) return room;
  if (online) {
    await dbService.refreshAuthorityProjection({ businessOnly: true, notifyConsumers: true });
    room = find();
    if (room) return room;
  }
  const courses = [...(dbService.getAllCourses?.() || []), ...(existingCourse ? [existingCourse] : [])];
  if (courses.some(course => [course.room_id, course.room_name].some(reference => String(reference || '').split(',').map(x => x.trim()).includes(selected)))) {
    throw new Error('COURSE_ROOM_REFERENCE_UNAVAILABLE');
  }
  dbService.addOrUpdateRoom(selected);
  room = find();
  if (!room) throw new Error('COURSE_ROOM_DRAFT_UNAVAILABLE');
  return room;
}
