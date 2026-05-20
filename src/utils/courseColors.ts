export const DEFAULT_COURSE_COLOR = '#F5F7FA';

const COURSE_COLOR_PALETTE = [
  '#E3F2FD',
  '#E8F5E9',
  '#FFF3E0',
  '#FCE4EC',
  '#E8EAF6',
  '#FFF8E1',
  '#F3E5F5',
  '#E0F7FA',
  '#FFF1F0',
  '#F9FBE7',
  '#EFEBE9',
  '#ECEFF1',
  '#F1F8E9',
  '#FFF9C4',
  '#E1F5FE',
  '#F0F4C3',
  '#FFE0B2',
  '#D7CCC8',
  '#C8E6C9',
  '#D1C4E9',
  '#B2DFDB',
  '#FFCCBC',
  '#CFD8DC',
  '#DCEDC8',
];

type RoomLike = {
  id?: string;
  name?: string;
  address?: string;
};

type CourseLike = {
  room_id?: string;
  room_name?: string;
  color?: string;
};

function normalizeLocation(value?: string): string {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)[0] || '';
}

export function getRoomDisplayName(roomIdOrName?: string, rooms: RoomLike[] = []): string {
  const key = normalizeLocation(roomIdOrName);
  if (!key) return '';
  const room = rooms.find(item => item.id === key || item.name === key);
  return normalizeLocation(room?.name || key);
}

export function getCourseLocationKey(course: CourseLike, rooms: RoomLike[] = []): string {
  const fromRoomId = getRoomDisplayName(course.room_id, rooms);
  const fromRoomName = normalizeLocation(course.room_name);
  return fromRoomId || fromRoomName;
}

function buildLocationColorMap(locationKeys: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  Array.from(new Set(locationKeys.map(normalizeLocation).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, 'zh-CN'))
    .forEach((key, index) => {
      result[key] = COURSE_COLOR_PALETTE[index % COURSE_COLOR_PALETTE.length];
    });
  return result;
}

export function getColorForRoom(roomIdOrName?: string, rooms: RoomLike[] = []): string {
  const key = getRoomDisplayName(roomIdOrName, rooms);
  if (!key) return DEFAULT_COURSE_COLOR;
  return buildLocationColorMap([key])[key] || DEFAULT_COURSE_COLOR;
}

export function buildCourseColorMap<T extends CourseLike & { id?: string }>(
  courses: T[],
  rooms: RoomLike[] = [],
): Record<string, string> {
  const locationKeys = courses.map(course => getCourseLocationKey(course, rooms)).filter(Boolean);
  const locationColorMap = buildLocationColorMap(locationKeys);
  const courseColorMap: Record<string, string> = {};
  courses.forEach(course => {
    if (!course.id) return;
    const key = getCourseLocationKey(course, rooms);
    courseColorMap[course.id] = key ? locationColorMap[key] : DEFAULT_COURSE_COLOR;
  });
  return courseColorMap;
}

export function getTextColorForBackground(bgHex: string): string {
  const color = bgHex || DEFAULT_COURSE_COLOR;
  const r = parseInt(color.slice(1, 3), 16) / 255;
  const g = parseInt(color.slice(3, 5), 16) / 255;
  const b = parseInt(color.slice(5, 7), 16) / 255;
  const toLinear = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const luminance = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  return luminance > 0.6 ? '#333333' : '#FFFFFF';
}

export function getBorderColorForBackground(bgHex: string): string {
  const color = bgHex || DEFAULT_COURSE_COLOR;
  const r = Math.round(parseInt(color.slice(1, 3), 16) * 0.7);
  const g = Math.round(parseInt(color.slice(3, 5), 16) * 0.7);
  const b = Math.round(parseInt(color.slice(5, 7), 16) * 0.7);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

export function autoAssignCourseColors<T extends CourseLike>(courses: T[], rooms: RoomLike[] = []): T[] {
  const locationKeys = courses.map(course => getCourseLocationKey(course, rooms)).filter(Boolean);
  const locationColorMap = buildLocationColorMap(locationKeys);
  return courses.map(course => {
    const key = getCourseLocationKey(course, rooms);
    return {
      ...course,
      color: key ? locationColorMap[key] : DEFAULT_COURSE_COLOR,
    };
  });
}
