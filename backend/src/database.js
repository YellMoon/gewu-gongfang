/**
 * SQLite 鏁版嵁搴撳眰 v3.1
 * 浣跨敤 better-sqlite3 鍚屾API锛屽尮閰?browserDatabase.ts 鐨勪笟鍔￠€昏緫
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const SCHEMA_VERSION = 3101;
const ENVIRONMENTS = {
  dev: { dbFile: 'scheduling.dev.db' },
  staging: { dbFile: 'scheduling.staging.db' },
  prod: { dbFile: 'scheduling.db' },
};

function resolveEnvironment() {
  const raw = process.env.APP_ENV || process.env.SCHEDULE_ENV || process.env.NODE_ENV || 'dev';
  if (raw === 'production') return 'prod';
  if (raw === 'development') return 'dev';
  return ENVIRONMENTS[raw] ? raw : 'dev';
}

function resolveDefaultDbPath(environment) {
  const envConfig = ENVIRONMENTS[environment] || ENVIRONMENTS.dev;
  return path.join(__dirname, '..', 'data', envConfig.dbFile);
}

class DatabaseService {
  constructor() {
    this.db = null;
    this.readDb = null;
    this.readDbMode = 'writer';
    this.readDbError = null;
    this.environment = resolveEnvironment();
    this.schemaVersion = Number(process.env.SCHEMA_VERSION || SCHEMA_VERSION);
    this.dbPath = process.env.DB_PATH || resolveDefaultDbPath(this.environment);
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
      try {
        this.readDb = new Database(this.readDbPath, { readonly: true, fileMustExist: true });
        this.readDb.pragma('foreign_keys = ON');
        this.readDbMode = 'readonly';
      } catch (error) {
        this.readDb = this.db;
        this.readDbMode = 'fallback';
        this.readDbError = error.message;
        console.warn(`[DB] READ_DB_PATH unavailable, fallback to writer: ${error.message}`);
      }
    } else {
      this.readDb = this.db;
      this.readDbMode = 'writer';
    }

    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    this.db.exec(schema);
    this._recordSchemaVersion(schemaPath);
    this._ensureTenantColumns();
    this._ensureArchiveJobColumns();
    console.log(`[DB] initialized env=${this.environment} schema=${this.schemaVersion} path=${this.dbPath}`);
  }

  // ==================== 閫氱敤CRUD杈呭姪 ====================

  _now() { return new Date().toISOString(); }

  _reader() { return this.readDb || this.db; }

  _recordSchemaVersion(schemaPath) {
    const now = this._now();
    const checksum = fs.readFileSync(schemaPath, 'utf-8').length.toString();
    this.db.pragma(`user_version = ${this.schemaVersion}`);
    this.db.prepare(
      `INSERT INTO schema_migrations
       (version, name, checksum, applied_at, app_env, rollback_notes)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(version) DO UPDATE SET
         checksum = excluded.checksum,
         app_env = excluded.app_env,
         rollback_notes = excluded.rollback_notes`
    ).run(
      this.schemaVersion,
      'baseline-single-schema',
      checksum,
      now,
      this.environment,
      'Rollback is snapshot based for the single-file schema: stop service, restore the pre-migration DB backup, then restart with the same APP_ENV/DB_PATH.'
    );
  }

  getSchemaStatus() {
    return {
      environment: this.environment,
      dbPath: this.dbPath,
      readDbPath: this.readDbPath,
      readDbMode: this.readDbMode,
      readDbError: this.readDbError,
      schemaVersion: this.schemaVersion,
      sqliteUserVersion: this.db.pragma('user_version', { simple: true }),
      migrations: this.db.prepare(
        'SELECT version, name, checksum, applied_at, app_env, rollback_notes FROM schema_migrations ORDER BY version DESC'
      ).all(),
    };
  }

  _tenantScopedTables() {
    return ['students', 'grades', 'courses', 'schedules', 'enrollments',
      'payments', 'consumptions', 'institutions', 'schools', 'rooms', 'teachers',
      'subjects', 'chapters', 'knowledge_points', 'questions', 'question_contents',
      'question_assets', 'import_batches', 'import_items', 'search_index_jobs', 'vector_embeddings',
      'data_archive_jobs', 'outbox_events'];
  }

  _questionBankTenantScopedTables() {
    return ['subjects', 'chapters', 'knowledge_points', 'questions', 'question_contents',
      'question_assets', 'import_batches', 'import_items', 'search_index_jobs', 'vector_embeddings',
      'data_archive_jobs', 'outbox_events'];
  }

  _ensureTenantColumnForTable(table) {
    const exists = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?"
    ).get(table);
    if (!exists) return;
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
    if (!columns.includes('tenant_id')) {
      this.db.prepare(`ALTER TABLE ${table} ADD COLUMN tenant_id TEXT DEFAULT 'default'`).run();
    }
    this.db.prepare(`UPDATE ${table} SET tenant_id = 'default' WHERE tenant_id IS NULL OR tenant_id = ''`).run();
  }

  _ensureTenantColumns() {
    const now = this._now();
    this.db.prepare(
      `INSERT OR IGNORE INTO tenants (id, name, status, plan, deleted, created_at, updated_at)
       VALUES ('default', 'default', 'active', 'standard', 0, ?, ?)`
    ).run(now, now);

    for (const table of this._tenantScopedTables()) {
      this._ensureTenantColumnForTable(table);
      const columns = this.db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
      if (columns.includes('deleted')) {
        this.db.prepare(`CREATE INDEX IF NOT EXISTS idx_${table}_tenant_deleted ON ${table}(tenant_id, deleted)`).run();
      } else {
        this.db.prepare(`CREATE INDEX IF NOT EXISTS idx_${table}_tenant ON ${table}(tenant_id)`).run();
      }
    }
    for (const table of this._questionBankTenantScopedTables()) {
      const exists = this.db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?"
      ).get(table);
      if (!exists) continue;
      this._ensureTenantColumnForTable(table);
      const columns = this.db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
      if (columns.includes('deleted')) {
        this.db.prepare(`CREATE INDEX IF NOT EXISTS idx_${table}_tenant_deleted ON ${table}(tenant_id, deleted)`).run();
      } else {
        this.db.prepare(`CREATE INDEX IF NOT EXISTS idx_${table}_tenant ON ${table}(tenant_id)`).run();
      }
    }
  }

  _ensureArchiveJobColumns() {
    const exists = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'data_archive_jobs'"
    ).get();
    if (!exists) return;

    const columns = new Set(this.db.prepare('PRAGMA table_info(data_archive_jobs)').all().map(c => c.name));
    const addColumn = (name, ddl) => {
      if (!columns.has(name)) {
        this.db.prepare(`ALTER TABLE data_archive_jobs ADD COLUMN ${name} ${ddl}`).run();
      }
    };

    addColumn('job_type', "TEXT DEFAULT 'archive'");
    addColumn('artifact_path', 'TEXT');
    addColumn('artifact_format', 'TEXT');
    addColumn('oss_key', 'TEXT');
    addColumn('oss_url', 'TEXT');
    addColumn('schedule_cron', 'TEXT');
    addColumn('retention_days', 'INTEGER DEFAULT 30');
    addColumn('error_message', 'TEXT');
    addColumn('restored_at', 'TEXT');
  }

  _tenantId(options = {}) {
    return options.tenantId || options.tenant_id || process.env.DEFAULT_TENANT_ID || 'default';
  }

  _tenantWhere(table, options = {}, alias = null) {
    const columns = this._tableColumns(table);
    if (!columns.includes('tenant_id')) return { sql: '', params: [] };
    const prefix = alias ? `${alias}.` : '';
    return { sql: `${prefix}tenant_id = ?`, params: [this._tenantId(options)] };
  }

  _getFrom(db, table, id, options = {}) {
    const tenant = this._tenantWhere(table, options);
    const where = ['id = ?', 'deleted = 0'];
    const params = [id];
    if (tenant.sql) {
      where.push(tenant.sql);
      params.push(...tenant.params);
    }
    return db.prepare(`SELECT * FROM ${table} WHERE ${where.join(' AND ')}`).get(...params);
  }

  _get(table, id, options = {}) {
    return this._getFrom(this._reader(), table, id, options);
  }

  _getWriter(table, id, options = {}) {
    return this._getFrom(this.db, table, id, options);
  }

  _getWriterByField(table, field, value, options = {}) {
    const tenant = this._tenantWhere(table, options);
    const where = [`${field} = ?`, 'deleted = 0'];
    const params = [value];
    if (tenant.sql) {
      where.push(tenant.sql);
      params.push(...tenant.params);
    }
    return this.db.prepare(`SELECT * FROM ${table} WHERE ${where.join(' AND ')}`).get(...params);
  }

  _list(table, orderBy = 'created_at DESC', options = {}) {
    const tenant = this._tenantWhere(table, options);
    const where = ['deleted = 0'];
    const params = [];
    if (tenant.sql) {
      where.push(tenant.sql);
      params.push(...tenant.params);
    }
    return this._reader().prepare(`SELECT * FROM ${table} WHERE ${where.join(' AND ')} ORDER BY ${orderBy}`).all(...params);
  }

  _insert(table, data, options = {}) {
    const now = this._now();
    const record = { ...data, created_at: now, updated_at: now };
    const columns = this._tableColumns(table);
    if (columns.includes('tenant_id') && !record.tenant_id) record.tenant_id = this._tenantId(options);
    const keys = Object.keys(record);
    const vals = Object.values(record);
    const placeholders = keys.map(() => '?').join(', ');
    this.db.prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`).run(...vals);
    return record;
  }

  _update(table, id, updates, options = {}) {
    const now = this._now();
    updates.updated_at = now;
    const keys = Object.keys(updates);
    const vals = Object.values(updates);
    const setClause = keys.map(k => `${k} = ?`).join(', ');
    const tenant = this._tenantWhere(table, options);
    const where = ['id = ?', 'deleted = 0'];
    const params = [...vals, id];
    if (tenant.sql) {
      where.push(tenant.sql);
      params.push(...tenant.params);
    }
    this.db.prepare(`UPDATE ${table} SET ${setClause} WHERE ${where.join(' AND ')}`).run(...params);
    return this._getWriter(table, id, options);
  }

  _softDelete(table, id, options = {}) {
    const now = this._now();
    const tenant = this._tenantWhere(table, options);
    const where = ['id = ?'];
    const params = [now, id];
    if (tenant.sql) {
      where.push(tenant.sql);
      params.push(...tenant.params);
    }
    const result = this.db.prepare(`UPDATE ${table} SET deleted = 1, updated_at = ? WHERE ${where.join(' AND ')}`).run(...params);
    this._auditOperation({
      tenant_id: this._tenantId(options),
      action: 'delete',
      table_name: table,
      record_id: id,
      status: result.changes > 0 ? 'success' : 'not_found',
      detail: { affectedRows: result.changes },
    }, options);
    return result.changes > 0;
  }

  _count(table, where = '1=1', params = [], options = {}) {
    const tenant = this._tenantWhere(table, options);
    const clauses = [where];
    const allParams = [...params];
    if (tenant.sql) {
      clauses.push(tenant.sql);
      allParams.push(...tenant.params);
    }
    const row = this._reader().prepare(`SELECT COUNT(*) as cnt FROM ${table} WHERE ${clauses.join(' AND ')}`).get(...allParams);
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

  _auditOperation(event) {
    const now = this._now();
    this.db.prepare(
      `INSERT INTO operation_audit_log
       (id, tenant_id, actor, action, table_name, record_id, status, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      uuidv4(),
      event.tenant_id || 'default',
      event.actor || 'system',
      event.action,
      event.table_name || null,
      event.record_id || null,
      event.status || 'success',
      event.detail ? JSON.stringify(event.detail) : null,
      now
    );
  }

  getAuditLogs(filters = {}) {
    const limit = Math.min(Math.max(Number(filters.limit) || 100, 1), 500);
    const offset = Math.max(Number(filters.offset) || 0, 0);
    const where = [];
    const params = [];

    if (filters.tenantId) {
      where.push('tenant_id = ?');
      params.push(filters.tenantId);
    }
    if (filters.action) {
      where.push('action = ?');
      params.push(filters.action);
    }
    if (filters.status) {
      where.push('status = ?');
      params.push(filters.status);
    }
    if (filters.tableName) {
      where.push('table_name = ?');
      params.push(filters.tableName);
    }
    if (filters.recordId) {
      where.push('record_id = ?');
      params.push(filters.recordId);
    }
    if (filters.startTime) {
      where.push('created_at >= ?');
      params.push(this._normalizeSyncTime(filters.startTime));
    }
    if (filters.endTime) {
      where.push('created_at <= ?');
      params.push(this._normalizeSyncTime(filters.endTime));
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    return this._reader().prepare(
      `SELECT * FROM (
         SELECT id, tenant_id, actor, 'operation' AS audit_type, action, table_name, record_id,
                NULL AS client_id, NULL AS protocol_version, NULL AS resolution,
                NULL AS local_updated_at, NULL AS server_updated_at, status, detail, created_at
         FROM operation_audit_log
         UNION ALL
         SELECT id, tenant_id, client_id AS actor, 'sync' AS audit_type, action, table_name, record_id,
                client_id, protocol_version, resolution, local_updated_at, server_updated_at,
                status, detail, created_at
         FROM sync_audit_log
       ) ${whereSql}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);
  }

  // ==================== 瀛︾敓绠＄悊 ====================

  getAllStudents(options = {}) {
    return this._list('students', 'created_at DESC', options);
  }

  getStudentById(id, options = {}) {
    return this._get('students', id, options);
  }

  createStudent(data, options = {}) {
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
    }, options);
  }

  updateStudent(id, updates, options = {}) {
    const allowed = ['name', 'phone', 'school', 'grade_year', 'grade_current', 'source_type',
      'institution_id', 'parent_name', 'parent_wechat', 'student_source',
      'balance_hours', 'balance_money', 'notes'];
    const filtered = {};
    for (const k of allowed) if (updates[k] !== undefined) filtered[k] = updates[k];
    if (Object.keys(filtered).length === 0) return this._get('students', id, options);
    return this._update('students', id, filtered, options);
  }

  deleteStudent(id, options = {}) {
    return this._softDelete('students', id, options);
  }

  // 鑾峰彇鎴愮哗
  getGrades(studentId, options = {}) {
    return this._reader().prepare(
      'SELECT * FROM grades WHERE student_id = ? AND deleted = 0 AND tenant_id = ? ORDER BY exam_date DESC'
    ).all(studentId, this._tenantId(options));
  }

  createGrade(data, options = {}) {
    const id = uuidv4();
    return this._insert('grades', {
      id, student_id: data.student_id, subject: data.subject,
      score: data.score, exam_date: data.exam_date || null, notes: data.notes || null
    }, options);
  }

  // ==================== 璇剧▼绠＄悊 ====================

  getAllCourses(options = {}) {
    return this._list('courses', 'created_at DESC', options);
  }

  getCourseById(id, options = {}) {
    return this._get('courses', id, options);
  }

  createCourse(data, options = {}) {
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
    }, options);
  }

  updateCourse(id, updates, options = {}) {
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
    if (Object.keys(filtered).length === 0) return this._get('courses', id, options);
    return this._update('courses', id, filtered, options);
  }

  deleteCourse(id, options = {}) { return this._softDelete('courses', id, options); }

  // ==================== 鎺掕绠＄悊 ====================

  getAllSchedules(options = {}) {
    return this._list('schedules', 'start_time DESC', options);
  }

  getSchedulesByDateRange(start, end, options = {}) {
    return this._reader().prepare(
      `SELECT * FROM schedules WHERE deleted = 0 AND tenant_id = ? AND start_time >= ? AND end_time <= ? ORDER BY start_time`
    ).all(this._tenantId(options), start, end);
  }

  getScheduleById(id, options = {}) {
    return this._get('schedules', id, options);
  }

  createSchedule(data, options = {}) {
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
    }, options);
  }

  updateSchedule(id, updates, options = {}) {
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
    if (Object.keys(filtered).length === 0) return this._get('schedules', id, options);
    return this._update('schedules', id, filtered, options);
  }

  deleteSchedule(id, options = {}) { return this._softDelete('schedules', id, options); }

  checkTimeConflict(startTime, endTime, excludeScheduleId, options = {}) {
    let sql = `SELECT * FROM schedules WHERE deleted = 0 AND tenant_id = ? AND status NOT IN (3) AND NOT (end_time <= ? OR start_time >= ?)`;
    const params = [this._tenantId(options), startTime, endTime];
    if (excludeScheduleId) { sql += ' AND id != ?'; params.push(excludeScheduleId); }
    return this._reader().prepare(sql).all(...params);
  }

  // ==================== 閫夎鍏宠仈 ====================

  getEnrollmentsBySchedule(scheduleId, options = {}) {
    return this._reader().prepare('SELECT * FROM enrollments WHERE schedule_id = ? AND deleted = 0 AND tenant_id = ?').all(scheduleId, this._tenantId(options));
  }

  getEnrollmentsByStudent(studentId, options = {}) {
    return this._reader().prepare('SELECT * FROM enrollments WHERE student_id = ? AND deleted = 0 AND tenant_id = ?').all(studentId, this._tenantId(options));
  }

  createEnrollment(data, options = {}) {
    const id = uuidv4();
    return this._insert('enrollments', {
      id, schedule_id: data.schedule_id, student_id: data.student_id,
      custom_price: data.custom_price || null,
      hours_consumed: data.hours_consumed || 0,
      status: data.status || 1, notes: data.notes || null
    }, options);
  }

  updateEnrollment(id, updates, options = {}) {
    const allowed = ['custom_price', 'hours_consumed', 'status', 'notes'];
    const filtered = {};
    for (const k of allowed) if (updates[k] !== undefined) filtered[k] = updates[k];
    if (Object.keys(filtered).length === 0) return this._get('enrollments', id, options);
    return this._update('enrollments', id, filtered, options);
  }

  deleteEnrollment(id, options = {}) { return this._softDelete('enrollments', id, options); }

  // ==================== 缂磋垂绠＄悊 ====================

  getAllPayments(options = {}) { return this._list('payments', 'payment_date DESC', options); }

  getPaymentsByStudent(studentId, options = {}) {
    return this._reader().prepare(
      'SELECT * FROM payments WHERE student_id = ? AND deleted = 0 AND tenant_id = ? ORDER BY payment_date DESC'
    ).all(studentId, this._tenantId(options));
  }

  createPayment(data, options = {}) {
    const id = uuidv4();
    const payment = this._insert('payments', {
      id, student_id: data.student_id, amount: data.amount,
      payment_type: data.payment_type, payment_date: data.payment_date,
      payment_method: data.payment_method || null, notes: data.notes || null
    });
    // 鏇存柊瀛︾敓浣欓
    const student = this._get('students', data.student_id, options);
    if (student) {
      if (data.payment_type === 1) {  // 瀛﹁垂
        this._update('students', data.student_id, { balance_money: student.balance_money + data.amount }, options);
      } else if (data.payment_type === 2) {  // 璇炬椂
        this._update('students', data.student_id, { balance_hours: student.balance_hours + data.amount }, options);
      }
    }
    return payment;
  }

  // ==================== 璇炬椂娑堣€?====================

  getAllConsumptions(options = {}) { return this._list('consumptions', 'consumption_date DESC', options); }

  getConsumptionsByStudent(studentId, options = {}) {
    return this._reader().prepare(
      'SELECT * FROM consumptions WHERE student_id = ? AND deleted = 0 AND tenant_id = ? ORDER BY consumption_date DESC'
    ).all(studentId, this._tenantId(options));
  }

  createConsumption(data, options = {}) {
    const id = uuidv4();
    const consumption = this._insert('consumptions', {
      id, schedule_id: data.schedule_id, student_id: data.student_id,
      hours: data.hours, amount: data.amount, consumption_date: data.consumption_date,
      notes: data.notes || null
    }, options);
    // 鏇存柊瀛︾敓浣欓
    const student = this._get('students', data.student_id, options);
    if (student) {
      this._update('students', data.student_id, {
        balance_hours: student.balance_hours - data.hours,
        balance_money: student.balance_money - data.amount
      }, options);
    }
    return consumption;
  }

  // ==================== 鑰佸笀绠＄悊 ====================

  getAllTeachers(options = {}) { return this._list('teachers', 'created_at DESC', options); }
  getTeacherById(id, options = {}) { return this._get('teachers', id, options); }

  createTeacher(data, options = {}) {
    const id = uuidv4();
    return this._insert('teachers', {
      id, name: data.name, phone: data.phone || null,
      subject: data.subject || null, hourly_rate: data.hourly_rate || null,
      notes: data.notes || null
    }, options);
  }

  updateTeacher(id, updates, options = {}) {
    const allowed = ['name', 'phone', 'subject', 'hourly_rate', 'notes'];
    const filtered = {};
    for (const k of allowed) if (updates[k] !== undefined) filtered[k] = updates[k];
    if (Object.keys(filtered).length === 0) return this._get('teachers', id, options);
    return this._update('teachers', id, filtered, options);
  }

  deleteTeacher(id, options = {}) { return this._softDelete('teachers', id, options); }

  // ==================== 鏁欏绠＄悊 ====================

  getAllRooms(options = {}) { return this._list('rooms', 'created_at DESC', options); }
  getRoomById(id, options = {}) { return this._get('rooms', id, options); }

  createRoom(data, options = {}) {
    const id = uuidv4();
    return this._insert('rooms', {
      id, name: data.name, address: data.address || '', count: 1
    }, options);
  }

  updateRoom(id, updates, options = {}) {
    const allowed = ['name', 'address'];
    const filtered = {};
    for (const k of allowed) if (updates[k] !== undefined) filtered[k] = updates[k];
    if (Object.keys(filtered).length === 0) return this._get('rooms', id, options);
    return this._update('rooms', id, filtered, options);
  }

  deleteRoom(id, options = {}) { return this._softDelete('rooms', id, options); }

  // ==================== 瀛︽牎绠＄悊 ====================

  getAllSchools(options = {}) { return this._list('schools', 'name ASC', options); }

  addOrUpdateSchool(name, options = {}) {
    const existing = this._getWriterByField('schools', 'name', name, options);
    if (existing) {
      return this._update('schools', existing.id, { count: existing.count + 1 }, options);
    }
    const id = uuidv4();
    return this._insert('schools', { id, name, count: 1 }, options);
  }

  // ==================== 鏈烘瀯绠＄悊 ====================

  getAllInstitutions(options = {}) { return this._list('institutions', 'created_at DESC', options); }
  getInstitutionById(id, options = {}) { return this._get('institutions', id, options); }

  createInstitution(data, options = {}) {
    const id = uuidv4();
    return this._insert('institutions', {
      id, name: data.name, contact_person: data.contact_person || null,
      contact_phone: data.contact_phone || null, revenue_share: data.revenue_share || null,
      notes: data.notes || null
    }, options);
  }

  updateInstitution(id, updates, options = {}) {
    const allowed = ['name', 'contact_person', 'contact_phone', 'revenue_share', 'notes'];
    const filtered = {};
    for (const k of allowed) if (updates[k] !== undefined) filtered[k] = updates[k];
    if (Object.keys(filtered).length === 0) return this._get('institutions', id, options);
    return this._update('institutions', id, filtered, options);
  }

  deleteInstitution(id, options = {}) { return this._softDelete('institutions', id, options); }

  // ==================== 缁熻鏁版嵁 ====================

  getRevenueStats(startDate, endDate, options = {}) {
    const reader = this._reader();
    const tenantId = this._tenantId(options);
    const schedules = reader.prepare(
      `SELECT * FROM schedules WHERE deleted = 0 AND tenant_id = ? AND status = 2 AND start_time >= ? AND start_time <= ?`
    ).all(tenantId, startDate, endDate);

    let total = 0;
    const byCourseType = {};
    const bySourceType = {};
    const byInstitution = {};
    const byMonth = {};

    schedules.forEach(s => {
      const tuition = s.calculated_tuition || 0;
      total += tuition;
      const course = reader.prepare('SELECT * FROM courses WHERE id = ? AND tenant_id = ?').get(s.course_id, tenantId);
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
        const inst = reader.prepare('SELECT name FROM institutions WHERE id = ? AND tenant_id = ?').get(instId, tenantId);
        return { institutionId: instId, institutionName: inst?.name || '未知机构', amount, percentage: pct(amount) };
      }),
      byMonth: Object.entries(byMonth).map(([month, amount]) => ({ month, amount }))
    };
  }

  getConsumptionStats(startDate, endDate, options = {}) {
    const row = this._reader().prepare(
      `SELECT SUM(hours) as total_hours, SUM(amount) as total_amount, COUNT(*) as count
       FROM consumptions WHERE deleted = 0 AND tenant_id = ? AND consumption_date >= ? AND consumption_date <= ?`
    ).get(this._tenantId(options), startDate, endDate);
    return { total_hours: row.total_hours || 0, total_amount: row.total_amount || 0, count: row.count || 0 };
  }

  // ==================== 鏁版嵁瀵煎嚭/瀵煎叆 ====================

  exportAll(options = {}) {
    return {
      tenant_id: this._tenantId(options),
      students: this._list('students', 'created_at DESC', options),
      grades: this._list('grades', 'created_at DESC', options),
      courses: this._list('courses', 'created_at DESC', options),
      schedules: this._list('schedules', 'created_at DESC', options),
      enrollments: this._list('enrollments', 'created_at DESC', options),
      payments: this._list('payments', 'created_at DESC', options),
      consumptions: this._list('consumptions', 'created_at DESC', options),
      institutions: this._list('institutions', 'created_at DESC', options),
      schools: this._list('schools', 'created_at DESC', options),
      rooms: this._list('rooms', 'created_at DESC', options),
      teachers: this._list('teachers', 'created_at DESC', options),
      exported_at: this._now()
    };
  }

  importAll(data, options = {}) {
    const transaction = this.db.transaction((data) => {
      const tables = ['students', 'grades', 'courses', 'schedules', 'enrollments',
        'payments', 'consumptions', 'institutions', 'schools', 'rooms', 'teachers'];
      const counts = {};
      for (const table of tables) {
        if (data[table] && Array.isArray(data[table])) {
          counts[table] = 0;
          for (const row of data[table]) {
            const normalized = { ...row, tenant_id: this._tenantId(options) };
            const keys = Object.keys(normalized);
            const vals = Object.values(normalized);
            const placeholders = keys.map(() => '?').join(', ');
            this.db.prepare(
              `INSERT OR REPLACE INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`
            ).run(...vals);
            counts[table]++;
          }
        }
      }
      const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
      this._auditOperation({
        tenant_id: this._tenantId(options),
        action: 'import',
        table_name: null,
        record_id: null,
        status: 'success',
        detail: { source: 'backup', total, tables: counts },
      });
      return { total, tables: counts };
    }, options);
    const summary = transaction(data);
    return { imported: true, ...summary };
  }

  // ==================== 同步支持 ====================

  _normalizeSyncTime(value) {
    if (!value) return '1970-01-01T00:00:00.000Z';
    if (typeof value === 'number') return new Date(value).toISOString();
    if (typeof value === 'string' && /^\d+$/.test(value.trim())) return new Date(Number(value)).toISOString();
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? '1970-01-01T00:00:00.000Z' : new Date(parsed).toISOString();
  }

  _syncTimeMs(value) {
    return Date.parse(this._normalizeSyncTime(value));
  }

  _changeId(table, recordId, updatedAt, action, deviceId = 'server') {
    return `${table}:${recordId}:${updatedAt}:${action}:${deviceId}`;
  }

  _toSyncChange(table, record, deviceId = 'server', tenantId = 'default') {
    const updatedAt = this._normalizeSyncTime(record.updated_at || record.created_at || this._now());
    const deleted = Number(record.deleted || 0) === 1;
    const createdAt = record.created_at ? this._normalizeSyncTime(record.created_at) : null;
    const action = deleted ? 'delete' : (createdAt && createdAt === updatedAt ? 'create' : 'update');
    const data = { ...record, updated_at: updatedAt };
    if (createdAt) data.created_at = createdAt;
    return {
      id: record._sync_operation_id || this._changeId(table, record.id, updatedAt, action, deviceId),
      table,
      action,
      data,
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

  getChangesSince(table, sinceTime, options = {}) {
    const columns = this._tableColumns(table);
    if (!columns.includes('updated_at')) return [];
    const sinceIso = this._normalizeSyncTime(sinceTime);
    // Use an inclusive boundary to avoid losing same-millisecond changes when
    // a client resumes from the serverTime returned by the previous pull.
    const where = ['updated_at >= ?'];
    const params = [sinceIso];
    if (columns.includes('tenant_id')) {
      where.push('tenant_id = ?');
      params.push(this._tenantId(options));
    }
    return this._reader().prepare(
      `SELECT * FROM ${table} WHERE ${where.join(' AND ')} ORDER BY updated_at ASC`
    ).all(...params);
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
    const clientId = options.clientId || deviceId;
    const queue = [];
    for (const table of this._syncTables()) {
      for (const record of this.getChangesSince(table, sinceTime, { tenantId })) {
        queue.push(this._toSyncChange(table, record, deviceId, tenantId));
      }
    }
    queue.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.id.localeCompare(b.id));
    const serverTime = this._now();
    this.db.prepare(
      `INSERT INTO sync_log (client_id, action, table_name, record_id, sync_time, status) VALUES (?, 'pull', NULL, NULL, ?, 'success')`
    ).run(clientId, serverTime);
    return { changes: queue, serverTime, since: this._normalizeSyncTime(sinceTime) };
  }

  applySyncChanges(changes, options = {}) {
    const deviceId = options.deviceId || 'unknown';
    const scopeTenantId = this._tenantId(options);
    const queue = this._legacyChangesToQueue(changes, deviceId).map(change => ({
      ...change,
      tenantId: scopeTenantId,
      data: { ...change.data, tenant_id: scopeTenantId },
    }));
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
          const existing = columns.includes('tenant_id')
            ? this.db.prepare(`SELECT * FROM ${table} WHERE id = ? AND tenant_id = ?`).get(recordId, change.tenantId)
            : this.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(recordId);
          if (existing && this._syncTimeMs(existing.updated_at) > this._syncTimeMs(change.updatedAt)) {
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

          const incoming = { ...record, updated_at: now };
          if (columns.includes('created_at') && !incoming.created_at) incoming.created_at = existing?.created_at || now;
          if (columns.includes('deleted')) incoming.deleted = change.action === 'delete' ? 1 : (incoming.deleted || 0);
          if (columns.includes('tenant_id') && !incoming.tenant_id) incoming.tenant_id = change.tenantId;

          const keys = Object.keys(incoming).filter(k => columns.includes(k) && k !== 'id');
          if (existing) {
            const setClause = keys.map(k => `${k} = ?`).join(', ');
            const updateWhere = columns.includes('tenant_id') ? 'id = ? AND tenant_id = ?' : 'id = ?';
            const updateParams = columns.includes('tenant_id') ? [recordId, change.tenantId] : [recordId];
            this.db.prepare(`UPDATE ${table} SET ${setClause} WHERE ${updateWhere}`).run(...keys.map(k => incoming[k]), ...updateParams);
          } else {
            const insertRecord = { ...incoming, id: recordId };
            const insertKeys = Object.keys(insertRecord).filter(k => columns.includes(k));
            const placeholders = insertKeys.map(() => '?').join(', ');
            this.db.prepare(
              `INSERT INTO ${table} (${insertKeys.join(', ')}) VALUES (${placeholders})`
            ).run(...insertKeys.map(k => insertRecord[k]));
          }
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
      const total = this._reader().prepare(`SELECT COUNT(*) as cnt FROM ${table} ${where}`).get();
      const lastUpdate = columns.includes('updated_at')
        ? this._reader().prepare(`SELECT MAX(updated_at) as ts FROM ${table}`).get()
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

