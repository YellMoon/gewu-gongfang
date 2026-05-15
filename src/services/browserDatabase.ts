// 数据库服务层 v1.3 - 支持学生来源、学校存储、课程状态
import { 
  Student, Grade, Course, Schedule, Enrollment, Payment, Consumption, Institution, SchoolInfo, Teacher, Room,
  ScheduleStatus, PaymentType, BillingUnit, TeacherFeeMode, ServiceType, StudentSource,
  RevenueStats, StudentTuitionStats, StudentCoursePricing,
  AssetRecord, AssetCategory, AssetStats, Question, KnowledgeNode
} from '../types';
import type { SyncTable } from './syncEngine';
import { calculateGrade, calculateFees, calculateDurationHours, groupByMonth, calculatePercentage } from '../utils/helpers';

interface Database {
  students: Student[];
  grades: Grade[];
  courses: Course[];
  schedules: Schedule[];
  enrollments: Enrollment[];
  payments: Payment[];
  consumptions: Consumption[];
  institutions: Institution[];
  schools: SchoolInfo[];
  rooms: Room[];
  teachers: Teacher[];
  assetRecords: AssetRecord[];
  assetCategories: AssetCategory[];
  questions: Question[];
  knowledgeTree: KnowledgeNode[];
  modelTree: KnowledgeNode[];
}

type SyncLocalDataMaps = Partial<Record<SyncTable, Map<string, any>>>;

const SYNC_TABLES: SyncTable[] = [
  'students',
  'courses',
  'schedules',
  'payments',
  'consumptions',
  'teachers',
  'grades',
  'rooms',
  'institutions',
  'assetRecords',
  'questions',
  'assetCategories',
];

class BrowserDatabaseService {
  private storageKey = 'scheduling_system_db_v3';
  private data: Database = {
    students: [],
    grades: [],
    courses: [],
    schedules: [],
    enrollments: [],
    payments: [],
    consumptions: [],
    assetRecords: [],
    assetCategories: [],
    questions: [],
    knowledgeTree: [],
    modelTree: [],
    institutions: [],
    schools: [],
    rooms: [],
    teachers: []
  };

  constructor() {
    this.loadData();
  }

  private loadData(): void {
    const stored = localStorage.getItem(this.storageKey);
    if (stored) {
      const loadedData = JSON.parse(stored);
      // 合并数据，确保所有数组字段都存在，旧版本数据缺失就用 []
      this.data = {
        students: [],
        grades: [],
        courses: [],
        schedules: [],
        enrollments: [],
        payments: [],
        consumptions: [],
        institutions: [],
        schools: [],
        rooms: [],
        teachers: [],
        assetRecords: [],
        assetCategories: [
          {id:'builtin-tuition',name:'课时费',type:'income',color:'#3f8600',created_at:'2026-01-01T00:00:00.000Z',updated_at:'2026-01-01T00:00:00.000Z'},
          {id:'builtin-payment',name:'学费',type:'income',color:'#1890ff',created_at:'2026-01-01T00:00:00.000Z',updated_at:'2026-01-01T00:00:00.000Z'},
          {id:'builtin-salary',name:'工资支出',type:'expense',color:'#cf1322',created_at:'2026-01-01T00:00:00.000Z',updated_at:'2026-01-01T00:00:00.000Z'},
          {id:'builtin-rent',name:'房租',type:'expense',color:'#fa8c16',created_at:'2026-01-01T00:00:00.000Z',updated_at:'2026-01-01T00:00:00.000Z'},
          {id:'builtin-material',name:'教材费',type:'expense',color:'#722ed1',created_at:'2026-01-01T00:00:00.000Z',updated_at:'2026-01-01T00:00:00.000Z'},
          {id:'builtin-other-income',name:'其他收入',type:'income',color:'#13c2c2',created_at:'2026-01-01T00:00:00.000Z',updated_at:'2026-01-01T00:00:00.000Z'},
          {id:'builtin-other-expense',name:'其他支出',type:'expense',color:'#eb2f96',created_at:'2026-01-01T00:00:00.000Z',updated_at:'2026-01-01T00:00:00.000Z'},
        ],
        questions: [],
        knowledgeTree: loadedData?.knowledgeTree ?? [],
        modelTree: loadedData?.modelTree ?? [],
        ...loadedData
      };
    }
    // 自动清理：修复课程时间 > 24:00 的坏数据
    this.data.schedules = (this.data.schedules || []).map(s => {
      if (!s) return s;
      const fixTime = (t: string): string => {
        const [datePart, timePart] = t.split(' ');
        if (!timePart) return t;
        const [h, m] = timePart.split(':').map(Number);
        if (h >= 24) {
          return `${datePart} 23:${String(m).padStart(2, '0')}`;
        } else if (h < 0) {
          return `${datePart} 00:${String(m).padStart(2, '0')}`;
        }
        return t;
      };
      if (s.start_time) s.start_time = fixTime(s.start_time);
      if (s.end_time) s.end_time = fixTime(s.end_time);
      return s;
    });

    // 自动更新学生年级
    this.data.students = (this.data.students || []).map(s => ({
      ...s,
      grade_current: calculateGrade(s.grade_year)
    }));
  }

