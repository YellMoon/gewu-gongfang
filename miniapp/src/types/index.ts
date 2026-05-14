// 类型定义 - 微信小程序版（与桌面端共享数据类型）

export enum StudentSource {
  SELF = 1,
  INSTITUTION = 2
}

export interface Student {
  id: string;
  name: string;
  phone?: string;
  school?: string;
  grade_year?: number;
  grade_current?: string;
  source_type?: StudentSource;
  institution_id?: string;
  parent_name?: string;
  parent_wechat?: string;
  student_source?: string;
  balance_hours: number;
  balance_money: number;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface Grade {
  id: string;
  student_id: string;
  subject: string;
  score: number;
  exam_date?: string;
  notes?: string;
  created_at: string;
}

export enum CourseType {
  ONE_ON_ONE = 1,
  ONE_ON_TWO = 2,
  GROUP = 3,
  LARGE_CLASS = 4
}

export enum CourseSourceType {
  SELF = 1,
  INSTITUTION = 2,
  MIXED = 3
}

export enum ServiceType {
  IN_CENTER = 1,
  AT_HOME = 2
}

export interface Room {
  id: string;
  name: string;
  address?: string;
  count: number;
  created_at: string;
  updated_at: string;
}

export interface Institution {
  id: string;
  name: string;
  contact_person?: string;
  contact_phone?: string;
  revenue_share?: number;
  notes?: string;
  created_at: string;
}

export enum BillingUnit {
  PER_HOUR = 1,
  PER_SESSION = 2
}

export enum TeacherFeeMode {
  PER_SESSION = 1,
  PER_STUDENT = 2
}

export interface StudentCoursePricing {
  student_id: string;
  tuition: number;
  teacher_fee?: number;
  status?: number;
}

export interface Course {
  id: string;
  name: string;
  year?: number;
  semester?: string;
  display_name: string;
  type: CourseType;
  source_type: CourseSourceType;
  institution_id?: string;
  price_tuition: number;
  price_teacher: number;
  billing_unit: BillingUnit;
  teacher_fee_mode: TeacherFeeMode;
  student_pricings?: StudentCoursePricing[];
  room_id?: string;
  room_name?: string;
  teacher_id?: string;
  teacher_name?: string;
  active: boolean;
  default_duration_minutes?: number;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export enum ScheduleStatus {
  PLANNED = 1,
  COMPLETED = 2,
  CANCELLED = 3,
  LEAVE = 4
}

export interface Schedule {
  id: string;
  course_id: string;
  start_time: string;
  end_time: string;
  recurring_rule?: string;
  status: ScheduleStatus;
  room?: string;
  service_type?: ServiceType;
  student_ids?: string[];
  student_pricings?: StudentCoursePricing[];
  calculated_tuition?: number;
  calculated_teacher_fee?: number;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface Enrollment {
  id: string;
  schedule_id: string;
  student_id: string;
  custom_price?: number;
  hours_consumed: number;
  status: number;
  notes?: string;
  created_at: string;
}

export enum PaymentType {
  TUITION = 1,
  HOURS = 2
}

export interface Payment {
  id: string;
  student_id: string;
  amount: number;
  payment_type: PaymentType;
  payment_date: string;
  payment_method?: string;
  notes?: string;
  created_at: string;
}

export interface Consumption {
  id: string;
  schedule_id: string;
  student_id: string;
  hours: number;
  amount: number;
  consumption_date: string;
  notes?: string;
  created_at: string;
}

export interface Teacher {
  id: string;
  name: string;
  phone?: string;
  subject?: string;
  hourly_rate?: number;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface SchoolInfo {
  id: string;
  name: string;
  count: number;
  created_at: string;
  updated_at: string;
}

export interface RevenueStats {
  total: number;
  totalSchedules: number;
  byMonth?: { month: string; amount: number }[];
  byCourseType?: { type: CourseType; typeName: string; amount: number; percentage: number }[];
  bySourceType?: { sourceType: CourseSourceType; sourceName: string; amount: number; percentage: number }[];
}

// 同步协议类型
export type SyncAction = 'create' | 'update' | 'delete';
export type SyncTable =
  | 'students' | 'courses' | 'schedules' | 'payments' | 'consumptions'
  | 'teachers' | 'grades' | 'rooms' | 'institutions'
  | 'assetRecords' | 'assetCategories' | 'questions';

export interface PendingChange {
  id: string;
  table: SyncTable;
  action: SyncAction;
  data: any;
  timestamp: number;
}

export interface SyncPayload {
  table: SyncTable;
  changes: PendingChange[];
  lastSyncTimestamp: number;
}

export interface SyncResponse {
  success: boolean;
  updates: { table: SyncTable; data: any[] }[];
  serverTimestamp: number;
  conflicts?: { local: PendingChange; server: any; resolution: 'local' | 'server' | 'manual' }[];
}
