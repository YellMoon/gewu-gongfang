import dayjs, { Dayjs } from 'dayjs';
import { Course, Payment, Question, Schedule, ScheduleStatus, Student, Teacher } from '../types';
import { StudentCourseFeeDetail, buildFinancialDetails } from './financialDetails';

export interface TodayCourseRow {
  scheduleId: string;
  date: string;
  timeRange: string;
  teacherId?: string;
  teacherName: string;
  courseName: string;
  room?: string;
}

export interface StudentAlertRow {
  studentId: string;
  studentName: string;
  amount: number;
  courseNames: string[];
  lastDate?: string;
}

export interface QuestionIssueRow {
  id: string;
  title: string;
  subject?: string;
  reason: string;
  updatedAt?: string;
}

export interface SyncSnapshot {
  pendingCount: number;
  hasIssues: boolean;
  lastSyncTime?: number | null;
}

const roundMoney = (value: number): number => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

export function parseStoredSchedules(raw: string | null): Schedule[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function getTodayCourseRows(
  schedules: Schedule[],
  courses: Course[],
  teachers: Teacher[],
  today: Dayjs = dayjs()
): TodayCourseRow[] {
  const target = today.format('YYYY-MM-DD');
  return schedules
    .filter(schedule => dayjs(schedule.start_time).format('YYYY-MM-DD') === target)
    .filter(schedule => schedule.status !== ScheduleStatus.CANCELLED)
    .map(schedule => {
      const course = courses.find(item => item.id === schedule.course_id);
      const teacherId = schedule.teacher_id || course?.teacher_id;
      const teacher = teachers.find(item => item.id === teacherId);
      const start = dayjs(schedule.start_time).format('HH:mm');
      const end = dayjs(schedule.end_time).format('HH:mm');
      return {
        scheduleId: schedule.id,
        date: target,
        timeRange: `${start}-${end}`,
        teacherId,
        teacherName: teacher?.name || schedule.teacher_name || course?.teacher_name || '未设置老师',
        courseName: course?.display_name || course?.name || (schedule as any).course_name || '未知课程',
        room: schedule.room || course?.room_name,
      };
    })
    .sort((a, b) => a.timeRange.localeCompare(b.timeRange));
}

export function groupTodayRowsByFirstTeacher(rows: TodayCourseRow[]): { teacherName: string; rows: TodayCourseRow[] } {
  if (rows.length === 0) return { teacherName: '暂无老师', rows: [] };
  const firstTeacherId = rows[0].teacherId;
  const firstTeacherName = rows[0].teacherName;
  return {
    teacherName: firstTeacherName,
    rows: rows.filter(row => row.teacherId === firstTeacherId || row.teacherName === firstTeacherName),
  };
}

export function buildStudentFinancialAlerts(
  schedules: Schedule[],
  courses: Course[],
  students: Student[],
  teachers: Teacher[],
  payments: Payment[]
): { arrears: StudentAlertRow[]; closedBalances: StudentAlertRow[]; studentDetails: StudentCourseFeeDetail[] } {
  const normalSchedules = schedules.filter(schedule => (
    schedule.status !== ScheduleStatus.LEAVE && schedule.status !== ScheduleStatus.CANCELLED
  ));
  const { studentDetails } = buildFinancialDetails(normalSchedules, courses, students, teachers);
  const expectedMap = new Map<string, StudentAlertRow>();

  studentDetails.forEach(detail => {
    if (detail.studentId.startsWith('__')) return;
    const current = expectedMap.get(detail.studentId) || {
      studentId: detail.studentId,
      studentName: detail.studentName,
      amount: 0,
      courseNames: [],
      lastDate: detail.date,
    };
    current.amount = roundMoney(current.amount + detail.tuitionTotal);
    if (!current.courseNames.includes(detail.courseName)) current.courseNames.push(detail.courseName);
    if (!current.lastDate || detail.date > current.lastDate) current.lastDate = detail.date;
    expectedMap.set(detail.studentId, current);
  });

  const paidMap = new Map<string, number>();
  payments.forEach(payment => {
    paidMap.set(payment.student_id, roundMoney((paidMap.get(payment.student_id) || 0) + Number(payment.amount || 0)));
  });

  const arrears = Array.from(expectedMap.values())
    .map(row => ({ ...row, amount: roundMoney(row.amount - (paidMap.get(row.studentId) || 0)) }))
    .filter(row => row.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  const closedCourseIds = new Set(courses.filter(course => course.active === false).map(course => course.id));
  const closedBalances = students
    .filter(student => Number(student.balance_money || 0) > 0)
    .flatMap(student => {
      const closedDetails = studentDetails.filter(detail => (
        detail.studentId === student.id && closedCourseIds.has(detail.courseId)
      ));
      if (closedDetails.length === 0) return [];
      return [{
        studentId: student.id,
        studentName: student.name,
        amount: roundMoney(Number(student.balance_money || 0)),
        courseNames: [...new Set(closedDetails.map(detail => detail.courseName))],
        lastDate: closedDetails.map(detail => detail.date).sort().pop(),
      }];
    })
    .sort((a, b) => b.amount - a.amount);

  return { arrears, closedBalances, studentDetails };
}

export function buildQuestionIssues(questions: Question[], limit?: number): QuestionIssueRow[] {
  const rows = questions
    .map(question => {
      const reasons: string[] = [];
      if (!String((question as any).content || (question as any).stem || '').trim()) reasons.push('题干缺失');
      if (!String(question.answer || '').trim()) reasons.push('答案缺失');
      if (!String((question as any).analysis || (question as any).explanation || '').trim()) reasons.push('解析缺失');
      if (String((question as any).edit_status || '').trim() === '未编辑') reasons.push('未编辑确认');
      return { question, reasons };
    })
    .filter(item => item.reasons.length > 0)
    .map(({ question, reasons }) => ({
      id: question.id,
      title: String((question as any).content || (question as any).stem || '未填写题干').slice(0, 80),
      subject: question.subject,
      reason: reasons.join(' / '),
      updatedAt: question.updated_at ? new Date(question.updated_at).toLocaleString('zh-CN') : undefined,
    }));

  return typeof limit === 'number' ? rows.slice(0, limit) : rows;
}
