import dayjs from 'dayjs';
import {
  BillingUnit,
  Course,
  CourseSourceType,
  CourseType,
  Schedule,
  ScheduleStatus,
  Student,
  StudentCoursePricing,
  Teacher,
  TeacherFeeMode,
} from '../types';

export const courseTypeNames: Record<number, string> = {
  [CourseType.ONE_ON_ONE]: '一对一',
  [CourseType.ONE_ON_TWO]: '一对二',
  [CourseType.GROUP]: '小组课',
  [CourseType.LARGE_CLASS]: '大班课',
};

export const sourceTypeNames: Record<number, string> = {
  [CourseSourceType.SELF]: '自有课程',
  [CourseSourceType.INSTITUTION]: '机构排课',
  [CourseSourceType.MIXED]: '混合班',
};

export interface StudentCourseFeeDetail {
  key: string;
  scheduleId: string;
  date: string;
  timeRange: string;
  startTime: string;
  endTime: string;
  courseId: string;
  courseName: string;
  courseType: CourseType;
  courseTypeName: string;
  sourceType?: CourseSourceType;
  sourceTypeName: string;
  institutionId?: string;
  studentId: string;
  studentName: string;
  teacherId?: string;
  teacherName: string;
  durationHours: number;
  billingUnit: BillingUnit;
  billingUnitName: string;
  tuitionUnitPrice: number;
  tuitionTotal: number;
  teacherFeeUnitPrice: number;
  teacherFeeTotal: number;
  teacherFeeMode: TeacherFeeMode;
  teacherFeeModeName: string;
  pricingSource: 'schedule' | 'course' | 'fallback';
}

export interface TeacherFeeDetail {
  key: string;
  scheduleId: string;
  date: string;
  timeRange: string;
  startTime: string;
  endTime: string;
  courseId: string;
  courseName: string;
  teacherId: string;
  teacherName: string;
  studentNames: string;
  studentCount: number;
  durationHours: number;
  billingUnit: BillingUnit;
  billingUnitName: string;
  feeUnitPrice: number;
  teacherFeeMode: TeacherFeeMode;
  teacherFeeModeName: string;
  teacherFeeTotal: number;
}

type ScheduleLike = Pick<Schedule, 'id' | 'course_id' | 'start_time' | 'end_time' | 'status'> &
  Partial<Schedule> & {
    course_name?: string;
    course_type?: CourseType;
  };

const roundMoney = (value: number): number => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

const activePricing = (pricing: StudentCoursePricing): boolean =>
  pricing.status !== ScheduleStatus.LEAVE && pricing.status !== ScheduleStatus.CANCELLED;

const normalizeIds = (ids?: string[]): string[] =>
  Array.isArray(ids) ? ids.filter(Boolean) : [];

const amountByUnit = (unitPrice: number, billingUnit: BillingUnit, durationHours: number): number => {
  if (billingUnit === BillingUnit.PER_HOUR) return roundMoney(unitPrice * durationHours);
  return roundMoney(unitPrice);
};

const scaleToSnapshot = <T extends Record<string, any>>(
  rows: T[],
  amountKey: keyof T,
  unitPriceKey: keyof T,
  snapshotTotal?: number
): T[] => {
  const snapshot = Number(snapshotTotal || 0);
  const currentTotal = rows.reduce((sum, row) => sum + Number(row[amountKey] || 0), 0);
  if (snapshot <= 0 || currentTotal <= 0 || Math.abs(snapshot - currentTotal) < 0.01) return rows;
  const ratio = snapshot / currentTotal;
  return rows.map(row => ({
    ...row,
    [amountKey]: roundMoney(Number(row[amountKey] || 0) * ratio),
    [unitPriceKey]: roundMoney(Number(row[unitPriceKey] || 0) * ratio),
  }));
};

