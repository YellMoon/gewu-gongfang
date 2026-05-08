/**
 * SQLite 数据库层 v3.1
 * 使用 better-sqlite3 同步API，匹配 browserDatabase.ts 的业务逻辑
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

class DatabaseService {
  constructor() {
    this.db = null;
    this.dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'scheduling.db');
    this._init();
  }

  _init() {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    this.db.exec(schema);
    console.log(`[DB] 初始化完成: ${this.dbPath}`);
  }

  // ==================== 通用CRUD辅助 ====================

  _now() { return new Date().toISOString(); }

  _get(table, id) {
    return this.db.prepare(`SELECT * FROM ${table} WHERE id = ? AND deleted = 0`).get(id);
  }

  _list(table, orderBy = 'created_at DESC') {
    return this.db.prepare(`SELECT * FROM ${table} WHERE deleted = 0 ORDER BY ${orderBy}`).all();
  }

  _insert(table, data) {
    const now = this._now();
    const record = { ...data, created_at: now, updated_at: now };
    const keys = Object.keys(record);
    const vals = Object.values(record);
    const placeholders = keys.map(() => '?').join(', ');
    this.db.prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`).run(...vals);
    return record;
  }

  _update(table, id, updates) {
    const now = this._now();
    updates.updated_at = now;
    const keys = Object.keys(updates);
    const vals = Object.values(updates);
    const setClause = keys.map(k => `${k} = ?`).join(', ');
    this.db.prepare(`UPDATE ${table} SET ${setClause} WHERE id = ? AND deleted = 0`).run(...vals, id);
    return this._get(table, id);
  }

  _softDelete(table, id) {
    const now = this._now();
    this.db.prepare(`UPDATE ${table} SET deleted = 1, updated_at = ? WHERE id = ?`).run(now, id);
    return true;
  }

  _count(table, where = '1=1', params = []) {
    const row = this.db.prepare(`SELECT COUNT(*) as cnt FROM ${table} WHERE ${where}`).get(...params);
    return row.cnt;
  }

  // ==================== 学生管理 ====================

  getAllStudents() {
    return this._list('students', 'created_at DESC');
  }

  getStudentById(id) {
    return this._get('students', id);
  }

  createStudent(data) {
    const id = uuidv4();
    return this._insert('students', {
      id,
      name: data.name,
      phone: data.phone || null,
      school: data.school || null,
      grade_year: data.grade_year || null,
      grade_current: data.grade_current || null,
      source_type: data.source_type || 1,
      institution_id: data.institution_id || null,
      parent_name: data.parent_name || null,
      parent_wechat: data.parent_wechat || null,
      student_source: data.student_source || null,
      balance_hours: data.balance_hours || 0,
      balance_money: data.balance_money || 0,
      notes: data.notes || null
    });
  }

  updateStudent(id, updates) {
    const allowed = ['name', 'phone', 'school', 'grade_year', 'grade_current', 'source_type',
      'institution_id', 'parent_name', 'parent_wechat', 'student_source',
      'balance_hours', 'balance_money', 'notes'];
    const filtered = {};
    for (const k of allowed) if (updates[k] !== undefined) filtered[k] = updates[k];
    if (Object.keys(filtered).length === 0) return this._get('students', id);
    return this._update('students', id, filtered);
  }

  deleteStudent(id) {
    return this._softDelete('students', id);
  }

  // 获取成绩
  getGrades(studentId) {
    return this.db.prepare(
      'SELECT * FROM grades WHERE student_id = ? AND deleted = 0 ORDER BY exam_date DESC'
    ).all(studentId);
  }

  createGrade(data) {
    const id = uuidv4();
    return this._insert('grades', {
      id, student_id: data.student_id, subject: data.subject,
      score: data.score, exam_date: data.exam_date || null, notes: data.notes || null
    });
  }

  // ==================== 课程管理 ====================

  getAllCourses() {
    return this._list('courses', 'created_at DESC');
  }

  getCourseById(id) {
    return this._get('courses', id);
  }

  createCourse(data) {
    const id = uuidv4();
    return this._insert('courses', {
      id, name: data.name, year: data.year || null, semester: data.semester || null,
      display_name: data.display_name || data.name, type: data.type, source_type: data.source_type,
      institution_id: data.institution_id || null,
      price_tuition: data.price_tuition || 0, price_teacher: data.price_teacher || 0,
      billing_unit: data.billing_unit || 1, teacher_fee_mode: data.teacher_fee_mode || 1,
      student_pricings: data.student_pricings ? JSON.stringify(data.student_pricings) : null,
      room_id: data.room_id || null, room_name: data.room_name || null,
      teacher_id: data.teacher_id || null, teacher_name: data.teacher_name || null,
      active: data.active !== undefined ? (data.active ? 1 : 0) : 1,
      default_duration_minutes: data.default_duration_minutes || null,
      notes: data.notes || null
    });
  }

  updateCourse(id, updates) {
    const allowed = ['name', 'year', 'semester', 'display_name', 'type', 'source_type',
      'institution_id', 'price_tuition', 'price_teacher', 'billing_unit', 'teacher_fee_mode',
      'room_id', 'room_name', 'teacher_id', 'teacher_name', 'active',
      'default_duration_minutes', 'notes'];
    const filtered = {};
    for (const k of allowed) if (updates[k] !== undefined) {
      if (k === 'student_pricings') filtered[k] = JSON.stringify(updates[k]);
      else if (k === 'active') filtered[k] = updates[k] ? 1 : 0;
      else filtered[k] = updates[k];
    }
    if (Object.keys(filtered).length === 0) return this._get('courses', id);
    return this._update('courses', id, filtered);
  }

  deleteCourse(id) { return this._softDelete('courses', id); }

  // ==================== 排课管理 ====================

  getAllSchedules() {
    return this._list('schedules', 'start_time DESC');
  }

  getSchedulesByDateRange(start, end) {
    return this.db.prepare(
      `SELECT * FROM schedules WHERE deleted = 0 AND start_time >= ? AND end_time <= ? ORDER BY start_time`
    ).all(start, end);
  }

  getScheduleById(id) {
    return this._get('schedules', id);
  }

  createSchedule(data) {
    const id = uuidv4();
    return this._insert('schedules', {
      id, course_id: data.course_id, start_time: data.start_time, end_time: data.end_time,
      recurring_rule: data.recurring_rule || null,
      status: data.status || 1, room: data.room || null,
      service_type: data.service_type || null,
      student_ids: data.student_ids ? JSON.stringify(data.student_ids) : null,
      student_pricings: data.student_pricings ? JSON.stringify(data.student_pricings) : null,
      calculated_tuition: data.calculated_tuition || 0,
      calculated_teacher_fee: data.calculated_teacher_fee || 0,
      notes: data.notes || null
    });
  }

  updateSchedule(id, updates) {
    const allowed = ['course_id', 'start_time', 'end_time', 'recurring_rule', 'status',
      'room', 'service_type', 'student_ids', 'student_pricings',
      'calculated_tuition', 'calculated_teacher_fee', 'notes'];
    const filtered = {};
    for (const k of allowed) {
      if (updates[k] !== undefined) {
        if (k === 'student_ids' || k === 'student_pricings') filtered[k] = JSON.stringify(updates[k]);
        else filtered[k] = updates[k];
      }
    }
    if (Object.keys(filtered).length === 0) return this._get('schedules', id);
    return this._update('schedules', id, filtered);
  }

  deleteSchedule(id) { return this._softDelete('schedules', id); }

  checkTimeConflict(startTime, endTime, excludeScheduleId) {
    let sql = `SELECT * FROM schedules WHERE deleted = 0 AND status NOT IN (3) AND NOT (end_time <= ? OR start_time >= ?)`;
    const params = [startTime, endTime];
    if (excludeScheduleId) { sql += ' AND id != ?'; params.push(excludeScheduleId); }
    return this.db.prepare(sql).all(...params);
  }

  // ==================== 选课关联 ====================

  getEnrollmentsBySchedule(scheduleId) {
    return this.db.prepare('SELECT * FROM enrollments WHERE schedule_id = ? AND deleted = 0').all(scheduleId);
  }

  getEnrollmentsByStudent(studentId) {
    return this.db.prepare('SELECT * FROM enrollments WHERE student_id = ? AND deleted = 0').all(studentId);
  }

  createEnrollment(data) {
    const id = uuidv4();
    return this._insert('enrollments', {
      id, schedule_id: data.schedule_id, student_id: data.student_id,
      custom_price: data.custom_price || null,
      hours_consumed: data.hours_consumed || 0,
      status: data.status || 1, notes: data.notes || null
    });
  }

  updateEnrollment(id, updates) {
    const allowed = ['custom_price', 'hours_consumed', 'status', 'notes'];
    const filtered = {};
    for (const k of allowed) if (updates[k] !== undefined) filtered[k] = updates[k];
    if (Object.keys(filtered).length === 0) return this._get('enrollments', id);
    return this._update('enrollments', id, filtered);
  }

  deleteEnrollment(id) { return this._softDelete('enrollments', id); }

  // ==================== 缴费管理 ====================

  getAllPayments() { return this._list('payments', 'payment_date DESC'); }

  getPaymentsByStudent(studentId) {
    return this.db.prepare(
      'SELECT * FROM payments WHERE student_id = ? AND deleted = 0 ORDER BY payment_date DESC'
    ).all(studentId);
  }

  createPayment(data) {
    const id = uuidv4();
    const payment = this._insert('payments', {
      id, student_id: data.student_id, amount: data.amount,
      payment_type: data.payment_type, payment_date: data.payment_date,
      payment_method: data.payment_method || null, notes: data.notes || null
    });
    // 更新学生余额
    const student = this._get('students', data.student_id);
    if (student) {
      if (data.payment_type === 1) {  // 学费
        this._update('students', data.student_id, { balance_money: student.balance_money + data.amount });
      } else if (data.payment_type === 2) {  // 课时
        this._update('students', data.student_id, { balance_hours: student.balance_hours + data.amount });
      }
    }
    return payment;
  }

  // ==================== 课时消耗 ====================

  getAllConsumptions() { return this._list('consumptions', 'consumption_date DESC'); }

  getConsumptionsByStudent(studentId) {
    return this.db.prepare(
      'SELECT * FROM consumptions WHERE student_id = ? AND deleted = 0 ORDER BY consumption_date DESC'
    ).all(studentId);
  }

  createConsumption(data) {
    const id = uuidv4();
    const consumption = this._insert('consumptions', {
      id, schedule_id: data.schedule_id, student_id: data.student_id,
      hours: data.hours, amount: data.amount, consumption_date: data.consumption_date,
      notes: data.notes || null
    });
    // 更新学生余额
    const student = this._get('students', data.student_id);
    if (student) {
      this._update('students', data.student_id, {
        balance_hours: student.balance_hours - data.hours,
        balance_money: student.balance_money - data.amount
      });
    }
    return consumption;
  }

  // ==================== 老师管理 ====================

  getAllTeachers() { return this._list('teachers', 'created_at DESC'); }
  getTeacherById(id) { return this._get('teachers', id); }

  createTeacher(data) {
    const id = uuidv4();
    return this._insert('teachers', {
      id, name: data.name, phone: data.phone || null,
      subject: data.subject || null, hourly_rate: data.hourly_rate || null,
      notes: data.notes || null
    });
  }

  updateTeacher(id, updates) {
    const allowed = ['name', 'phone', 'subject', 'hourly_rate', 'notes'];
    const filtered = {};
    for (const k of allowed) if (updates[k] !== undefined) filtered[k] = updates[k];
    if (Object.keys(filtered).length === 0) return this._get('teachers', id);
    return this._update('teachers', id, filtered);
  }

  deleteTeacher(id) { return this._softDelete('teachers', id); }

  // ==================== 教室管理 ====================

  getAllRooms() { return this._list('rooms', 'created_at DESC'); }
  getRoomById(id) { return this._get('rooms', id); }

  createRoom(data) {
    const id = uuidv4();
    return this._insert('rooms', {
      id, name: data.name, address: data.address || '', count: 1
    });
  }

  updateRoom(id, updates) {
    const allowed = ['name', 'address'];
    const filtered = {};
    for (const k of allowed) if (updates[k] !== undefined) filtered[k] = updates[k];
    if (Object.keys(filtered).length === 0) return this._get('rooms', id);
    return this._update('rooms', id, filtered);
  }

  deleteRoom(id) { return this._softDelete('rooms', id); }

  // ==================== 学校管理 ====================

  getAllSchools() { return this._list('schools', 'name ASC'); }

  addOrUpdateSchool(name) {
    const existing = this.db.prepare('SELECT * FROM schools WHERE name = ? AND deleted = 0').get(name);
    if (existing) {
      return this._update('schools', existing.id, { count: existing.count + 1 });
    }
    const id = uuidv4();
    return this._insert('schools', { id, name, count: 1 });
  }

  // ==================== 机构管理 ====================

  getAllInstitutions() { return this._list('institutions', 'created_at DESC'); }
  getInstitutionById(id) { return this._get('institutions', id); }

  createInstitution(data) {
    const id = uuidv4();
    return this._insert('institutions', {
      id, name: data.name, contact_person: data.contact_person || null,
      contact_phone: data.contact_phone || null, revenue_share: data.revenue_share || null,
      notes: data.notes || null
    });
  }

  updateInstitution(id, updates) {
    const allowed = ['name', 'contact_person', 'contact_phone', 'revenue_share', 'notes'];
    const filtered = {};
    for (const k of allowed) if (updates[k] !== undefined) filtered[k] = updates[k];
    if (Object.keys(filtered).length === 0) return this._get('institutions', id);
    return this._update('institutions', id, filtered);
  }

  deleteInstitution(id) { return this._softDelete('institutions', id); }

  // ==================== 统计数据 ====================

  getRevenueStats(startDate, endDate) {
    const schedules = this.db.prepare(
      `SELECT * FROM schedules WHERE deleted = 0 AND status = 2 AND start_time >= ? AND start_time <= ?`
    ).all(startDate, endDate);

    let total = 0;
    const byCourseType = {};
    const bySourceType = {};
    const byInstitution = {};
    const byMonth = {};

    schedules.forEach(s => {
      const tuition = s.calculated_tuition || 0;
      total += tuition;
      const course = this.db.prepare('SELECT * FROM courses WHERE id = ?').get(s.course_id);
      if (course) {
        byCourseType[course.type] = (byCourseType[course.type] || 0) + tuition;
        bySourceType[course.source_type] = (bySourceType[course.source_type] || 0) + tuition;
        if (course.institution_id) {
          byInstitution[course.institution_id] = (byInstitution[course.institution_id] || 0) + tuition;
        }
      }
      const month = s.start_time.substring(0, 7);
      byMonth[month] = (byMonth[month] || 0) + tuition;
    });

    const names = { 1: '一对一', 2: '一对二', 3: '小组课', 4: '大班课' };
    const srcNames = { 1: '自有课程', 2: '机构排课', 3: '混合班' };

    const pct = (v) => total > 0 ? Math.round(v / total * 10000) / 100 : 0;

    return {
      total, totalSchedules: schedules.length,
      byCourseType: Object.entries(byCourseType).map(([type, amount]) => ({
        type: Number(type), typeName: names[type] || '未知', amount, percentage: pct(amount)
      })),
      bySourceType: Object.entries(bySourceType).map(([st, amount]) => ({
        sourceType: Number(st), sourceName: srcNames[st] || '未知', amount, percentage: pct(amount)
      })),
      byInstitution: Object.entries(byInstitution).map(([instId, amount]) => {
        const inst = this.db.prepare('SELECT name FROM institutions WHERE id = ?').get(instId);
        return { institutionId: instId, institutionName: inst?.name || '未知机构', amount, percentage: pct(amount) };
      }),
      byMonth: Object.entries(byMonth).map(([month, amount]) => ({ month, amount }))
    };
  }

  getConsumptionStats(startDate, endDate) {
    const row = this.db.prepare(
      `SELECT SUM(hours) as total_hours, SUM(amount) as total_amount, COUNT(*) as count
       FROM consumptions WHERE deleted = 0 AND consumption_date >= ? AND consumption_date <= ?`
    ).get(startDate, endDate);
    return { total_hours: row.total_hours || 0, total_amount: row.total_amount || 0, count: row.count || 0 };
  }

  // ==================== 数据导出/导入 ====================

  exportAll() {
    return {
      students: this._list('students'),
      grades: this._list('grades'),
      courses: this._list('courses'),
      schedules: this._list('schedules'),
      enrollments: this._list('enrollments'),
      payments: this._list('payments'),
      consumptions: this._list('consumptions'),
      institutions: this._list('institutions'),
      schools: this._list('schools'),
      rooms: this._list('rooms'),
      teachers: this._list('teachers'),
      exported_at: this._now()
    };
  }

  importAll(data) {
    const transaction = this.db.transaction((data) => {
      const tables = ['students', 'grades', 'courses', 'schedules', 'enrollments',
        'payments', 'consumptions', 'institutions', 'schools', 'rooms', 'teachers'];
      for (const table of tables) {
        if (data[table] && Array.isArray(data[table])) {
          for (const row of data[table]) {
            const keys = Object.keys(row);
            const vals = Object.values(row);
            const placeholders = keys.map(() => '?').join(', ');
            this.db.prepare(
              `INSERT OR REPLACE INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`
            ).run(...vals);
          }
        }
      }
    });
    transaction(data);
    return { imported: true };
  }

  // ==================== 同步支持 ====================

  /**
   * 获取指定时间后的所有变更（包括软删除记录）
   */
  getChangesSince(table, sinceTime) {
    return this.db.prepare(
      `SELECT * FROM ${table} WHERE updated_at > ? ORDER BY updated_at ASC`
    ).all(sinceTime);
  }

  /**
   * 获取所有表的变更
   */
  getChangesSinceAll(sinceTime) {
    const tables = ['students', 'grades', 'courses', 'schedules', 'enrollments',
      'payments', 'consumptions', 'institutions', 'schools', 'rooms', 'teachers'];
    const result = {};
    for (const table of tables) {
      result[table] = this.getChangesSince(table, sinceTime);
    }
    result.server_time = this._now();
    return result;
  }

  /**
   * 应用客户端推送的变更
   */
  applyPushChanges(clientId, changes) {
    const transaction = this.db.transaction((changes) => {
      const tables = ['students', 'grades', 'courses', 'schedules', 'enrollments',
        'payments', 'consumptions', 'institutions', 'schools', 'rooms', 'teachers'];
      const now = this._now();
      const results = { applied: 0, conflicts: 0, errors: [] };

      for (const table of tables) {
        const records = changes[table] || [];
        for (const record of records) {
          try {
            const existing = this.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(record.id);
            if (existing && existing.updated_at >= record.updated_at) {
              // 服务端数据更新，冲突
              results.conflicts++;
              this.db.prepare(
                `INSERT INTO sync_log (client_id, action, table_name, record_id, sync_time, status) VALUES (?, 'push', ?, ?, ?, 'conflict')`
              ).run(clientId, table, record.id, now);
              continue;
            }
            // INSERT OR REPLACE
            const keys = Object.keys(record);
            const vals = Object.values(record);
            record.updated_at = now;  // 更新时间戳
            const newVals = keys.map(k => record[k]);
            const placeholders = keys.map(() => '?').join(', ');
            this.db.prepare(
              `INSERT OR REPLACE INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`
            ).run(...newVals);
            results.applied++;
            this.db.prepare(
              `INSERT INTO sync_log (client_id, action, table_name, record_id, sync_time, status) VALUES (?, 'push', ?, ?, ?, 'success')`
            ).run(clientId, table, record.id, now);
          } catch (e) {
            results.errors.push({ table, id: record.id, error: e.message });
          }
        }
      }
      return results;
    });
    return transaction(changes);
  }

  /**
   * 获取同步状态
   */
  getSyncStatus() {
    const tables = ['students', 'grades', 'courses', 'schedules', 'enrollments',
      'payments', 'consumptions', 'institutions', 'schools', 'rooms', 'teachers'];
    const status = {};
    for (const table of tables) {
      const total = this.db.prepare(`SELECT COUNT(*) as cnt FROM ${table} WHERE deleted = 0`).get();
      const lastUpdate = this.db.prepare(
        `SELECT MAX(updated_at) as ts FROM ${table}`
      ).get();
      status[table] = { count: total.cnt, last_updated: lastUpdate.ts };
    }
    status.server_time = this._now();
    return status;
  }

  // ==================== 认证 ====================

  findOrCreateUserByWechat(openid, unionid, nickname, avatarUrl) {
    let user = this.db.prepare('SELECT * FROM users WHERE wechat_openid = ? AND deleted = 0').get(openid);
    if (!user) {
      const id = uuidv4();
      user = this._insert('users', {
        id, wechat_openid: openid, wechat_unionid: unionid || null,
        nickname: nickname || null, avatar_url: avatarUrl || null, role: 'admin'
      });
    }
    return user;
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

// 单例
let instance = null;

function getInstance() {
  if (!instance) instance = new DatabaseService();
  return instance;
}

module.exports = { DatabaseService, getInstance };
