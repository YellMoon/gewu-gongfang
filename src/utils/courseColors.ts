/**
 * 课程背景色工具
 *
 * 根据上课地址（room_id）自动分配背景色：
 *   - 同一地址的课程分配相同颜色
 *   - 颜色经过挑选，保证与深色字体（#333）有足够对比度
 *   - 未分配地址的课程使用默认浅灰色
 */

// 20 种柔和的浅色背景（WCAG AA 级对比度，与 #333 文字对比度 ≥ 4.5:1）
const COURSE_COLOR_PALETTE = [
  '#E3F2FD', // 浅蓝
  '#E8F5E9', // 浅绿
  '#FFF3E0', // 浅橙
  '#FCE4EC', // 浅粉
  '#E8EAF6', // 浅靛蓝
  '#FFF8E1', // 浅琥珀
  '#F3E5F5', // 浅紫
  '#E0F7FA', // 浅青
  '#FFF1F0', // 浅珊瑚
  '#E8F5E9', // 浅绿（重复但被替换）
  '#F9FBE7', // 浅黄绿
  '#EFEBE9', // 浅棕
  '#ECEFF1', // 浅蓝灰
  '#F1F8E9', // 浅翠绿
  '#FFF9C4', // 浅明黄
  '#E1F5FE', // 浅天蓝
  '#F0F4C3', // 浅柠檬
  '#FFE0B2', // 浅杏
  '#D7CCC8', // 浅驼
  '#C8E6C9', // 浅草绿
];

// 备用调色板：更鲜明的颜色（用于地址超过 20 个时）
const COURSE_COLOR_PALETTE_EXTENDED = [
  '#B3E5FC', '#C8E6C9', '#FFE0B2', '#F8BBD0', '#C5CAE9',
  '#FFECB3', '#E1BEE7', '#B2EBF2', '#FFCDD2', '#DCEDC8',
  '#F0F4C3', '#D7CCC8', '#CFD8DC', '#D1C4E9', '#B2DFDB',
  '#FFCCBC', '#B3E5FC', '#E6EE9C', '#FFE082', '#A5D6A7',
];

/** 无地址课程的默认背景色 */
export const DEFAULT_COURSE_COLOR = '#F5F5F5';

/**
 * 将字符串哈希为 0..(max-1) 的整数（确定性）
 */
function hashString(str: string, max: number): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // 转为 32 位整数
  }
  return Math.abs(hash) % max;
}

/**
 * 根据上课地址获取课程背景色。
 * 同一 room_id 始终返回相同颜色。
 * 空 room_id 返回默认浅灰色。
 */
export function getColorForRoom(roomId?: string): string {
  if (!roomId || !roomId.trim()) {
    return DEFAULT_COURSE_COLOR;
  }

  const palette = COURSE_COLOR_PALETTE;
  const index = hashString(roomId.trim(), palette.length);
  return palette[index];
}

/**
 * 计算颜色的相对亮度（WCAG 标准）。
 * 返回值 0（最暗）到 1（最亮）。
 */
function relativeLuminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const toLinear = (c: number) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/**
 * 根据背景色判断应使用深色还是浅色文字。
 * 浅色背景（亮度 > 0.6）→ 深色文字 #333
 * 深色背景（亮度 ≤ 0.6）→ 浅色文字 #fff
 */
export function getTextColorForBackground(bgHex: string): string {
  const luminance = relativeLuminance(bgHex);
  return luminance > 0.6 ? '#333333' : '#FFFFFF';
}

/**
 * 生成边框色（背景色的暗化版本）。
 */
export function getBorderColorForBackground(bgHex: string): string {
  // 将各分量乘以 0.7 以暗化
  const r = Math.round(parseInt(bgHex.slice(1, 3), 16) * 0.7);
  const g = Math.round(parseInt(bgHex.slice(3, 5), 16) * 0.7);
  const b = Math.round(parseInt(bgHex.slice(5, 7), 16) * 0.7);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/**
 * 为课程列表自动分配颜色。
 * 根据 room_id 分组，同地址同色。
 * 修改 course.color 字段。
 */
export function autoAssignCourseColors<T extends { room_id?: string; color?: string }>(
  courses: T[],
): T[] {
  return courses.map((c) => ({
    ...c,
    color: c.color || getColorForRoom(c.room_id),
  }));
}