const getDurationHours = (startTime: string, endTime: string): number => {
  const start = dayjs(startTime);
  const end = dayjs(endTime);
  if (start.isValid() && end.isValid()) {
    const minutes = end.diff(start, 'minute');
    return Math.max(0, roundMoney(minutes / 60));
  }

  const startClock = startTime.split(' ')[1] || startTime;
  const endClock = endTime.split(' ')[1] || endTime;
  const [startH, startM] = startClock.split(':').map(Number);
  const [endH, endM] = endClock.split(':').map(Number);
  if ([startH, startM, endH, endM].some(Number.isNaN)) return 0;
  return Math.max(0, roundMoney(((endH * 60 + endM) - (startH * 60 + startM)) / 60));
};

const getSchedulePricings = (
  schedule: ScheduleLike,
  course?: Course
): { pricings: StudentCoursePricing[]; pricingSource: StudentCourseFeeDetail['pricingSource'] } => {
  const scheduleIds = normalizeIds(schedule.student_ids);
  const schedulePricings = (schedule.student_pricings || []).filter(activePricing);
  if (schedulePricings.length > 0) {
    const filtered = scheduleIds.length > 0
      ? schedulePricings.filter(pricing => scheduleIds.includes(pricing.student_id))
      : schedulePricings;
    return { pricings: filtered, pricingSource: 'schedule' };
  }

  const coursePricings = (course?.student_pricings || []).filter(activePricing);
  if (coursePricings.length > 0) {
    const filtered = scheduleIds.length > 0
      ? coursePricings.filter(pricing => scheduleIds.includes(pricing.student_id))
      : coursePricings;
    return { pricings: filtered, pricingSource: 'course' };
  }

  if (scheduleIds.length > 0) {
    return {
      pricings: scheduleIds.map(studentId => ({ student_id: studentId, tuition: 0, teacher_fee: 0 })),
      pricingSource: 'fallback',
    };
  }

  return {
    pricings: [{ student_id: '__unbound__', tuition: 0, teacher_fee: 0 }],
    pricingSource: 'fallback',
  };
};

const findStudentName = (students: Student[], studentId: string): string => {
  if (studentId === '__unbound__') return '未绑定学生';
  return students.find(student => student.id === studentId)?.name || '未知学生';
};

