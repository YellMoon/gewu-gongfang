// 类型定义 v1.3

// 学生来源
export enum StudentSource {
  SELF = 1,      // 自有生源
  INSTITUTION = 2  // 机构生源
}

// 学生
export interface Student {
  id: string;
  name: string;
  phone?: string;
  school?: string;
  grade_year?: number;
  grade_current?: string;
  source_type?: StudentSource;  // 学生来源
  institution_id?: string;  // 所属机构（如果是机构生源）
  // 家长信息
  parent_name?: string;
  parent_wechat?: string;
  student_source?: string;  // 学生具体来源（自有生源也需要填写）
  balance_hours: number;
  balance_money: number;
  notes?: string;
  created_at: string;
  updated_at: string;
}

// 成绩
export interface Grade {
  id: string;
  student_id: string;
  subject: string;
  score: number;
  exam_date?: string;
  notes?: string;
  created_at: string;
}

// 课程类型
export enum CourseType {
  ONE_ON_ONE = 1,
  ONE_ON_TWO = 2,
  GROUP = 3,
  LARGE_CLASS = 4
}

// 课程来源
export enum CourseSourceType {
  SELF = 1,
  INSTITUTION = 2,
  MIXED = 3
}

// 是否上门
export enum ServiceType {
  IN_CENTER = 1,
  AT_HOME = 2
}

// 上课地址
export interface Room {
  id: string;
  name: string;
  address?: string;
  count: number;  // 使用次数
  created_at: string;
  updated_at: string;
}

// 机构信息
export interface Institution {
  id: string;
  name: string;
  contact_person?: string;
  contact_phone?: string;
  revenue_share?: number;
  notes?: string;
  created_at: string;
}

// 计费单位
export enum BillingUnit {
  PER_HOUR = 1,
  PER_SESSION = 2
}

// 课时费计算方式
export enum TeacherFeeMode {
  PER_SESSION = 1,
  PER_STUDENT = 2
}

// 学生课程定价
export interface StudentCoursePricing {
  student_id: string;
  tuition: number;
  teacher_fee?: number;
  status?: number;  // 出勤状态（用于本次课请假）
}

// 课程
export interface Course {
  id: string;
  name: string;
  year?: number;       // 年份（用于大班课/小组课命名）
  semester?: string;   // 学期：春学期/秋学期/寒假/暑假
  display_name: string; // 显示名称（只显示课程名，年份学期用于区分重名）
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
  active: boolean; // 存续状态：true-未结课，false-已结课
  default_duration_minutes?: number; // 默认单次课时长（分钟），拖拽排课时自动使用
  color?: string;   // 课程背景色（根据上课地址自动分配，同地址同色）
  notes?: string;
  created_at: string;
  updated_at: string;
}

// 排课状态
export enum ScheduleStatus {
  PLANNED = 1,    // 计划中
  COMPLETED = 2,  // 已完成
  CANCELLED = 3,  // 已取消
  LEAVE = 4       // 请假
}

// 排课
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

// 选课关联
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

// 缴费类型
export enum PaymentType {
  TUITION = 1,
  HOURS = 2
}

// 缴费记录
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

// 课时消耗
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

// 统计数据
export interface RevenueStats {
  total: number;
  totalSchedules: number;
  byDate?: { date: string; amount: number }[];
  byMonth?: { month: string; amount: number }[];
  byYear?: { year: number; amount: number }[];
  byCourseType?: { type: CourseType; typeName: string; amount: number; percentage: number }[];
  bySourceType?: { sourceType: CourseSourceType; sourceName: string; amount: number; percentage: number }[];
  byServiceType?: { serviceType: ServiceType; serviceName: string; amount: number; percentage: number }[];
  byInstitution?: { institutionId: string; institutionName: string; amount: number; percentage: number }[];
}

export interface StudentTuitionStats {
  studentId: string;
  studentName: string;
  total: number;
  byCourseType?: { type: CourseType; typeName: string; amount: number }[];
}

// 老师
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

// 学校信息（自动存储）
export interface SchoolInfo {
  id: string;
  name: string;
  count: number;  // 使用次数
  created_at: string;
  updated_at: string;
}

// ===== 资产统计类型定义 =====
export interface AssetCategory {
  id: string;
  name: string;
  type: 'income' | 'expense';
  color?: string;
  created_at: string;
  updated_at: string;
}

export interface AssetRecord {
  id: string;
  date: string;           // YYYY-MM-DD
  type: 'income' | 'expense';
  category_id: string;
  category_name: string;
  amount: number;
  student_id?: string;
  student_name?: string;
  note?: string;
  created_at: string;
  updated_at: string;
}

export interface AssetStats {
  totalIncome: number;
  totalExpense: number;
  netAmount: number;
  incomeByCategory: { category: string; amount: number; count: number }[];
  expenseByCategory: { category: string; amount: number; count: number }[];
  monthlyTrend: { month: string; income: number; expense: number }[];
}

export interface KnowledgeNode {
  id: string;
  name: string;
  parent_id?: string;
  children: string[];
  order: number;
  created_at: string;
  updated_at: string;
}

export interface Tag {
  id: string;
  tag_type: 'knowledge' | 'model' | 'source';
  tag_name: string;
  tag_code: string;
  parent_id: string | null;
  subject: string;
  sort_no: number;
  status: number;
  created_at: string;
  updated_at: string;
}

export interface Question {
  id: string;
  subject: string;
  chapter?: string;
  knowledge_point?: string;
  knowledge_ids?: string[];        // 关联知识点ID
  type: '单选题' | '多选题' | '实验题' | '解答题' | '判断题';
  difficulty: number;
  content: string;
  options?: string[];
  answer: string;
  analysis?: string;
  formulas?: string[];             // 公式
  tags?: string[];                 // 标签
  source?: string;                 // 来源
  year?: string;                   // 学年 (如 2025-2026)
  grade?: string;                  // 年级
  semester?: string;               // 学期
  exam_type?: string;              // 考试类型
  region?: string;                 // 地区
  sub_questions?: any[];           // 子题（大题包含小题）
  variant_ids?: string[];          // 变式题ID列表
  status?: 'draft' | 'pending' | 'published' | 'offline' | 'deprecated';
  has_image?: boolean;
  has_formula?: boolean;
  created_by?: string;
  created_at: string;
  updated_at: string;
}
