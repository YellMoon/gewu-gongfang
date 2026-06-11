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
  pricingSource: 'schedule' | 'fallback';
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

export interface ScheduleFinancialSnapshot {
  student_ids: string[];
  student_pricings: StudentCoursePricing[];
  billing_unit: BillingUnit;
  teacher_fee_mode: TeacherFeeMode;
  teacher_id?: string;
  teacher_name?: string;
  calculated_tuition: number;
  calculated_teacher_fee: number;
}

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
  if (snapshot > 0 && currentTotal <= 0 && rows.length > 0) {
    const amount = roundMoney(snapshot / rows.length);
    return rows.map(row => ({
      ...row,
      [amountKey]: amount,
      [unitPriceKey]: amount,
    }));
  }
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

export function calculateScheduleFinancialTotals(
  pricings: StudentCoursePricing[] = [],
  billingUnit: BillingUnit = BillingUnit.PER_HOUR,
  teacherFeeMode: TeacherFeeMode = TeacherFeeMode.PER_SESSION,
  durationHours: number = 0
): { tuition: number; teacherFee: number } {
  const activePricings = pricings.filter(activePricing);
  const multiplier = billingUnit === BillingUnit.PER_HOUR ? durationHours : 1;
  const tuition = activePricings.reduce((sum, pricing) => (
    sum + amountByUnit(Number(pricing.tuition || 0), billingUnit, durationHours)
  ), 0);
  const rawTeacherFee = activePricings.reduce((sum, pricing) => (
    sum + Number(pricing.teacher_fee ?? 0) * multiplier
  ), 0);

  return {
    tuition: roundMoney(tuition),
    teacherFee: roundMoney(rawTeacherFee),
  };
}

export function buildScheduleFinancialSnapshot(
  schedule: Pick<ScheduleLike, 'start_time' | 'end_time'> & Partial<ScheduleLike>,
  course?: Course,
  overridePricings?: StudentCoursePricing[]
): ScheduleFinancialSnapshot {
  const sourcePricings = overridePricings || schedule.student_pricings || course?.student_pricings || [];
  const studentPricings = sourcePricings.map(pricing => ({
    student_id: pricing.student_id,
    tuition: Number(pricing.tuition || 0),
    teacher_fee: pricing.teacher_fee === undefined || pricing.teacher_fee === null ? 0 : Number(pricing.teacher_fee),
    status: pricing.status || ScheduleStatus.PLANNED,
  }));
  const billingUnit = schedule.billing_unit || course?.billing_unit || BillingUnit.PER_HOUR;
  const teacherFeeMode = schedule.teacher_fee_mode || course?.teacher_fee_mode || TeacherFeeMode.PER_SESSION;
  const totals = calculateScheduleFinancialTotals(
    studentPricings,
    billingUnit,
    teacherFeeMode,
    getDurationHours(schedule.start_time || '', schedule.end_time || '')
  );

  return {
    student_ids: studentPricings.map(pricing => pricing.student_id).filter(Boolean),
    student_pricings: studentPricings,
    billing_unit: billingUnit,
    teacher_fee_mode: teacherFeeMode,
    teacher_id: schedule.teacher_id || course?.teacher_id,
    teacher_name: schedule.teacher_name || course?.teacher_name,
    calculated_tuition: totals.tuition,
    calculated_teacher_fee: totals.teacherFee,
  };
}

const getSchedulePricings = (
  schedule: ScheduleLike
): { pricings: StudentCoursePricing[]; pricingSource: StudentCourseFeeDetail['pricingSource'] } => {
  const scheduleIds = normalizeIds(schedule.student_ids);
  const schedulePricings = (schedule.student_pricings || []).filter(activePricing);
  if (schedulePricings.length > 0) {
    const filtered = scheduleIds.length > 0
      ? schedulePricings.filter(pricing => scheduleIds.includes(pricing.student_id))
      : schedulePricings;
    return { pricings: filtered, pricingSource: 'schedule' };
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
    const billingUnit = schedule.billing_unit || course?.billing_unit || BillingUnit.PER_HOUR;
    const teacherFeeMode = schedule.teacher_fee_mode || course?.teacher_fee_mode || TeacherFeeMode.PER_SESSION;
    const durationHours = getDurationHours(schedule.start_time, schedule.end_time);
    const date = schedule.start_time.split(' ')[0] || '';
    const startClock = (schedule.start_time.split(' ')[1] || schedule.start_time).substring(0, 5);
    const endClock = (schedule.end_time.split(' ')[1] || schedule.end_time).substring(0, 5);
    const timeRange = `${startClock}-${endClock}`;
    const teacherId = schedule.teacher_id || course?.teacher_id;
    const teacher = teachers.find(item => item.id === teacherId);
    const { pricings, pricingSource } = getSchedulePricings(schedule);
    const studentCount = Math.max(1, pricings.length);
    const multiplier = billingUnit === BillingUnit.PER_HOUR ? durationHours : 1;

    const rawRows = pricings.map((pricing, index) => {
      const tuitionUnitPrice = Number(pricing.tuition || 0);

      let teacherFeeUnitPrice = pricing.teacher_fee === undefined || pricing.teacher_fee === null
        ? 0
        : Number(pricing.teacher_fee);

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
        teacherId,
        teacherName: teacher?.name || schedule.teacher_name || course?.teacher_name || '未设置老师',
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
      teacherId: teacherId || '__unassigned__',
      teacherName: teacher?.name || schedule.teacher_name || course?.teacher_name || '未设置老师',
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