export function buildFinancialDetails(
  schedules: ScheduleLike[],
  courses: Course[],
  students: Student[],
  teachers: Teacher[]
): { studentDetails: StudentCourseFeeDetail[]; teacherDetails: TeacherFeeDetail[] } {
  const studentDetails: StudentCourseFeeDetail[] = [];
  const teacherDetails: TeacherFeeDetail[] = [];

  schedules.forEach(schedule => {
    const course = courses.find(item => item.id === schedule.course_id);
    const billingUnit = course?.billing_unit || BillingUnit.PER_HOUR;
    const teacherFeeMode = course?.teacher_fee_mode || TeacherFeeMode.PER_SESSION;
    const durationHours = getDurationHours(schedule.start_time, schedule.end_time);
    const date = schedule.start_time.split(' ')[0] || '';
    const startClock = (schedule.start_time.split(' ')[1] || schedule.start_time).substring(0, 5);
    const endClock = (schedule.end_time.split(' ')[1] || schedule.end_time).substring(0, 5);
    const timeRange = `${startClock}-${endClock}`;
    const teacher = teachers.find(item => item.id === course?.teacher_id);
    const { pricings, pricingSource } = getSchedulePricings(schedule, course);
    const studentCount = Math.max(1, pricings.length);
    const hasRealPricings = pricingSource !== 'fallback';
    const multiplier = billingUnit === BillingUnit.PER_HOUR ? durationHours : 1;

    const rawRows = pricings.map((pricing, index) => {
      const fallbackTuitionUnit = hasRealPricings
        ? Number(pricing.tuition || 0)
        : Number(course?.price_tuition || 0) / studentCount;
      const tuitionUnitPrice = Number(pricing.tuition || fallbackTuitionUnit || 0);

      let teacherFeeUnitPrice = pricing.teacher_fee === undefined || pricing.teacher_fee === null
        ? 0
        : Number(pricing.teacher_fee);
      if (pricing.teacher_fee === undefined || pricing.teacher_fee === null) {
        if (teacherFeeMode === TeacherFeeMode.PER_STUDENT && pricingSource === 'fallback') {
          teacherFeeUnitPrice = Number(course?.price_teacher || 0);
        } else {
          teacherFeeUnitPrice = Number(course?.price_teacher || 0) / studentCount;
        }
      }

      return {
        key: `${schedule.id}-${pricing.student_id}-${index}`,
        scheduleId: schedule.id,
        date,
        timeRange,
        startTime: schedule.start_time,
        endTime: schedule.end_time,
        courseId: schedule.course_id,
        courseName: course?.display_name || schedule.course_name || course?.name || '未知课程',
        courseType: course?.type || schedule.course_type || CourseType.ONE_ON_ONE,
        courseTypeName: courseTypeNames[course?.type || schedule.course_type || CourseType.ONE_ON_ONE] || '未知',
        sourceType: course?.source_type,
        sourceTypeName: sourceTypeNames[course?.source_type || 0] || '未知',
        institutionId: course?.institution_id,
        studentId: pricing.student_id,
        studentName: findStudentName(students, pricing.student_id),
        teacherId: course?.teacher_id,
        teacherName: teacher?.name || course?.teacher_name || '未设置老师',
        durationHours,
        billingUnit,
        billingUnitName: billingUnit === BillingUnit.PER_HOUR ? '小时' : '次',
        tuitionUnitPrice: roundMoney(tuitionUnitPrice),
        tuitionTotal: amountByUnit(tuitionUnitPrice, billingUnit, durationHours),
        teacherFeeUnitPrice: roundMoney(teacherFeeUnitPrice),
        teacherFeeTotal: roundMoney(teacherFeeUnitPrice * multiplier),
        teacherFeeMode,
        teacherFeeModeName: teacherFeeMode === TeacherFeeMode.PER_STUDENT ? '按学生' : '按课次',
        pricingSource,
      };
    });

    const tuitionRows = scaleToSnapshot(rawRows, 'tuitionTotal', 'tuitionUnitPrice', schedule.calculated_tuition);
    const finalRows = scaleToSnapshot(tuitionRows, 'teacherFeeTotal', 'teacherFeeUnitPrice', schedule.calculated_teacher_fee);
    studentDetails.push(...finalRows);

    const teacherFeeTotal = roundMoney(
      Number(schedule.calculated_teacher_fee || 0) ||
      finalRows.reduce((sum, row) => sum + row.teacherFeeTotal, 0)
    );

    const feeUnitPrice = roundMoney(
      billingUnit === BillingUnit.PER_HOUR && durationHours > 0
        ? teacherFeeTotal / durationHours
        : teacherFeeTotal
    );

    teacherDetails.push({
      key: schedule.id,
      scheduleId: schedule.id,
      date,
      timeRange,
      startTime: schedule.start_time,
      endTime: schedule.end_time,
      courseId: schedule.course_id,
      courseName: course?.display_name || schedule.course_name || course?.name || '未知课程',
      teacherId: course?.teacher_id || '__unassigned__',
      teacherName: teacher?.name || course?.teacher_name || '未设置老师',
      studentNames: finalRows.map(row => row.studentName).join('、'),
      studentCount: finalRows.filter(row => row.studentId !== '__unbound__').length,
      durationHours,
      billingUnit,
      billingUnitName: billingUnit === BillingUnit.PER_HOUR ? '小时' : '次',
      feeUnitPrice,
      teacherFeeMode,
      teacherFeeModeName: teacherFeeMode === TeacherFeeMode.PER_STUDENT ? '按学生' : '按课次',
      teacherFeeTotal,
    });
  });

  return {
    studentDetails: studentDetails.sort((a, b) => a.startTime.localeCompare(b.startTime) || a.studentName.localeCompare(b.studentName)),
    teacherDetails: teacherDetails.sort((a, b) => a.startTime.localeCompare(b.startTime) || a.teacherName.localeCompare(b.teacherName)),
  };
}
