// Keep the existing desktop API while all clients use the same palette logic.
import * as colors from '../../shared/courseColors.js';

type RoomLike = { id?: string; name?: string; address?: string };
type CourseLike = { room_id?: string; room_name?: string; color?: string; calendar_color?: string };

export const DEFAULT_COURSE_COLOR = colors.DEFAULT_COURSE_COLOR;
export function getRoomDisplayName(value?: string, rooms: RoomLike[] = []): string {
  return colors.getRoomDisplayName(value, rooms);
}
export function getCourseLocationKey(course: CourseLike, rooms: RoomLike[] = []): string {
  return colors.getCourseLocationKey(course, rooms);
}
export function getColorForRoom(value?: string, rooms: RoomLike[] = []): string {
  return colors.getColorForRoom(value, rooms);
}
export function buildCourseColorMap<T extends CourseLike & { id?: string }>(courses: T[], rooms: RoomLike[] = []): Record<string, string> {
  return colors.buildCourseColorMap(courses, rooms);
}
export function getTextColorForBackground(background: string): string {
  return colors.getTextColorForBackground(background);
}
export function getBorderColorForBackground(background: string): string {
  return colors.getBorderColorForBackground(background);
}
export function autoAssignCourseColors<T extends CourseLike>(courses: T[], rooms: RoomLike[] = []): T[] {
  return colors.autoAssignCourseColors(courses, rooms);
}
