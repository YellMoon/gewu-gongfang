// 工具函数 v1.3

// ========== 节假日 ==========

import { holidays2026 as sharedHolidays2026 } from '../../shared/calendarHolidays.js';
export const holidays2026: { name: string; start: string; end: string }[] = sharedHolidays2026;

export function checkIsHoliday(dateStr: string): { isHoliday: boolean; holidayName?: string } {
  const date = dateStr.split('T')[0];
  for (const holiday of holidays2026) {
    if (date >= holiday.start && date <= holiday.end) {
      return { isHoliday: true, holidayName: holiday.name };
    }
  }
  return { isHoliday: false };
}

export function getHolidayMark(dateStr: string): string {
  const { isHoliday, holidayName } = checkIsHoliday(dateStr);
  return isHoliday ? `🏠 ${holidayName}` : '';
}

/**
 * 获取当前日期前2周至后2个月内的节假日
 * 用于节假日提醒范围限制
 */
export function getUpcomingHolidays(): { name: string; start: string; end: string }[] {
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  
  // 前2周
  const twoWeeksAgo = new Date(today);
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
  const twoWeeksAgoStr = twoWeeksAgo.toISOString().split('T')[0];
  
  // 后2个月
  const twoMonthsLater = new Date(today);
  twoMonthsLater.setMonth(twoMonthsLater.getMonth() + 2);
  const twoMonthsLaterStr = twoMonthsLater.toISOString().split('T')[0];
  
  return holidays2026.filter(h => {
    // 节假日结束日期 >= 前2周 且 节假日开始日期 <= 后2个月
    return h.end >= twoWeeksAgoStr && h.start <= twoMonthsLaterStr;
  });
}

// ========== 年级计算 ==========

export function calculateGrade(gradeYear?: number): string {
  if (!gradeYear) return '未设置';
  
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;
  
  let schoolYear = currentYear;
  if (currentMonth < 9) {
    schoolYear = currentYear - 1;
  }
  
  const yearsSinceEnrollment = schoolYear - gradeYear;
  
  if (yearsSinceEnrollment < 0) return '未入学';
  if (yearsSinceEnrollment === 0) return '高一';
  if (yearsSinceEnrollment === 1) return '高二';
  if (yearsSinceEnrollment === 2) return '高三';
  if (yearsSinceEnrollment >= 3) return '高复生';
  
  return `${yearsSinceEnrollment}年级`;
}

// ========== 课程时长和费用计算 ==========

export const commonDurations = [
  { label: '1 小时', value: 1 },
  { label: '1.5 小时', value: 1.5 },
  { label: '2 小时', value: 2 },
  { label: '2.5 小时', value: 2.5 },
  { label: '3 小时', value: 3 },
];

export function calculateEndTime(startTime: string, durationHours: number): string {
  const [hours, minutes] = startTime.split(':').map(Number);
  const totalMinutes = hours * 60 + minutes + durationHours * 60;
  const endHours = Math.floor(totalMinutes / 60) % 24;
  const endMinutes = totalMinutes % 60;
  return `${endHours.toString().padStart(2, '0')}:${endMinutes.toString().padStart(2, '0')}`;
}

export function calculateDurationHours(startTime: string, endTime: string): number {
  const [startH, startM] = startTime.split(':').map(Number);
  const [endH, endM] = endTime.split(':').map(Number);
  
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;
  
  return (endMinutes - startMinutes) / 60;
}

/**
 * 计算学费和课时费（支持一对一和一对多）
 */
export function calculateFees(
  tuition: number,
  teacherFee: number,
  billingUnit: number,
  durationHours: number,
  teacherFeeMode: number = 1,
  studentCount: number = 1
): { tuition: number; teacherFee: number } {
  let calculatedTuition = tuition;
  let calculatedTeacherFee = teacherFee;
  
  if (billingUnit === 1) {
    // 按小时计费
    calculatedTuition = tuition * durationHours;
    
    if (teacherFeeMode === 1) {
      // 课时费按一次课计算
      calculatedTeacherFee = teacherFee * durationHours;
    } else {
      // 课时费按每个学生分摊
      calculatedTeacherFee = (teacherFee * durationHours) * studentCount;
    }
  } else {
    // 按次课计费
    if (teacherFeeMode === 2) {
      // 课时费按每个学生分摊
      calculatedTeacherFee = teacherFee * studentCount;
    }
  }
  
  return {
    tuition: calculatedTuition,
    teacherFee: calculatedTeacherFee
  };
}

// ========== 统计工具 ==========

export function groupByDate<T>(items: T[], getDateFn: (item: T) => string): { date: string; items: T[] }[] {
  const groups = new Map<string, T[]>();
  
  items.forEach(item => {
    const date = getDateFn(item);
    if (!groups.has(date)) {
      groups.set(date, []);
    }
    groups.get(date)!.push(item);
  });
  
  return Array.from(groups.entries())
    .map(([date, items]) => ({ date, items }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function groupByMonth<T>(items: T[], getDateFn: (item: T) => string): { month: string; items: T[] }[] {
  const groups = new Map<string, T[]>();
  
  items.forEach(item => {
    const date = getDateFn(item);
    const month = date.substring(0, 7);
    if (!groups.has(month)) {
      groups.set(month, []);
    }
    groups.get(month)!.push(item);
  });
  
  return Array.from(groups.entries())
    .map(([month, items]) => ({ month, items }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

export function calculatePercentage(value: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((value / total) * 10000) / 100;
}
