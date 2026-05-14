/**
 * SQLite 鏁版嵁搴撳眰 v3.1
 * 浣跨敤 better-sqlite3 鍚屾API锛屽尮閰?browserDatabase.ts 鐨勪笟鍔￠€昏緫
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

class DatabaseService {
  constructor() {
    this.db = null;
    this.readDb = null;
    this.dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'scheduling.db');
    this.readDbPath = process.env.READ_DB_PATH || this.dbPath;
    this._init();
  }

  _init() {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    if (this.readDbPath !== this.dbPath) {
      this.readDb = new Database(this.readDbPath, { readonly: true, fileMustExist: true });
      this.readDb.pragma('foreign_keys = ON');
    } else {
      this.readDb = this.db;
    }

    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    this.db.exec(schema);
    console.log(`[DB] 鍒濆鍖栧畬鎴? ${this.dbPath}`);
  }

  // ==================== 閫氱敤CRUD杈呭姪 ====================

  _now() { return new Date().toISOString(); }

  _reader() { return this.readDb || this.db; }

  _get(table, id) {
    return this._reader().prepare(`SELECT * FROM ${table} WHERE id = ? AND deleted = 0`).get(id);
  }

  _list(table, orderBy = 'created_at DESC') {
    return this._reader().prepare(`SELECT * FROM ${table} WHERE deleted = 0 ORDER BY ${orderBy}`).all();
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
    const row = this._reader().prepare(`SELECT COUNT(*) as cnt FROM ${table} WHERE ${where}`).get(...params);
    return row.cnt;
  }

  _syncTables() {
    return ['students', 'grades', 'courses', 'schedules', 'enrollments',
      'payments', 'consumptions', 'institutions', 'schools', 'rooms', 'teachers',
      'subjects', 'chapters', 'knowledge_points', 'questions', 'question_contents',
      'question_assets'];
  }

  _tableColumns(table) {
    return this._reader().prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  }

  _auditSync(event) {
    const now = this._now();
    this.db.prepare(
      `INSERT INTO sync_audit_log
       (id, tenant_id, client_id, protocol_version, action, table_name, record_id,
        local_updated_at, server_updated_at, resolution, status, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      uuidv4(),
      event.tenant_id || 'default',
      event.client_id || 'unknown',
      event.protocol_version || 'v1-lww',
      event.action,
      event.table_name || null,
      event.record_id || null,
      event.local_updated_at || null,
      event.server_updated_at || null,
      event.resolution || 'lww',
      event.status,
      event.detail ? JSON.stringify(event.detail) : null,
      now
    );
  }

  // ==================== 瀛︾敓绠＄悊 ====================

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

  // 鑾峰彇鎴愮哗
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

  // ==================== 璇剧▼绠＄悊 ====================

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

  // ==================== 鎺掕绠＄悊 ====================

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

  // ==================== 閫夎鍏宠仈 ====================

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

  // ==================== 缂磋垂绠＄悊 ====================

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
    // 鏇存柊瀛︾敓浣欓
    const student = this._get('students', data.student_id);
    if (student) {
      if (data.payment_type === 1) {  // 瀛﹁垂
        this._update('students', data.student_id, { balance_money: student.balance_money + data.amount });
      } else if (data.payment_type === 2) {  // 璇炬椂
        this._update('students', data.student_id, { balance_hours: student.balance_hours + data.amount });
      }
    }
    return payment;
  }

  // ==================== 璇炬椂娑堣€?====================

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
    // 鏇存柊瀛︾敓浣欓
    const student = this._get('students', data.student_id);
    if (student) {
      this._update('students', data.student_id, {
        balance_hours: student.balance_hours - data.hours,
        balance_money: student.balance_money - data.amount
      });
    }
    return consumption;
  }

  // ==================== 鑰佸笀绠＄悊 ====================

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

  // ==================== 鏁欏绠＄悊 ====================

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

  // ==================== 瀛︽牎绠＄悊 ====================

  getAllSchools() { return this._list('schools', 'name ASC'); }

  addOrUpdateSchool(name) {
    const existing = this.db.prepare('SELECT * FROM schools WHERE name = ? AND deleted = 0').get(name);
    if (existing) {
      return this._update('schools', existing.id, { count: existing.count + 1 });
    }
    const id = uuidv4();
    return this._insert('schools', { id, name, count: 1 });
  }

  // ==================== 鏈烘瀯绠＄悊 ====================

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

  // ==================== 缁熻鏁版嵁 ====================

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

  // ==================== 鏁版嵁瀵煎嚭/瀵煎叆 ====================

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

  _normalizeSyncTime(value) {
    if (!value) return '1970-01-01T00:00:00.000Z';
    if (typeof value === 'number') return new Date(value).toISOString();
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? '1970-01-01T00:00:00.000Z' : new Date(parsed).toISOString();
  }

  _changeId(table, recordId, updatedAt, action, deviceId = 'server') {
    return `${table}:${recordId}:${updatedAt}:${action}:${deviceId}`;
  }

  _toSyncChange(table, record, deviceId = 'server', tenantId = 'default') {
    const updatedAt = this._normalizeSyncTime(record.updated_at || record.created_at || this._now());
    const deleted = Number(record.deleted || 0) === 1;
    const action = deleted ? 'delete' : (record.created_at && record.created_at === record.updated_at ? 'create' : 'update');
    return {
      id: record._sync_operation_id || this._changeId(table, record.id, updatedAt, action, deviceId),
      table,
      action,
      data: { ...record },
      version: updatedAt,
      updatedAt,
      tenantId: record.tenant_id || tenantId,
      deviceId: record._sync_client_id || deviceId,
    };
  }

  _normalizeClientChange(change, fallbackDeviceId = 'unknown') {
    const data = { ...(change.data || change.fields || {}) };
    const table = change.table;
    const recordId = data.id || change.recordId || change.record_id || change.id;
    const action = change.action || (data.deleted ? 'delete' : 'update');
    const updatedAt = this._normalizeSyncTime(change.updatedAt || change.updated_at || change.timestamp || data.updated_at || this._now());
    return {
      id: change.id || this._changeId(table, recordId, updatedAt, action, fallbackDeviceId),
      table,
      action,
      data: { ...data, id: recordId },
      version: change.version || updatedAt,
      updatedAt,
      tenantId: change.tenantId || change.tenant_id || data.tenant_id || 'default',
      deviceId: change.deviceId || change.device_id || change.clientId || change.client_id || fallbackDeviceId,
    };
  }

  _legacyChangesToQueue(changes, fallbackDeviceId = 'unknown') {
    if (Array.isArray(changes)) {
      return changes.map(change => this._normalizeClientChange(change, fallbackDeviceId));
    }
    const queue = [];
    for (const [table, records] of Object.entries(changes || {})) {
      if (!Array.isArray(records)) continue;
      for (const record of records) {
        queue.push(this._normalizeClientChange({
          id: record._sync_operation_id,
          table,
          action: record._sync_action || (record.deleted ? 'delete' : 'update'),
          data: record,
          updatedAt: record.updated_at,
          deviceId: record._sync_client_id || fallbackDeviceId,
          tenantId: record.tenant_id || 'default',
        }, fallbackDeviceId));
      }
    }
    return queue;
  }

  getChangesSince(table, sinceTime) {
    const columns = this._tableColumns(table);
    if (!columns.includes('updated_at')) return [];
    const sinceIso = this._normalizeSyncTime(sinceTime);
    return this._reader().prepare(
      `SELECT * FROM ${table} WHERE updated_at > ? ORDER BY updated_at ASC`
    ).all(sinceIso);
  }

  getChangesSinceAll(sinceTime) {
    const tables = this._syncTables();
    const result = {};
    for (const table of tables) {
      result[table] = this.getChangesSince(table, sinceTime);
    }
    result.server_time = this._now();
    return result;
  }

  getChangeQueueSince(sinceTime, options = {}) {
    const tenantId = options.tenantId || 'default';
    const deviceId = options.deviceId || 'server';
    const queue = [];
    for (const table of this._syncTables()) {
      for (const record of this.getChangesSince(table, sinceTime)) {
        queue.push(this._toSyncChange(table, record, deviceId, tenantId));
      }
    }
    queue.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    return { changes: queue, serverTime: this._now() };
  }

  applySyncChanges(changes, options = {}) {
    const deviceId = options.deviceId || 'unknown';
    const queue = this._legacyChangesToQueue(changes, deviceId);
    const transaction = this.db.transaction((normalizedChanges) => {
      const now = this._now();
      const results = { applied: 0, conflicts: 0, errors: [] };

      for (const change of normalizedChanges) {
        const table = change.table;
        if (!this._syncTables().includes(table)) {
          results.errors.push({ table, id: change.id, error: 'table is not syncable' });
          continue;
        }
        const columns = this._tableColumns(table);
        const record = { ...(change.data || {}) };
        const recordId = record.id;
        if (!recordId) {
          results.errors.push({ table, id: change.id, error: 'missing record id' });
          continue;
        }
        try {
          const existing = this.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(recordId);
          if (existing && existing.updated_at > change.updatedAt) {
            results.conflicts++;
            this._auditSync({
              tenant_id: change.tenantId,
              client_id: change.deviceId,
              protocol_version: 'v2-change-queue',
              action: change.action,
              table_name: table,
              record_id: recordId,
              local_updated_at: change.updatedAt,
              server_updated_at: existing.updated_at,
              resolution: 'server-wins',
              status: 'conflict',
              detail: { changeId: change.id },
            });
            this.db.prepare(
              `INSERT INTO sync_log (client_id, action, table_name, record_id, sync_time, status) VALUES (?, 'push', ?, ?, ?, 'conflict')`
            ).run(change.deviceId, table, recordId, now);
            continue;
          }

          const incoming = { ...record };
          incoming.updated_at = now;
          if (columns.includes('created_at') && !incoming.created_at) incoming.created_at = existing?.created_at || now;
          if (columns.includes('deleted')) incoming.deleted = change.action === 'delete' ? 1 : (incoming.deleted || 0);
          if (columns.includes('tenant_id') && !incoming.tenant_id) incoming.tenant_id = change.tenantId;

          const keys = Object.keys(incoming).filter(k => columns.includes(k));
          const vals = keys.map(k => incoming[k]);
          const placeholders = keys.map(() => '?').join(', ');
          this.db.prepare(
            `INSERT OR REPLACE INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`
          ).run(...vals);
          results.applied++;
          this._auditSync({
            tenant_id: change.tenantId,
            client_id: change.deviceId,
            protocol_version: 'v2-change-queue',
            action: change.action,
            table_name: table,
            record_id: recordId,
            local_updated_at: change.updatedAt,
            server_updated_at: now,
            resolution: 'lww-client-wins',
            status: 'success',
            detail: { changeId: change.id },
          });
          this.db.prepare(
            `INSERT INTO sync_log (client_id, action, table_name, record_id, sync_time, status) VALUES (?, 'push', ?, ?, ?, 'success')`
          ).run(change.deviceId, table, recordId, now);
        } catch (e) {
          this._auditSync({
            tenant_id: change.tenantId,
            client_id: change.deviceId,
            protocol_version: 'v2-change-queue',
            action: change.action,
            table_name: table,
            record_id: recordId,
            local_updated_at: change.updatedAt,
            server_updated_at: now,
            resolution: 'error',
            status: 'error',
            detail: { changeId: change.id, error: e.message },
          });
          results.errors.push({ table, id: recordId, error: e.message });
        }
      }
      return results;
    });
    return transaction(queue);
  }

  applyPushChanges(clientId, changes) {
    return this.applySyncChanges(changes, { deviceId: clientId || 'unknown' });
  }
  /**
   * 鑾峰彇鍚屾鐘舵€?   */
  getSyncStatus() {
    const tables = this._syncTables();
    const status = {};
    for (const table of tables) {
      const columns = this._tableColumns(table);
      const where = columns.includes('deleted') ? 'WHERE deleted = 0' : '';
      const total = this.db.prepare(`SELECT COUNT(*) as cnt FROM ${table} ${where}`).get();
      const lastUpdate = columns.includes('updated_at')
        ? this.db.prepare(`SELECT MAX(updated_at) as ts FROM ${table}`).get()
        : { ts: null };
      status[table] = { count: total.cnt, last_updated: lastUpdate.ts };
    }
    status.server_time = this._now();
    return status;
  }

  // ==================== 璁よ瘉 ====================

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
    if (this.readDb && this.readDb !== this.db) {
      this.readDb.close();
      this.readDb = null;
    }
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

// 鍗曚緥
let instance = null;

function getInstance() {
  if (!instance) instance = new DatabaseService();
  return instance;
}

module.exports = { DatabaseService, getInstance };