  private saveData(): void {
    localStorage.setItem(this.storageKey, JSON.stringify(this.data));
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  // ========== 学校信息管理 ==========
  
  getAllSchools(): SchoolInfo[] {
    return this.data.schools;
  }

  // ========== 教室/地址管理 ==========
  
  getAllRooms(): Room[] {
    return this.data.rooms;
  }

  addOrUpdateRoom(roomName: string, address?: string): void {
    const existing = this.data.rooms.find(s => s.name === roomName);
    if (existing) {
      existing.count++;
      existing.updated_at = new Date().toISOString();
      if (address) existing.address = address;
    } else {
      this.data.rooms.push({
        id: this.generateId(),
        name: roomName,
        address: address || '',
        count: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    }
    this.saveData();
  }

  updateRoom(id: string, updates: Partial<Room>): Room | undefined {
    const index = this.data.rooms.findIndex(r => r.id === id);
    if (index === -1) return undefined;
    this.data.rooms[index] = { ...this.data.rooms[index], ...updates, updated_at: new Date().toISOString() };
    this.saveData();
    return this.data.rooms[index];
  }

  deleteRoom(id: string): boolean {
    const index = this.data.rooms.findIndex(r => r.id === id);
    if (index === -1) return false;
    this.data.rooms.splice(index, 1);
    this.saveData();
    return true;
  }

  // ========== 学校信息管理 ==========

  getSchoolNames(): string[] {
    return this.data.schools.map(s => s.name).sort();
  }

  addOrUpdateSchool(schoolName: string): void {
    const existing = this.data.schools.find(s => s.name === schoolName);
    if (existing) {
      existing.count++;
      existing.updated_at = new Date().toISOString();
    } else {
      this.data.schools.push({
        id: this.generateId(),
        name: schoolName,
        count: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    }
    this.saveData();
  }

  // ========== 机构管理 ==========
  
  getAllInstitutions(): Institution[] {
    return this.data.institutions;
  }

  createInstitution(institution: Omit<Institution, 'id' | 'created_at'>): Institution {
    const now = new Date().toISOString();
    const newInstitution: Institution = {
      ...institution,
      id: this.generateId(),
      created_at: now
    };
    this.data.institutions.push(newInstitution);
    this.saveData();
    return newInstitution;
  }

  updateInstitution(id: string, updates: Partial<Institution>): Institution | undefined {
    const index = this.data.institutions.findIndex(i => i.id === id);
    if (index === -1) return undefined;
    this.data.institutions[index] = { ...this.data.institutions[index], ...updates };
    this.saveData();
    return this.data.institutions[index];
  }

  deleteInstitution(id: string): boolean {
    const index = this.data.institutions.findIndex(i => i.id === id);
    if (index === -1) return false;
    this.data.institutions.splice(index, 1);
    this.saveData();
    return true;
  }

  // ========== 学生管理 ==========
  
  getAllStudents(): Student[] {
    return this.data.students;
  }

  getStudentById(id: string): Student | undefined {
    return this.data.students.find(s => s.id === id);
  }

  createStudent(student: Omit<Student, 'id' | 'created_at' | 'updated_at'>): Student {
    const now = new Date().toISOString();
    const newStudent: Student = {
      ...student,
      id: this.generateId(),
      grade_current: calculateGrade(student.grade_year),
      created_at: now,
      updated_at: now
    };
    
    // 如果提供了学校，添加到学校库
    if (student.school) {
      this.addOrUpdateSchool(student.school);
    }
    
    this.data.students.push(newStudent);
    this.saveData();
    return newStudent;
  }

  updateStudent(id: string, updates: Partial<Student>): Student | undefined {
    const index = this.data.students.findIndex(s => s.id === id);
    if (index === -1) return undefined;
    
    const updated = {
      ...this.data.students[index],
      ...updates,
      updated_at: new Date().toISOString()
    };
    
    // 如果更新了入学年份，重新计算年级
    if (updates.grade_year) {
      updated.grade_current = calculateGrade(updates.grade_year);
    }
    
    // 如果提供了新学校，添加到学校库
    if (updates.school && updates.school !== this.data.students[index].school) {
      this.addOrUpdateSchool(updates.school);
    }
    
    this.data.students[index] = updated;
    this.saveData();
    return updated;
  }

  deleteStudent(id: string): boolean {
    const index = this.data.students.findIndex(s => s.id === id);
    if (index === -1) return false;
    this.data.students.splice(index, 1);
    this.saveData();
    return true;
  }

  // ========== 课程管理 ==========
  
  getAllCourses(): Course[] {
    return this.data.courses;
  }

  getCourseById(id: string): Course | undefined {
    return this.data.courses.find(c => c.id === id);
  }

  createCourse(course: Omit<Course, 'id' | 'created_at' | 'updated_at'>): Course {
    const now = new Date().toISOString();
    const newCourse: Course = {
      ...course,
      id: this.generateId(),
      created_at: now,
      updated_at: now
    };
    // 如果提供了新教室名称，自动添加到教室库
    if (newCourse.room_name && !this.data.rooms.find(r => r.name === newCourse.room_name)) {
      this.addOrUpdateRoom(newCourse.room_name);
    }
    this.data.courses.push(newCourse);
    this.saveData();
    return newCourse;
  }

  updateCourse(id: string, updates: Partial<Course>): Course | undefined {
    const index = this.data.courses.findIndex(c => c.id === id);
    if (index === -1) return undefined;
    
    this.data.courses[index] = {
      ...this.data.courses[index],
      ...updates,
      updated_at: new Date().toISOString()
    };
    // 如果更新了新教室名称，自动添加到教室库
    if (updates.room_name && !this.data.rooms.find(r => r.name === updates.room_name)) {
      this.addOrUpdateRoom(updates.room_name);
    }
    this.saveData();
    return this.data.courses[index];
  }

  deleteCourse(id: string): boolean {
    const index = this.data.courses.findIndex(c => c.id === id);
    if (index === -1) return false;
    this.data.courses.splice(index, 1);
    this.saveData();
    return true;
  }

  // ========== 排课管理 ==========
  
  getAllSchedules(): Schedule[] {
    return this.data.schedules;
  }

  getScheduleById(id: string): Schedule | undefined {
    return this.data.schedules.find(s => s.id === id);
  }

  createSchedule(schedule: Omit<Schedule, 'id' | 'created_at' | 'updated_at'>): Schedule {
    const now = new Date().toISOString();
    const newSchedule: Schedule = {
      ...schedule,
      id: this.generateId(),
      created_at: now,
      updated_at: now
    };
    this.data.schedules.push(newSchedule);
    this.saveData();
    return newSchedule;
  }

  updateSchedule(id: string, updates: Partial<Schedule>): Schedule | undefined {
    const index = this.data.schedules.findIndex(s => s.id === id);
    if (index === -1) return undefined;
    
    this.data.schedules[index] = {
      ...this.data.schedules[index],
      ...updates,
      updated_at: new Date().toISOString()
    };
    this.saveData();
    return this.data.schedules[index];
  }

  deleteSchedule(id: string): boolean {
    const index = this.data.schedules.findIndex(s => s.id === id);
    if (index === -1) return false;
    this.data.schedules.splice(index, 1);
    this.saveData();
    return true;
  }

  checkTimeConflict(startTime: string, endTime: string, excludeScheduleId?: string): Schedule[] {
    return this.data.schedules.filter(s => {
      if (s.status === ScheduleStatus.CANCELLED || s.status === ScheduleStatus.LEAVE) return false;
      if (s.id === excludeScheduleId) return false;
      return !(s.end_time <= startTime || s.start_time >= endTime);
    });
  }

  // ========== 统计数据 ==========
  
  getRevenueStats(startDate: string, endDate: string): RevenueStats {
    const schedules = this.data.schedules.filter(s => 
      s.status === ScheduleStatus.COMPLETED &&
      s.start_time >= startDate && s.start_time <= endDate
    );

    let total = 0;
    const byCourseType = new Map();
    const bySourceType = new Map();
    const byServiceType = new Map(); // 保留 map 不影响，只是不统计数据
    const byInstitution = new Map();
    const byMonth = new Map();

    schedules.forEach(schedule => {
      const tuition = schedule.calculated_tuition || 0;
      total += tuition;

      const course = this.data.courses.find(c => c.id === schedule.course_id);
      if (course) {
        byCourseType.set(course.type, (byCourseType.get(course.type) || 0) + tuition);
        bySourceType.set(course.source_type, (bySourceType.get(course.source_type) || 0) + tuition);
        // 删除服务类型统计，需求要求删除服务类型
        if (course.institution_id) {
          byInstitution.set(course.institution_id, (byInstitution.get(course.institution_id) || 0) + tuition);
        }
      }

      const month = schedule.start_time.substring(0, 7);
      byMonth.set(month, (byMonth.get(month) || 0) + tuition);
    });

    const courseTypeNames = { 1: '一对一', 2: '一对二', 3: '小组课', 4: '大班课' };
    const sourceTypeNames = { 1: '自有课程', 2: '机构排课', 3: '混合班' };
    const serviceTypeNames = { 1: '中心内', 2: '上门' };

    return {
      total,
      totalSchedules: schedules.length,
      byCourseType: Array.from(byCourseType.entries()).map(([type, amount]) => ({
        type: type as any,
        typeName: courseTypeNames[type as keyof typeof courseTypeNames] || '未知',
        amount,
        percentage: calculatePercentage(amount, total)
      })),
      bySourceType: Array.from(bySourceType.entries()).map(([sourceType, amount]) => ({
        sourceType: sourceType as any,
        sourceName: sourceTypeNames[sourceType as keyof typeof sourceTypeNames] || '未知',
        amount,
        percentage: calculatePercentage(amount, total)
      })),
      byServiceType: Array.from(byServiceType.entries()).map(([serviceType, amount]) => ({
        serviceType: serviceType as any,
        serviceName: serviceTypeNames[serviceType as keyof typeof serviceTypeNames] || '未知',
        amount,
        percentage: calculatePercentage(amount, total)
      })),
      byInstitution: Array.from(byInstitution.entries()).map(([instId, amount]) => {
        const inst = this.data.institutions.find(i => i.id === instId);
        return {
          institutionId: instId,
          institutionName: inst?.name || '未知机构',
          amount,
          percentage: calculatePercentage(amount, total)
        };
      }),
      byMonth: Array.from(byMonth.entries()).map(([month, amount]) => ({
        month,
        amount
      }))
    };
  }

  getStudentTuitionStats(startDate: string, endDate: string): StudentTuitionStats[] {
    const schedules = this.data.schedules.filter(s => 
      s.status === ScheduleStatus.COMPLETED &&
      s.start_time >= startDate && s.start_time <= endDate
    );

    const studentStats = new Map();

    schedules.forEach(schedule => {
      const studentIds = schedule.student_ids || [];
      const tuition = schedule.calculated_tuition || 0;
      const perStudentTuition = studentIds.length > 0 ? tuition / studentIds.length : tuition;

      studentIds.forEach(studentId => {
        if (!studentStats.has(studentId)) {
          studentStats.set(studentId, { total: 0, byCourseType: new Map() });
        }
        
        const stats = studentStats.get(studentId)!;
        stats.total += perStudentTuition;

        const course = this.data.courses.find(c => c.id === schedule.course_id);
        if (course) {
          stats.byCourseType.set(course.type, (stats.byCourseType.get(course.type) || 0) + perStudentTuition);
        }
      });
    });

    const courseTypeNames = { 1: '一对一', 2: '一对二', 3: '小组课', 4: '大班课' };

    // @ts-ignore - 原项目类型错误，保持原样
    return Array.from(studentStats.entries()).map(([studentId, stats]) => {
      const student = this.data.students.find(s => s.id === studentId);
      return {
        studentId,
        studentName: student?.name || '未知学生',
        total: stats.total,
        // @ts-ignore - 原项目类型错误，保持原样
      byCourseType: Array.from(stats.byCourseType.entries()).map(([type, amount]) => ({
          type: type as any,
          typeName: courseTypeNames[type as keyof typeof courseTypeNames] || '未知',
          amount
        }))
      };
    // @ts-ignore - 原项目类型错误，保持原样
    }).sort((a, b) => b.total - a.total);
  }

  // ========== 老师管理 ==========
  
  getAllTeachers(): Teacher[] {
    return this.data.teachers;
  }

  getTeacherById(id: string): Teacher | undefined {
    return this.data.teachers.find(t => t.id === id);
  }

  createTeacher(teacher: Omit<Teacher, 'id' | 'created_at' | 'updated_at'>): Teacher {
    const now = new Date().toISOString();
    const newTeacher: Teacher = {
      ...teacher,
      id: this.generateId(),
      created_at: now,
      updated_at: now
    };
    this.data.teachers.push(newTeacher);
    this.saveData();
    return newTeacher;
  }

  updateTeacher(id: string, updates: Partial<Omit<Teacher, 'id' | 'created_at' | 'updated_at'>>): Teacher | undefined {
    const index = this.data.teachers.findIndex(t => t.id === id);
    if (index !== -1) {
      this.data.teachers[index] = {
        ...this.data.teachers[index],
        ...updates,
        updated_at: new Date().toISOString()
      };
      this.saveData();
      return this.data.teachers[index];
    }
    return undefined;
  }

  deleteTeacher(id: string): void {
    this.data.teachers = this.data.teachers.filter(t => t.id !== id);
    this.saveData();
  }

  // ========== 缴费记录管理 ==========
  
  getAllPayments(): Payment[] {
    return this.data.payments;
  }

  getPaymentById(id: string): Payment | undefined {
    return this.data.payments.find(p => p.id === id);
  }

  getPaymentsByStudentId(studentId: string): Payment[] {
    return this.data.payments.filter(p => p.student_id === studentId);
  }

  createPayment(payment: Omit<Payment, 'id' | 'created_at'>): Payment {
    const now = new Date().toISOString();
    const newPayment: Payment = {
      ...payment,
      id: this.generateId(),
      created_at: now
    };
    this.data.payments.push(newPayment);
    this.saveData();
    return newPayment;
  }

  updatePayment(id: string, updates: Partial<Omit<Payment, 'id' | 'created_at'>>): Payment | undefined {
    const index = this.data.payments.findIndex(p => p.id === id);
    if (index !== -1) {
      this.data.payments[index] = {
        ...this.data.payments[index],
        ...updates
      };
      this.saveData();
      return this.data.payments[index];
    }
    return undefined;
  }

  deletePayment(id: string): void {
    this.data.payments = this.data.payments.filter(p => p.id !== id);
    this.saveData();
  }

  // ========== 课时消耗记录管理 ==========
  
  getAllConsumptions(): Consumption[] {
    return this.data.consumptions;
  }

  getConsumptionById(id: string): Consumption | undefined {
    return this.data.consumptions.find(c => c.id === id);
  }

  getConsumptionsByStudentId(studentId: string): Consumption[] {
    return this.data.consumptions.filter(c => c.student_id === studentId);
  }

  createConsumption(consumption: Omit<Consumption, 'id' | 'created_at'>): Consumption {
    const now = new Date().toISOString();
    const newConsumption: Consumption = {
      ...consumption,
      id: this.generateId(),
      created_at: now
    };
    this.data.consumptions.push(newConsumption);
    this.saveData();
    return newConsumption;
  }

  updateConsumption(id: string, updates: Partial<Omit<Consumption, 'id' | 'created_at'>>): Consumption | undefined {
    const index = this.data.consumptions.findIndex(c => c.id === id);
    if (index !== -1) {
      this.data.consumptions[index] = {
        ...this.data.consumptions[index],
        ...updates
      };
      this.saveData();
      return this.data.consumptions[index];
    }
    return undefined;
  }

  deleteConsumption(id: string): void {
    this.data.consumptions = this.data.consumptions.filter(c => c.id !== id);
    this.saveData();
  }

  // ========== 数据导出/导入 ==========
  
  exportAllData(): Database & { exported_at: string } {
    return {
      ...this.data,
      exported_at: new Date().toISOString()
    };
  }

  importAllData(data: any): void {
    this.data = {
      students: data.students || [],
      grades: data.grades || [],
      courses: data.courses || [],
      schedules: data.schedules || [],
      enrollments: data.enrollments || [],
      payments: data.payments || [],
      consumptions: data.consumptions || [],
      institutions: data.institutions || [],
      schools: data.schools || [],
      rooms: data.rooms || [],
      teachers: data.teachers || [],
      assetRecords: data.assetRecords || [],
      assetCategories: data.assetCategories || [],
      questions: data.questions || [],
      knowledgeTree: data.knowledgeTree || [],
      modelTree: data.modelTree || []
    };
    this.saveData();
  }

  buildSyncLocalDataMaps(): SyncLocalDataMaps {
    return SYNC_TABLES.reduce<SyncLocalDataMaps>((maps, table) => {
      const records = (this.data[table] || []) as Array<{ id?: string; [key: string]: any }>;
      const syncableRecords = records.filter((record): record is { id: string; [key: string]: any } => Boolean(record?.id));
      maps[table] = new Map(
        syncableRecords.map(record => [record.id, { ...record }])
      );
      return maps;
    }, {});
  }

  applySyncLocalDataMaps(localData: SyncLocalDataMaps): void {
    for (const table of SYNC_TABLES) {
      const map = localData[table];
      if (!map) continue;
      this.data[table] = Array.from(map.values()).map(record => {
        const { _synced, ...cleanRecord } = record || {};
        return cleanRecord;
      });
    }
    this.saveData();
  }

  // ========== 资产统计管理 ==========

  getAllAssetRecords(): AssetRecord[] {
    return this.data.assetRecords;
  }

  getAssetRecordsByDateRange(startDate: string, endDate: string): AssetRecord[] {
    return this.data.assetRecords.filter(r => r.date >= startDate && r.date <= endDate);
  }

  createAssetRecord(record: Omit<AssetRecord, 'id' | 'created_at' | 'updated_at'>): AssetRecord {
    const now = new Date().toISOString();
    const newRecord: AssetRecord = {
      ...record,
      id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2),
      created_at: now,
      updated_at: now
    };
    this.data.assetRecords.push(newRecord);
    this.saveData();
    return newRecord;
  }

  updateAssetRecord(id: string, updates: Partial<Omit<AssetRecord, 'id' | 'created_at'>>): boolean {
    const idx = this.data.assetRecords.findIndex(r => r.id === id);
    if (idx === -1) return false;
    this.data.assetRecords[idx] = { ...this.data.assetRecords[idx], ...updates, updated_at: new Date().toISOString() };
    this.saveData();
    return true;
  }

  deleteAssetRecord(id: string): boolean {
    const idx = this.data.assetRecords.findIndex(r => r.id === id);
    if (idx === -1) return false;
    this.data.assetRecords.splice(idx, 1);
    this.saveData();
    return true;
  }

  // ========== 资产分类管理 ==========

  getAllAssetCategories(): AssetCategory[] {
    return this.data.assetCategories;
  }

  getAssetCategoriesByType(type: 'income' | 'expense'): AssetCategory[] {
    return this.data.assetCategories.filter(c => c.type === type);
  }

  createAssetCategory(cat: Omit<AssetCategory, 'id' | 'created_at' | 'updated_at'>): AssetCategory {
    const now = new Date().toISOString();
    const newCat: AssetCategory = {
      ...cat,
      id: 'cat-' + (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)),
      created_at: now,
      updated_at: now
    };
    this.data.assetCategories.push(newCat);
    this.saveData();
    return newCat;
  }

  deleteAssetCategory(id: string): boolean {
    if (id.startsWith('builtin-')) return false; // 内置分类不可删除
    const idx = this.data.assetCategories.findIndex(c => c.id === id);
    if (idx === -1) return false;
    this.data.assetCategories.splice(idx, 1);
    this.saveData();
    return true;
  }

  // ========== 资产统计 ==========

  getAssetStats(startDate: string, endDate: string): AssetStats {
    const records = this.data.assetRecords.filter(r => r.date >= startDate && r.date <= endDate);
    const income = records.filter(r => r.type === 'income');
    const expense = records.filter(r => r.type === 'expense');
    const totalIncome = income.reduce((s, r) => s + r.amount, 0);
    const totalExpense = expense.reduce((s, r) => s + r.amount, 0);

    // 按分类汇总
    const incomeByCat = new Map<string, { amount: number; count: number }>();
    const expenseByCat = new Map<string, { amount: number; count: number }>();
    for (const r of income) {
      const prev = incomeByCat.get(r.category_name) || { amount: 0, count: 0 };
      incomeByCat.set(r.category_name, { amount: prev.amount + r.amount, count: prev.count + 1 });
    }
    for (const r of expense) {
      const prev = expenseByCat.get(r.category_name) || { amount: 0, count: 0 };
      expenseByCat.set(r.category_name, { amount: prev.amount + r.amount, count: prev.count + 1 });
    }

    // 月度趋势
    const monthlyMap = new Map<string, { income: number; expense: number }>();
    for (const r of records) {
      const month = r.date.substring(0, 7);
      const prev = monthlyMap.get(month) || { income: 0, expense: 0 };
      if (r.type === 'income') prev.income += r.amount;
      else prev.expense += r.amount;
      monthlyMap.set(month, prev);
    }

    return {
      totalIncome,
      totalExpense,
      netAmount: totalIncome - totalExpense,
      incomeByCategory: Array.from(incomeByCat.entries()).map(([k, v]) => ({ category: k, ...v })),
      expenseByCategory: Array.from(expenseByCat.entries()).map(([k, v]) => ({ category: k, ...v })),
      monthlyTrend: Array.from(monthlyMap.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => ({ month: k, ...v }))
    };
  }

  // ========== 成绩管理 ==========

  getAllGrades(): Grade[] {
    return this.data.grades;
  }

  getGradesByStudentId(studentId: string): Grade[] {
    return this.data.grades.filter(g => g.student_id === studentId);
  }

  createGrade(grade: Omit<Grade, 'id' | 'created_at'>): Grade {
    const now = new Date().toISOString();
    const id = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
    const newGrade: Grade = { ...grade, id, created_at: now };
    this.data.grades.push(newGrade);
    this.saveData();
    return newGrade;
  }

  deleteGrade(id: string): boolean {
    const idx = this.data.grades.findIndex(g => g.id === id);
    if (idx === -1) return false;
    this.data.grades.splice(idx, 1);
    this.saveData();
    return true;
  }

  getPerformanceStats(): { subjectStats: { subject: string; avgScore: number; max: number; min: number; count: number }[]; totalExams: number } {
    const grades = this.data.grades;
    const bySubject = new Map<string, { sum: number; max: number; min: number; count: number }>();
    for (const g of grades) {
      const prev = bySubject.get(g.subject) || { sum: 0, max: -Infinity, min: Infinity, count: 0 };
      prev.sum += g.score;
      prev.max = Math.max(prev.max, g.score);
      prev.min = Math.min(prev.min, g.score);
      prev.count++;
      bySubject.set(g.subject, prev);
    }
    return {
      subjectStats: Array.from(bySubject.entries()).map(([k, v]) => ({
        subject: k,
        avgScore: Math.round(v.sum / v.count * 10) / 10,
        max: v.max,
        min: v.min,
        count: v.count
      })),
      totalExams: grades.length
    };
  }

  // ========== 题库管理 ==========

  getAllQuestions(): Question[] {
    return this.data.questions;
  }

  getQuestionsBySubject(subject: string): Question[] {
    return this.data.questions.filter(q => q.subject === subject);
  }

  createQuestion(question: Omit<Question, 'id' | 'created_at' | 'updated_at'>): Question {
    const now = new Date().toISOString();
    const id = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
    const newQuestion: Question = {
      ...question,
      id,
      created_at: now,
      updated_at: now
    };
    this.data.questions.push(newQuestion);
    this.saveData();
    return newQuestion;
  }

  updateQuestion(id: string, updates: Partial<Omit<Question, 'id' | 'created_at'>>): boolean {
    const idx = this.data.questions.findIndex(q => q.id === id);
    if (idx === -1) return false;
    this.data.questions[idx] = { ...this.data.questions[idx], ...updates, updated_at: new Date().toISOString() };
    this.saveData();
    return true;
  }

  deleteQuestion(id: string): boolean {
    const idx = this.data.questions.findIndex(q => q.id === id);
    if (idx === -1) return false;
    this.data.questions.splice(idx, 1);
    this.saveData();
    return true;
  }

  // ========== 知识树管理 ==========

  getQuestionKnowledgePoints(questionId: string): KnowledgeNode[] | null {
    const question = this.data.questions.find(q => q.id === questionId);
    if (!question) return null;
    const ids = new Set(question.knowledge_ids || []);
    return this.data.knowledgeTree.filter(node => ids.has(node.id));
  }

  setQuestionKnowledgePoints(questionId: string, knowledgeIds: string[]): Question | null {
    const question = this.data.questions.find(q => q.id === questionId);
    if (!question) return null;
    const validIds = new Set(this.data.knowledgeTree.map(node => node.id));
    const nextIds = [...new Set((knowledgeIds || []).filter(id => validIds.has(id)))];
    const primary = nextIds.length > 0 ? this.data.knowledgeTree.find(node => node.id === nextIds[0]) : null;
    question.knowledge_ids = nextIds;
    question.knowledge_point = primary?.name || '';
    question.updated_at = new Date().toISOString();
    this.saveData();
    return question;
  }

  addQuestionKnowledgePoints(questionId: string, knowledgeIds: string[]): Question | null {
    const question = this.data.questions.find(q => q.id === questionId);
    if (!question) return null;
    return this.setQuestionKnowledgePoints(questionId, [...(question.knowledge_ids || []), ...(knowledgeIds || [])]);
  }

  removeQuestionKnowledgePoints(questionId: string, knowledgeIds: string[]): Question | null {
    const question = this.data.questions.find(q => q.id === questionId);
    if (!question) return null;
    const removeSet = new Set(knowledgeIds || []);
    return this.setQuestionKnowledgePoints(questionId, (question.knowledge_ids || []).filter(id => !removeSet.has(id)));
  }

  getKnowledgeTree(): KnowledgeNode[] {
    return this.data.knowledgeTree;
  }

  getFlatKnowledgeNodes(): { id: string; name: string; path: string }[] {
    const result: { id: string; name: string; path: string }[] = [];
    const buildPath = (nodes: KnowledgeNode[], parentPath: string) => {
      for (const n of nodes) {
        const currentPath = parentPath ? `${parentPath} > ${n.name}` : n.name;
        result.push({ id: n.id, name: n.name, path: currentPath });
        const children = this.data.knowledgeTree.filter(c => c.parent_id === n.id);
        if (children.length > 0) buildPath(children, currentPath);
      }
    };
    const roots = this.data.knowledgeTree.filter(n => !n.parent_id);
    buildPath(roots, '');
    return result;
  }

  initDefaultKnowledgeTree(): void {
    if (this.data.knowledgeTree.length > 0) return;
    const now = new Date().toISOString();
    this.data.knowledgeTree = [
      {id:'phy-1',name:'力学',children:[],order:1,created_at:now,updated_at:now},
      {id:'phy-1-1',name:'运动学',parent_id:'phy-1',children:[],order:1,created_at:now,updated_at:now},
      {id:'phy-1-1-1',name:'匀速直线运动',parent_id:'phy-1-1',children:[],order:1,created_at:now,updated_at:now},
      {id:'phy-1-1-2',name:'变速直线运动',parent_id:'phy-1-1',children:[],order:2,created_at:now,updated_at:now},
      {id:'phy-1-1-3',name:'曲线运动',parent_id:'phy-1-1',children:[],order:3,created_at:now,updated_at:now},
      {id:'phy-1-1-4',name:'相对运动',parent_id:'phy-1-1',children:[],order:4,created_at:now,updated_at:now},
      {id:'phy-1-2',name:'动力学',parent_id:'phy-1',children:[],order:2,created_at:now,updated_at:now},
      {id:'phy-1-2-1',name:'牛顿运动定律',parent_id:'phy-1-2',children:[],order:1,created_at:now,updated_at:now},
      {id:'phy-1-2-2',name:'受力分析',parent_id:'phy-1-2',children:[],order:2,created_at:now,updated_at:now},
      {id:'phy-1-2-3',name:'连接体问题',parent_id:'phy-1-2',children:[],order:3,created_at:now,updated_at:now},
      {id:'phy-1-3',name:'功和能',parent_id:'phy-1',children:[],order:3,created_at:now,updated_at:now},
      {id:'phy-1-4',name:'动量',parent_id:'phy-1',children:[],order:4,created_at:now,updated_at:now},
      {id:'phy-2',name:'电磁学',children:[],order:2,created_at:now,updated_at:now},
      {id:'phy-2-1',name:'静电场',parent_id:'phy-2',children:[],order:1,created_at:now,updated_at:now},
      {id:'phy-2-2',name:'恒定电流',parent_id:'phy-2',children:[],order:2,created_at:now,updated_at:now},
      {id:'phy-2-3',name:'磁场',parent_id:'phy-2',children:[],order:3,created_at:now,updated_at:now},
      {id:'phy-2-4',name:'电磁感应',parent_id:'phy-2',children:[],order:4,created_at:now,updated_at:now},
      {id:'phy-2-5',name:'交变电流',parent_id:'phy-2',children:[],order:5,created_at:now,updated_at:now},
      {id:'phy-3',name:'热学',children:[],order:3,created_at:now,updated_at:now},
      {id:'phy-4',name:'光学',children:[],order:4,created_at:now,updated_at:now},
      {id:'phy-5',name:'原子物理',children:[],order:5,created_at:now,updated_at:now},
      {id:'phy-6',name:'实验',children:[],order:6,created_at:now,updated_at:now},
    ];
    // 更新children数组
    this._rebuildKnowledgeChildren();
    this.saveData();
  }

  private _rebuildKnowledgeChildren(): void {
    for (const n of this.data.knowledgeTree) {
      n.children = this.data.knowledgeTree.filter(c => c.parent_id === n.id).map(c => c.id);
    }
  }

  createKnowledgeNode(node: Omit<KnowledgeNode, 'id' | 'created_at' | 'updated_at'>): KnowledgeNode {
    const now = new Date().toISOString();
    const newNode: KnowledgeNode = {
      ...node,
      id: 'kn-' + (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)),
      created_at: now,
      updated_at: now
    };
    this.data.knowledgeTree.push(newNode);
    this._rebuildKnowledgeChildren();
    this.saveData();
    return newNode;
  }

  updateKnowledgeNode(id: string, updates: Partial<Omit<KnowledgeNode, 'id'>>): boolean {
    const idx = this.data.knowledgeTree.findIndex(n => n.id === id);
    if (idx === -1) return false;
    const oldName = this.data.knowledgeTree[idx].name;
    this.data.knowledgeTree[idx] = { ...this.data.knowledgeTree[idx], ...updates, updated_at: new Date().toISOString() };
    this._rebuildKnowledgeChildren();

    // If name changed, sync knowledge_point in questions referencing this node
    const newName = updates.name;
    if (newName !== undefined && newName !== oldName) {
      for (const q of this.data.questions) {
        if (q.knowledge_ids && q.knowledge_ids.includes(id)) {
          if (q.knowledge_point === oldName) {
            q.knowledge_point = newName;
          }
        }
      }
    }

    this.saveData();
    return true;
  }

  deleteKnowledgeNode(id: string): boolean {
    const idsToDelete = this.collectDescendantIds(id);
    if (idsToDelete.length === 0) return false;

    this.data.knowledgeTree = this.data.knowledgeTree.filter(n => !idsToDelete.includes(n.id));

    // Clean up question references: remove deleted knowledge IDs from all questions
    for (const q of this.data.questions) {
      if (q.knowledge_ids && q.knowledge_ids.length > 0) {
        q.knowledge_ids = q.knowledge_ids.filter(kid => !idsToDelete.includes(kid));
      }
    }

    this._rebuildKnowledgeChildren();
    this.saveData();
    return true;
  }

  private collectDescendantIds(id: string): string[] {
    const result: string[] = [id];
    const children = this.data.knowledgeTree.filter(n => n.parent_id === id);
    for (const child of children) {
      const childIds = this.collectDescendantIds(child.id);
      result.push(...childIds);
    }
    return result;
  }

  getKnowledgeChildren(parentId: string): KnowledgeNode[] {
    return this.data.knowledgeTree.filter(n => n.parent_id === parentId).sort((a, b) => a.order - b.order);
  }

  // ========== 模型树管理 ==========

  getModelTree(): KnowledgeNode[] {
    return this.data.modelTree || [];
  }

  initDefaultModelTree(): void {
    if ((this.data.modelTree || []).length > 0) return;
    const now = new Date().toISOString();
    this.data.modelTree = [
      { id: 'model-1', name: '运动模型', children: [], order: 1, created_at: now, updated_at: now },
      { id: 'model-1-1', name: '匀变速直线运动模型', parent_id: 'model-1', children: [], order: 1, created_at: now, updated_at: now },
      { id: 'model-1-2', name: '平抛运动模型', parent_id: 'model-1', children: [], order: 2, created_at: now, updated_at: now },
      { id: 'model-2', name: '受力模型', children: [], order: 2, created_at: now, updated_at: now },
      { id: 'model-2-1', name: '连接体模型', parent_id: 'model-2', children: [], order: 1, created_at: now, updated_at: now },
      { id: 'model-2-2', name: '临界极值模型', parent_id: 'model-2', children: [], order: 2, created_at: now, updated_at: now },
      { id: 'model-3', name: '能量模型', children: [], order: 3, created_at: now, updated_at: now },
      { id: 'model-4', name: '电磁模型', children: [], order: 4, created_at: now, updated_at: now },
    ];
    this._rebuildModelChildren();
    this.saveData();
  }

  private _rebuildModelChildren(): void {
    this.data.modelTree = this.data.modelTree || [];
    for (const n of this.data.modelTree) {
      n.children = this.data.modelTree.filter(c => c.parent_id === n.id).map(c => c.id);
    }
  }

  createModelNode(node: Omit<KnowledgeNode, 'id' | 'created_at' | 'updated_at'>): KnowledgeNode {
    const now = new Date().toISOString();
    const newNode: KnowledgeNode = {
      ...node,
      id: 'model-' + (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)),
      created_at: now,
      updated_at: now,
    };
    this.data.modelTree = this.data.modelTree || [];
    this.data.modelTree.push(newNode);
    this._rebuildModelChildren();
    this.saveData();
    return newNode;
  }

  updateModelNode(id: string, updates: Partial<Omit<KnowledgeNode, 'id'>>): boolean {
    this.data.modelTree = this.data.modelTree || [];
    const idx = this.data.modelTree.findIndex(n => n.id === id);
    if (idx === -1) return false;
    const oldName = this.data.modelTree[idx].name;
    this.data.modelTree[idx] = { ...this.data.modelTree[idx], ...updates, updated_at: new Date().toISOString() };
    this._rebuildModelChildren();
    const newName = updates.name;
    if (newName !== undefined && newName !== oldName) {
      for (const q of this.data.questions) {
        if (q.model_ids && q.model_ids.includes(id) && q.model_point === oldName) {
          q.model_point = newName;
        }
      }
    }
    this.saveData();
    return true;
  }

  deleteModelNode(id: string): boolean {
    const idsToDelete = this.collectModelDescendantIds(id);
    if (idsToDelete.length === 0) return false;
    this.data.modelTree = (this.data.modelTree || []).filter(n => !idsToDelete.includes(n.id));
    for (const q of this.data.questions) {
      if (q.model_ids && q.model_ids.length > 0) {
        q.model_ids = q.model_ids.filter(mid => !idsToDelete.includes(mid));
        const primary = q.model_ids.length > 0 ? this.data.modelTree.find(node => node.id === q.model_ids![0]) : null;
        q.model_point = primary?.name || '';
      }
    }
    this._rebuildModelChildren();
    this.saveData();
    return true;
  }

  private collectModelDescendantIds(id: string): string[] {
    const result: string[] = [id];
    const children = (this.data.modelTree || []).filter(n => n.parent_id === id);
    for (const child of children) {
      result.push(...this.collectModelDescendantIds(child.id));
    }
    return result;
  }

  setQuestionModelPoints(questionId: string, modelIds: string[]): Question | null {
    const question = this.data.questions.find(q => q.id === questionId);
    if (!question) return null;
    const validIds = new Set((this.data.modelTree || []).map(node => node.id));
    const nextIds = [...new Set((modelIds || []).filter(id => validIds.has(id)))];
    const primary = nextIds.length > 0 ? this.data.modelTree.find(node => node.id === nextIds[0]) : null;
    question.model_ids = nextIds;
    question.model_point = primary?.name || '';
    question.updated_at = new Date().toISOString();
    this.saveData();
    return question;
  }

  addQuestionModelPoints(questionId: string, modelIds: string[]): Question | null {
    const question = this.data.questions.find(q => q.id === questionId);
    if (!question) return null;
    return this.setQuestionModelPoints(questionId, [...(question.model_ids || []), ...(modelIds || [])]);
  }
}

export default new BrowserDatabaseService();
