/**
 * SQLite 鏁版嵁搴撳眰 v3.1
 * 浣跨敤 better-sqlite3 鍚屾API锛屽尮閰?browserDatabase.ts 鐨勪笟鍔￠€昏緫
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { getMiniappLoginDenialReason } = require('./services/miniappAuthPolicy');
const { validateSyncMutation } = require('./services/syncScopeService');
const { findQuestionBankStore } = require('./services/questionBankStorageService');
const { scopeBusinessSnapshot } = require('./services/dataScopeService');
const {
  SUPER_ADMIN_PHONE,
  CANONICAL_SUPER_ADMIN_ID,
  normalizePhone,
  roleForUser,
  canReviewUsers,
  resolveTeacherBinding,
  scopeForUser,
} = require('./services/authorizationPolicy');

const SCHEMA_VERSION = 3101;
const MINIAPP_ADMIN_SEED_USERS = [
  { id: 'miniapp-admin-13732250653', phone: '13732250653', name: 'Miniapp Admin 0653' },
  { id: 'miniapp-admin-18257136756', phone: '18257136756', name: 'Miniapp Admin 6756' },
];
const ENVIRONMENTS = {
  dev: { dbFile: 'scheduling.dev.db' },
  staging: { dbFile: 'scheduling.staging.db' },
  prod: { dbFile: 'scheduling.db' },
};
const AUTHORIZATION_MIGRATION_NAME = 'legacy-users-v1';

function normalizeJson(value) {
  if (value === undefined || value === null || value === '') return 'null';
  if (typeof value === 'string') {
    try { return JSON.stringify(JSON.parse(value)); } catch (_error) { return JSON.stringify(value); }
  }
  return JSON.stringify(value);
}

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
    this._ensureQuestionMetaColumns();
    this._ensureImportTaskColumns();
    this._ensureArchiveJobColumns();
    this._ensureMiniappUserColumns();
    this._ensureAuthorizationPersistence();
    this._ensureHostHeartbeatColumns();
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
      'question_assets', 'model_points', 'import_batches', 'import_items', 'search_index_jobs', 'vector_embeddings',
      'data_archive_jobs', 'outbox_events'];
  }

  _questionBankTenantScopedTables() {
    return ['subjects', 'chapters', 'knowledge_points', 'questions', 'question_contents',
      'question_assets', 'model_points', 'import_batches', 'import_items', 'search_index_jobs', 'vector_embeddings',
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

  _ensureQuestionMetaColumns() {
    const exists = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'questions'"
    ).get();
    if (!exists) return;
    const columns = new Set(this.db.prepare('PRAGMA table_info(questions)').all().map(c => c.name));
    const addColumn = (name, ddl) => {
      if (!columns.has(name)) this.db.prepare(`ALTER TABLE questions ADD COLUMN ${name} ${ddl}`).run();
    };
    addColumn('subject', "TEXT DEFAULT '物理'");
    addColumn('year', 'TEXT');
    addColumn('grade', 'TEXT');
    addColumn('semester', 'TEXT');
    addColumn('exam_type', "TEXT DEFAULT '其他'");
    addColumn('region', 'TEXT');
    addColumn('school', 'TEXT');
    addColumn('edit_status', "TEXT DEFAULT '未编辑'");
    addColumn('status', "TEXT DEFAULT 'draft'");
    addColumn('has_image', 'INTEGER DEFAULT 0');
    addColumn('has_formula', 'INTEGER DEFAULT 0');
    addColumn('created_by', "TEXT DEFAULT ''");
    addColumn('storage_state', "TEXT NOT NULL DEFAULT 'local_draft'");
    addColumn('committed_at', 'TEXT');
    addColumn('committed_by_device_id', 'TEXT');
    addColumn('source_device_id', 'TEXT');
    addColumn('owner_user_id', 'TEXT');
    addColumn('deleted_at', 'TEXT');
    this.db.prepare("UPDATE questions SET subject = '物理' WHERE subject IS NULL OR subject = ''").run();
    this.db.prepare("UPDATE questions SET exam_type = '其他' WHERE exam_type IS NULL OR exam_type = ''").run();
    this.db.prepare("UPDATE questions SET edit_status = '未编辑' WHERE edit_status IS NULL OR edit_status = ''").run();
    this.db.prepare("UPDATE questions SET status = 'draft' WHERE status IS NULL OR status = '' OR status = 'active'").run();
    this.db.prepare("UPDATE questions SET has_image = 0 WHERE has_image IS NULL").run();
    this.db.prepare("UPDATE questions SET has_formula = 0 WHERE has_formula IS NULL").run();
    this.db.prepare("UPDATE questions SET created_by = '' WHERE created_by IS NULL").run();
    this.db.prepare("UPDATE questions SET storage_state = 'local_draft' WHERE storage_state IS NULL OR storage_state NOT IN ('local_draft', 'host_committed')").run();
    const questionBankRoot = process.env.QUESTION_BANK_ROOT;
    const verifiedStore = questionBankRoot ? findQuestionBankStore([questionBankRoot], { storeId: process.env.QUESTION_BANK_STORE_ID || undefined }) : null;
    if (verifiedStore?.available && verifiedStore.manifest?.storeId && Number(verifiedStore.manifest.schemaVersion) >= 1) {
      const committedAt = this._now();
      this.db.prepare(`UPDATE questions
        SET storage_state = 'host_committed', committed_at = COALESCE(committed_at, ?),
            committed_by_device_id = COALESCE(committed_by_device_id, ?)
        WHERE storage_state = 'local_draft' AND deleted = 0`).run(committedAt, process.env.GEWU_DEVICE_ID || null);
    }
  }

  _ensureImportTaskColumns() {
    const batchExists = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'import_batches'"
    ).get();
    if (batchExists) {
      const columns = this.db.prepare('PRAGMA table_info(import_batches)').all().map(c => c.name);
      const addColumn = (name, sql) => {
        if (!columns.includes(name)) this.db.prepare(`ALTER TABLE import_batches ADD COLUMN ${name} ${sql}`).run();
      };
      addColumn('warning_items', 'INTEGER DEFAULT 0');
      addColumn('failed_items', 'INTEGER DEFAULT 0');
      addColumn('result_summary', 'TEXT');
    }

    const itemExists = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'import_items'"
    ).get();
    if (itemExists) {
      const columns = this.db.prepare('PRAGMA table_info(import_items)').all().map(c => c.name);
      const addColumn = (name, sql) => {
        if (!columns.includes(name)) this.db.prepare(`ALTER TABLE import_items ADD COLUMN ${name} ${sql}`).run();
      };
      addColumn('question_id', 'TEXT');
      addColumn('warnings', 'TEXT');
      addColumn('errors', 'TEXT');
    }
  }

  _ensureMiniappUserColumns() {
    const exists = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'"
    ).get();
    if (!exists) return;

    const columns = new Set(this.db.prepare('PRAGMA table_info(users)').all().map(c => c.name));
    const addColumn = (name, ddl) => {
      if (!columns.has(name)) {
        this.db.prepare(`ALTER TABLE users ADD COLUMN ${name} ${ddl}`).run();
        columns.add(name);
      }
    };

    addColumn('phone', 'TEXT');
    addColumn('name', 'TEXT');
    addColumn('status', 'INTEGER DEFAULT 1');
    addColumn('login_enabled', 'INTEGER DEFAULT 0');
    addColumn('student_id', 'TEXT');
    addColumn('linked_student_ids', 'TEXT');
    addColumn('deleted', 'INTEGER DEFAULT 0');

    this.db.prepare("UPDATE users SET deleted = 0 WHERE deleted IS NULL").run();
    this.db.prepare("UPDATE users SET status = 1 WHERE status IS NULL").run();
    this.db.prepare("UPDATE users SET login_enabled = 0 WHERE login_enabled IS NULL").run();
    this.db.prepare("UPDATE users SET name = nickname WHERE (name IS NULL OR name = '') AND nickname IS NOT NULL").run();
    this._seedMiniappAdminUsers();
  }

  _seedMiniappAdminUsers() {
    const now = this._now();
    const insertSeed = this.db.prepare(
      `INSERT INTO users
       (id, phone, name, nickname, role, status, login_enabled, deleted, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'admin', 1, 1, 0, ?, ?)`
    );

    MINIAPP_ADMIN_SEED_USERS.forEach(seed => {
      const existing = this.db.prepare('SELECT id, phone FROM users').all()
        .find(user => normalizePhone(user.phone) === normalizePhone(seed.phone));
      if (existing) return;
      insertSeed.run(seed.id, seed.phone, seed.name, seed.name, now, now);
    });
  }

  _ensureAuthorizationPersistence() {
    const columns = new Set(this.db.prepare('PRAGMA table_info(users)').all().map(column => column.name));
    const addColumn = (name, ddl) => {
      if (!columns.has(name)) {
        this.db.prepare(`ALTER TABLE users ADD COLUMN ${name} ${ddl}`).run();
        columns.add(name);
      }
    };
    addColumn('teacher_id', 'TEXT');
    addColumn('review_status', "TEXT DEFAULT 'pending'");
    addColumn('reviewed_by', 'TEXT');
    addColumn('reviewed_at', 'TEXT');
    addColumn('is_super_admin_identity', 'INTEGER DEFAULT 0');
    const syncAuthColumns = new Set(this.db.prepare('PRAGMA table_info(sync_authorizations)').all().map(column => column.name));
    if (!syncAuthColumns.has('actor_user_id')) this.db.prepare('ALTER TABLE sync_authorizations ADD COLUMN actor_user_id TEXT').run();
    if (!syncAuthColumns.has('actor_teacher_id')) this.db.prepare('ALTER TABLE sync_authorizations ADD COLUMN actor_teacher_id TEXT').run();
    const syncDeviceColumns = new Set(this.db.prepare('PRAGMA table_info(sync_devices)').all().map(column => column.name));
    if (!syncDeviceColumns.has('owner_user_id')) this.db.prepare('ALTER TABLE sync_devices ADD COLUMN owner_user_id TEXT').run();
    if (!syncDeviceColumns.has('active')) this.db.prepare('ALTER TABLE sync_devices ADD COLUMN active INTEGER NOT NULL DEFAULT 1').run();
    this.db.prepare(`UPDATE desktop_device_pairings SET status='rejected' WHERE status='pending' AND id NOT IN
      (SELECT MIN(id) FROM desktop_device_pairings WHERE status='pending' GROUP BY pairing_code)`).run();
    this.db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_pairing_pending_code ON desktop_device_pairings(pairing_code) WHERE status='pending'").run();
    const deliveryColumns = new Set(this.db.prepare('PRAGMA table_info(sync_delivery_scope)').all().map(column => column.name));
    if (!deliveryColumns.has('tenant_id')) this.db.transaction(() => {
      this.db.exec(`CREATE TABLE sync_delivery_scope_v2 (
        tenant_id TEXT NOT NULL DEFAULT 'default', actor_user_id TEXT NOT NULL, device_id TEXT NOT NULL,
        table_name TEXT NOT NULL, record_id TEXT NOT NULL, last_visible_at TEXT NOT NULL,
        PRIMARY KEY(tenant_id,actor_user_id,device_id,table_name,record_id));
        INSERT INTO sync_delivery_scope_v2 (tenant_id,actor_user_id,device_id,table_name,record_id,last_visible_at)
          SELECT 'default',actor_user_id,device_id,table_name,record_id,last_visible_at FROM sync_delivery_scope;
        DROP TABLE sync_delivery_scope;
        ALTER TABLE sync_delivery_scope_v2 RENAME TO sync_delivery_scope;`);
    })();
    this.db.prepare('UPDATE users SET is_super_admin_identity = 0 WHERE is_super_admin_identity IS NULL').run();
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS authorization_audit_log (
        id TEXT PRIMARY KEY, actor_user_id TEXT, actor_phone TEXT, target_user_id TEXT,
        action TEXT NOT NULL, before_json TEXT, after_json TEXT, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sync_rejections (
        id TEXT PRIMARY KEY, operation_id TEXT, actor_user_id TEXT, actor_teacher_id TEXT,
        source_device_id TEXT, table_name TEXT, record_id TEXT, reason_code TEXT NOT NULL,
        payload_json TEXT, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sync_record_provenance (
        table_name TEXT NOT NULL, record_id TEXT NOT NULL,
        created_by_user_id TEXT, updated_by_user_id TEXT, actor_teacher_id TEXT,
        source_device_id TEXT, source_operation_id TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        PRIMARY KEY (table_name, record_id)
      );
      CREATE TABLE IF NOT EXISTS sync_delivery_scope (
        tenant_id TEXT NOT NULL DEFAULT 'default', actor_user_id TEXT NOT NULL, device_id TEXT NOT NULL,
        table_name TEXT NOT NULL, record_id TEXT NOT NULL, last_visible_at TEXT NOT NULL,
        PRIMARY KEY(tenant_id,actor_user_id,device_id,table_name,record_id)
      );
      CREATE TABLE IF NOT EXISTS relay_authorization_nonces (
        nonce TEXT PRIMARY KEY, task_id TEXT NOT NULL, actor_user_id TEXT NOT NULL, device_id TEXT NOT NULL, consumed_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS authorization_migrations (
        name TEXT PRIMARY KEY, applied_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_authorization_users_review ON users(review_status, role);
      CREATE INDEX IF NOT EXISTS idx_authorization_audit_target ON authorization_audit_log(target_user_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_sync_rejections_operation ON sync_rejections(operation_id, created_at);
    `);
    const migrated = this.db.prepare('SELECT 1 FROM authorization_migrations WHERE name = ?')
      .get(AUTHORIZATION_MIGRATION_NAME);
    if (!migrated) this._migrateAuthorizationUsers();
    this._enforceCanonicalSuperAdmin();
    this.db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_single_super_admin_identity
      ON users(is_super_admin_identity) WHERE is_super_admin_identity = 1`).run();
  }

  _migrateAuthorizationUsers() {
    const users = this.db.prepare(
      'SELECT id, phone, role, student_id, teacher_id, review_status FROM users WHERE deleted = 0'
    ).all();
    const teachers = this.db.prepare(
      'SELECT id, phone, deleted FROM teachers WHERE deleted = 0'
    ).all();
    const migrate = this.db.transaction(() => {
      for (const user of users) {
        const normalizedPhone = normalizePhone(user.phone);
        let role = user.role;
        let reviewStatus = user.review_status;
        let teacherId = null;
        if (normalizedPhone === SUPER_ADMIN_PHONE) {
          role = user.id === CANONICAL_SUPER_ADMIN_ID ? 'super_admin' : 'pending';
          reviewStatus = user.id === CANONICAL_SUPER_ADMIN_ID ? 'approved' : 'pending';
        } else if (role === 'admin' || role === 'student') {
          reviewStatus = 'approved';
        } else if (role === 'teacher') {
          const binding = resolveTeacherBinding(user, teachers);
          if (binding.ok) {
            teacherId = binding.teacherId;
            reviewStatus = 'approved';
          } else {
            role = 'pending';
            reviewStatus = 'pending';
          }
        } else if (role !== 'pending') {
          role = 'pending';
          reviewStatus = 'pending';
        } else {
          reviewStatus = 'pending';
        }
        this.db.prepare(
          'UPDATE users SET phone = ?, role = ?, review_status = ?, teacher_id = ?, updated_at = ? WHERE id = ?'
        ).run(normalizedPhone || null, role, reviewStatus, teacherId, this._now(), user.id);
      }
      this.db.prepare('INSERT INTO authorization_migrations (name, applied_at) VALUES (?, ?)')
        .run(AUTHORIZATION_MIGRATION_NAME, this._now());
    });
    migrate();
  }

  _canonicalSuperAdmin() {
    const fixedUsers = this.db.prepare('SELECT * FROM users ORDER BY created_at, id').all()
      .filter(user => normalizePhone(user.phone) === SUPER_ADMIN_PHONE);
    const seeded = fixedUsers.find(user => user.id === CANONICAL_SUPER_ADMIN_ID);
    if (seeded) return { ok: true, user: seeded, duplicates: fixedUsers.filter(user => user.id !== seeded.id) };
    const flagged = fixedUsers.filter(user => user.is_super_admin_identity === 1);
    if (flagged.length === 1) {
      return { ok: true, user: flagged[0], duplicates: fixedUsers.filter(user => user.id !== flagged[0].id) };
    }
    if (fixedUsers.length === 1) return { ok: true, user: fixedUsers[0], duplicates: [] };
    return { ok: false, code: 'SUPER_ADMIN_IDENTITY_CONFLICT', duplicates: fixedUsers };
  }

  _enforceCanonicalSuperAdmin() {
    const identity = this._canonicalSuperAdmin();
    const now = this._now();
    this.db.transaction(() => {
      this.db.prepare('UPDATE users SET is_super_admin_identity = 0 WHERE is_super_admin_identity != 0').run();
      const demote = this.db.prepare(
        "UPDATE users SET phone = ?, is_super_admin_identity = 0, role = 'pending', review_status = 'pending', login_enabled = 0, teacher_id = NULL, updated_at = ? WHERE id = ?"
      );
      for (const duplicate of identity.duplicates || []) {
        demote.run(normalizePhone(duplicate.phone), now, duplicate.id);
      }
      if (!identity.ok) return;
      this.db.prepare(`UPDATE users SET phone = ?, is_super_admin_identity = 1, role = 'super_admin', review_status = 'approved',
        status = 1, login_enabled = 1, deleted = 0, teacher_id = NULL, updated_at = ? WHERE id = ?`)
        .run(SUPER_ADMIN_PHONE, now, identity.user.id);
    })();
  }

  _ensureHostHeartbeatColumns() {
    const exists = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'host_heartbeats'"
    ).get();
    if (!exists) return;
    const columns = new Set(this.db.prepare('PRAGMA table_info(host_heartbeats)').all().map(c => c.name));
    if (!columns.has('lan_urls')) {
      this.db.prepare('ALTER TABLE host_heartbeats ADD COLUMN lan_urls TEXT').run();
    }
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
      const scalar = (value) => {
        if (value === undefined) return null;
        if (value === true) return 1;
        if (value === false) return 0;
        if (value && typeof value === 'object') return JSON.stringify(value);
        return value;
      };
      for (const table of tables) {
        if (data[table] && Array.isArray(data[table])) {
          counts[table] = 0;
          const columns = this._tableColumns(table);
          for (const row of data[table]) {
            const normalized = { ...row, tenant_id: this._tenantId(options) };
            if (columns.includes('deleted') && normalized.deleted === undefined) normalized.deleted = 0;
            if (columns.includes('created_at') && !normalized.created_at) normalized.created_at = this._now();
            if (columns.includes('updated_at') && !normalized.updated_at) normalized.updated_at = normalized.created_at || this._now();
            const keys = Object.keys(normalized).filter(key => columns.includes(key));
            const vals = keys.map(key => scalar(normalized[key]));
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

  registerSyncDevice(deviceId, payload = {}) {
    const now = this._now();
    const id = deviceId || 'unknown';
    const current = this.db.prepare('SELECT * FROM sync_devices WHERE id = ?').get(id);
    if (current?.owner_user_id && payload.ownerUserId && current.owner_user_id !== payload.ownerUserId) {
      const error = new Error('SYNC_DEVICE_OWNER_MISMATCH'); error.code = 'SYNC_DEVICE_OWNER_MISMATCH'; throw error;
    }
    this.db.prepare(
      `INSERT INTO sync_devices (id, device_name, role, trusted, owner_user_id, active, last_seen_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         device_name = excluded.device_name,
         role = excluded.role,
         owner_user_id = COALESCE(sync_devices.owner_user_id, excluded.owner_user_id),
         last_seen_at = excluded.last_seen_at,
         updated_at = excluded.updated_at`
    ).run(
      id,
      payload.deviceName || payload.device_name || id,
      payload.role || 'desktop-client',
      payload.trusted ? 1 : 0,
      payload.ownerUserId || null,
      now,
      now,
      now
    );
    return this.db.prepare('SELECT * FROM sync_devices WHERE id = ?').get(id);
  }

  issueSyncAuthorization(deviceId, options = {}) {
    const crypto = require('crypto');
    const now = this._now();
    const token = crypto.randomBytes(24).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + (options.ttlMs || 10 * 60 * 1000)).toISOString();
    const id = uuidv4();
    this.registerSyncDevice(deviceId, { role: options.role || 'desktop-client', deviceName: options.deviceName,
      ownerUserId: options.actorUserId });
    this.db.prepare(
      `INSERT INTO sync_authorizations (id, device_id, actor_user_id, actor_teacher_id, token_hash, scope, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, deviceId, options.actorUserId || null, options.actorTeacherId || null,
      tokenHash, options.scope || 'sync:push', expiresAt, now);
    return { id, token, expiresAt, scope: options.scope || 'sync:push', actorUserId: options.actorUserId || null,
      actorTeacherId: options.actorTeacherId || null };
  }

  verifySyncAuthorization(deviceId, token, options = {}) {
    const crypto = require('crypto');
    const tokenHash = crypto.createHash('sha256').update(String(token || '')).digest('hex');
    return this.db.transaction(() => {
      const row = this.db.prepare(
        `SELECT * FROM sync_authorizations
         WHERE device_id = ? AND token_hash = ? AND scope = ? AND used_at IS NULL
         ORDER BY created_at DESC LIMIT 1`
      ).get(deviceId, tokenHash, options.scope || 'sync:push');
      if (!row || Date.parse(row.expires_at) < Date.now()) return false;
      if (!row.actor_user_id || row.actor_user_id !== options.actorUserId) return false;
      if ((row.actor_teacher_id || null) !== (options.actorTeacherId || null)) return false;
      const consumed = this.db.prepare('UPDATE sync_authorizations SET used_at = ? WHERE id = ? AND used_at IS NULL').run(this._now(), row.id);
      if (consumed.changes !== 1) return false;
      const { token_hash, ...safe } = row;
      return safe;
    })();
  }

  consumeSyncAuthorizationContext(deviceId, token, actorUserId, scope = 'sync:push') {
    const context = this.resolveSyncActorContext(deviceId, actorUserId);
    if (!context) return false;
    const authorization = this.verifySyncAuthorization(deviceId, token, {
      actorUserId: context.userId, actorTeacherId: context.teacherId, scope,
    });
    return authorization ? context : false;
  }

  resolveSyncActorContext(deviceId, actorUserId) {
    const user = this.db.prepare('SELECT * FROM users WHERE id = ? AND deleted = 0').get(actorUserId);
    if (!user || user.review_status !== 'approved' || user.status === 'inactive' || user.status === 0 || user.login_enabled === 0) return false;
    const role = roleForUser(user);
    const teacherId = role === 'teacher' ? user.teacher_id : null;
    const device = this.db.prepare('SELECT * FROM sync_devices WHERE id = ? AND active = 1').get(deviceId);
    if (!device || device.owner_user_id !== user.id) return false;
    return { kind: ['super_admin', 'admin'].includes(role) ? 'admin' : role,
      userId: user.id, teacherId, studentId: user.student_id || null, deviceId };
  }

  resolveOrProvisionRelayActorContext(deviceId, actorUserId, pairingApprovalId) {
    let device = this.db.prepare('SELECT * FROM sync_devices WHERE id = ?').get(deviceId);
    if (device && device.owner_user_id && device.owner_user_id !== actorUserId) return false;
    if (!device) {
      const user = this.db.prepare('SELECT * FROM users WHERE id=? AND deleted=0').get(actorUserId);
      if (!user || user.review_status !== 'approved' || user.login_enabled === 0 || !pairingApprovalId) return false;
      this.registerSyncDevice(deviceId, { ownerUserId:actorUserId, deviceName:deviceId, role:'desktop-client', trusted:true });
      this.recordAuthorizationAudit({ actorUserId, targetUserId:actorUserId, action:'relay-device:provision',
        after:{ deviceId, pairingApprovalId } });
    }
    return this.resolveSyncActorContext(deviceId, actorUserId);
  }

  consumeRelayAuthorizationNonce(claims) {
    try {
      return this.db.transaction(() => {
        const inserted = this.db.prepare(`INSERT OR IGNORE INTO relay_authorization_nonces
          (nonce,task_id,actor_user_id,device_id,consumed_at) VALUES (?,?,?,?,?)`)
          .run(claims.nonce, claims.taskId, claims.actorUserId, claims.deviceId, this._now());
        return inserted.changes === 1;
      })();
    } catch (_error) { return false; }
  }

  recordSyncConflict(change, existing, options = {}) {
    const id = uuidv4();
    this.db.prepare(
      `INSERT INTO sync_conflicts
       (id, operation_id, device_id, table_name, record_id, base_version, server_version,
        client_payload, server_payload, risk_level, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
    ).run(
      id,
      change.id,
      options.deviceId || change.deviceId || 'unknown',
      change.table,
      change.data?.id,
      change.data?._base_version || change.baseVersion || null,
      existing?.updated_at || null,
      JSON.stringify(change.data || {}),
      JSON.stringify(existing || {}),
      change.data?._risk_level || change.riskLevel || 'medium',
      this._now()
    );
    return id;
  }

  listSyncConflicts(status = 'pending') {
    return this.db.prepare(
      `SELECT * FROM sync_conflicts WHERE status = ? ORDER BY created_at DESC LIMIT 200`
    ).all(status).map(row => ({
      ...row,
      client_payload: JSON.parse(row.client_payload || '{}'),
      server_payload: JSON.parse(row.server_payload || '{}'),
    }));
  }

  resolveSyncConflict(id, resolution) {
    const now = this._now();
    this.db.prepare(
      `UPDATE sync_conflicts
       SET status = 'resolved', resolution = ?, resolved_at = ?
       WHERE id = ?`
    ).run(JSON.stringify(resolution), now, id);
    return this.db.prepare('SELECT * FROM sync_conflicts WHERE id = ?').get(id);
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

  getScopedChangeQueueSince(sinceTime, options = {}) {
    const authz = options.authz;
    if (!authz?.kind || !authz?.userId || !authz?.deviceId) {
      const error = new Error('AUTHORIZATION_CONTEXT_REQUIRED'); error.code = 'AUTHORIZATION_CONTEXT_REQUIRED'; throw error;
    }
    const payload = this.getChangeQueueSince(sinceTime, options);
    if (authz.kind === 'admin') return payload;
    if (!['teacher', 'student'].includes(authz.kind)) return { ...payload, changes: [] };
    const snapshot = {};
    for (const table of this._syncTables()) snapshot[table] = this.getChangesSince(table, 0, options)
      .filter(row => row.deleted !== 1 && row.deleted !== true);
    const scoped = scopeBusinessSnapshot(snapshot, { ...authz,
      studentIds: authz.studentIds || (authz.studentId ? [authz.studentId] : []) });
    const visible = new Map();
    for (const [table, rows] of Object.entries(scoped)) {
      if (!Array.isArray(rows)) continue;
      for (const row of rows) if (row?.id != null) visible.set(`${table}:${row.id}`, row);
    }
    const changes = payload.changes.flatMap(change => {
      const row = visible.get(`${change.table}:${change.data?.id}`);
      return row ? [{ ...change, data: row }] : [];
    });
    const now = this._now();
    const tenantId = options.tenantId || 'default';
    const ledger = this.db.prepare(`SELECT table_name, record_id FROM sync_delivery_scope
      WHERE tenant_id = ? AND actor_user_id = ? AND device_id = ?`).all(tenantId, authz.userId, authz.deviceId);
    for (const prior of ledger) {
      if (visible.has(`${prior.table_name}:${prior.record_id}`)) continue;
      changes.push({ id: `scope-delete:${prior.table_name}:${prior.record_id}:${now}`, table: prior.table_name,
        action: 'delete', data: { id: prior.record_id, deleted: 1 }, version: now, updatedAt: now,
        tenantId: options.tenantId || 'default', deviceId: 'server' });
      this.db.prepare(`DELETE FROM sync_delivery_scope WHERE tenant_id=? AND actor_user_id=? AND device_id=? AND table_name=? AND record_id=?`)
        .run(tenantId, authz.userId, authz.deviceId, prior.table_name, prior.record_id);
    }
    const remember = this.db.prepare(`INSERT INTO sync_delivery_scope
      (tenant_id, actor_user_id, device_id, table_name, record_id, last_visible_at) VALUES (?,?,?,?,?,?)
      ON CONFLICT(tenant_id,actor_user_id,device_id,table_name,record_id) DO UPDATE SET last_visible_at=excluded.last_visible_at`);
    for (const change of changes) if (change.action !== 'delete') {
      remember.run(tenantId, authz.userId, authz.deviceId, change.table, change.data.id, now);
    }
    changes.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.id.localeCompare(b.id));
    return { ...payload, changes };
  }

  applySyncChanges(changes, options = {}) {
    if (!options.authz) {
      const error = new Error('AUTHORIZATION_CONTEXT_REQUIRED'); error.code = 'AUTHORIZATION_CONTEXT_REQUIRED'; throw error;
    }
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
          if (!existing && options.authz?.kind === 'teacher' && table === 'courses') {
            record.teacher_id = options.authz.teacherId;
            change.data.teacher_id = options.authz.teacherId;
          }
          let provenance = null;
          if (options.authz) {
            const read = name => this._tableColumns(name).length ? this.db.prepare(`SELECT * FROM ${name} WHERE tenant_id = ?`).all(change.tenantId) : [];
            const validation = validateSyncMutation(change, { ...options.authz, deviceId: options.authz.deviceId || deviceId }, {
              courses: read('courses'), schedules: read('schedules'), existing,
            });
            provenance = validation.provenance;
            if (validation.decision === 'review') {
              this.recordSyncRejection({ operationId: change.id, actorUserId: provenance.actorUserId,
                actorTeacherId: provenance.actorTeacherId, sourceDeviceId: provenance.sourceDeviceId,
                tableName: table, recordId, reasonCode: validation.code, payload: record });
              results.errors.push({ table, id: recordId, error: validation.code, review: true });
              continue;
            }
            if (validation.decision === 'conflict') {
              results.conflicts++;
              this.recordSyncConflict(change, existing, { deviceId });
              continue;
            }
          }
          const baseVersion = record._base_version || change.baseVersion || null;
          const riskLevel = record._risk_level || change.riskLevel || 'medium';
          const existingVersion = existing?.updated_at || null;
          if (existing && baseVersion && existingVersion && baseVersion !== existingVersion && riskLevel === 'high') {
            results.conflicts++;
            this.recordSyncConflict(change, existing, { deviceId, tenantId: change.tenantId });
            this._auditSync({
              tenant_id: change.tenantId,
              client_id: change.deviceId,
              protocol_version: 'v2-change-queue',
              action: change.action,
              table_name: table,
              record_id: recordId,
              local_updated_at: change.updatedAt,
              server_updated_at: existingVersion,
              resolution: 'manual-required',
              status: 'conflict',
              detail: { changeId: change.id, baseVersion, riskLevel },
            });
            this.db.prepare(
              `INSERT INTO sync_log (client_id, action, table_name, record_id, sync_time, status) VALUES (?, 'push', ?, ?, ?, 'conflict')`
            ).run(change.deviceId, table, recordId, now);
            continue;
          }
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
          if (provenance) {
            this.db.prepare(`INSERT INTO sync_record_provenance
              (table_name, record_id, created_by_user_id, updated_by_user_id, actor_teacher_id,
               source_device_id, source_operation_id, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(table_name, record_id) DO UPDATE SET
                updated_by_user_id=excluded.updated_by_user_id, actor_teacher_id=excluded.actor_teacher_id,
                source_device_id=excluded.source_device_id, source_operation_id=excluded.source_operation_id,
                updated_at=excluded.updated_at`).run(table, recordId, provenance.actorUserId,
              provenance.actorUserId, provenance.actorTeacherId, provenance.sourceDeviceId,
              provenance.sourceOperationId, now, now);
          }
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
          if (options.authz && ['TEACHER_SCOPE_VIOLATION', 'SYNC_WRITE_FORBIDDEN', 'AUTHORIZATION_CONTEXT_REQUIRED'].includes(e.code)) {
            this.recordSyncRejection({ operationId: change.id, actorUserId: options.authz.userId,
              actorTeacherId: options.authz.teacherId, sourceDeviceId: options.authz.deviceId || deviceId,
              tableName: table, recordId, reasonCode: e.code, payload: record });
          }
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

  applyPushChanges(clientId, changes, authz) {
    return this.applySyncChanges(changes, { deviceId: clientId || 'unknown', authz });
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

  getMiniappUserByWechat(openid) {
    return this.db.prepare('SELECT * FROM users WHERE wechat_openid = ? AND deleted = 0').get(openid);
  }

  getMiniappUserByPhone(phone) {
    return this.db.prepare('SELECT * FROM users WHERE phone = ? AND deleted = 0 ORDER BY created_at ASC LIMIT 1').get(phone);
  }

  bindMiniappUserWechatByVerifiedPhone(phone, openid, unionid, profile = {}) {
    const user = this.getMiniappUserByPhone(phone);
    if (!user) return null;
    if (user.wechat_openid && user.wechat_openid !== openid) {
      const error = new Error('This phone number is already bound to another WeChat account');
      error.code = 'MINIAPP_PHONE_ALREADY_BOUND';
      throw error;
    }

    const openidOwner = this.getMiniappUserByWechat(openid);
    if (openidOwner && openidOwner.id !== user.id) {
      const error = new Error('This WeChat account is already bound to another miniapp user');
      error.code = 'MINIAPP_WECHAT_ALREADY_BOUND';
      throw error;
    }

    const now = this._now();
    this.db.prepare(
      `UPDATE users
       SET wechat_openid = ?,
           wechat_unionid = COALESCE(wechat_unionid, ?),
           nickname = CASE WHEN nickname IS NULL OR nickname = '' THEN ? ELSE nickname END,
           avatar_url = CASE WHEN avatar_url IS NULL OR avatar_url = '' THEN ? ELSE avatar_url END,
           updated_at = ?
       WHERE id = ?`
    ).run(
      openid,
      unionid || null,
      profile.nickname || null,
      profile.avatarUrl || null,
      now,
      user.id
    );
    return this.db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  }

  findAuthorizedMiniappUserByWechat(openid) {
    const user = this.getMiniappUserByWechat(openid);
    return getMiniappLoginDenialReason(user) ? null : user;
  }

  recordMiniappLoginAttempt(input = {}) {
    const now = this._now();
    const id = uuidv4();
    this.db.prepare(
      `INSERT INTO miniapp_login_attempts
       (id, wechat_openid, wechat_unionid, nickname, avatar_url, denial_reason, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      input.openid || '',
      input.unionid || null,
      input.nickname || null,
      input.avatarUrl || input.avatar_url || null,
      input.denialReason || input.denial_reason || '',
      now,
      now
    );
    return { id, created_at: now };
  }

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

  reviewUser({ actorPhone, userId, role } = {}) {
    const identity = this._canonicalSuperAdmin();
    if (!identity.ok) {
      const error = new Error('Super administrator identity is conflicting');
      error.code = identity.code;
      throw error;
    }
    const actor = identity.user;
    const active = actor.deleted === 0 && actor.status === 1 && actor.login_enabled === 1
      && actor.review_status === 'approved' && actor.role === 'super_admin';
    if (normalizePhone(actorPhone) !== SUPER_ADMIN_PHONE || !active || !canReviewUsers(actor)) {
      const error = new Error('Super administrator approval is required');
      error.code = 'SUPER_ADMIN_REQUIRED';
      throw error;
    }
    if (!['admin', 'student', 'teacher'].includes(role)) {
      const error = new Error('Invalid authorization role');
      error.code = 'INVALID_AUTHORIZATION_ROLE';
      throw error;
    }
    const target = this.db.prepare('SELECT * FROM users WHERE id = ? AND deleted = 0').get(userId);
    if (!target) {
      const error = new Error('Authorization user was not found');
      error.code = 'AUTHORIZATION_USER_NOT_FOUND';
      throw error;
    }
    if (normalizePhone(target.phone) === SUPER_ADMIN_PHONE) {
      const error = new Error('The fixed super administrator cannot be downgraded');
      error.code = 'SUPER_ADMIN_IMMUTABLE';
      throw error;
    }
    let teacherId = null;
    if (role === 'teacher') {
      const binding = resolveTeacherBinding(
        target,
        this.db.prepare('SELECT id, phone, deleted FROM teachers WHERE deleted = 0').all()
      );
      if (!binding.ok) {
        const error = new Error(binding.code);
        error.code = binding.code;
        throw error;
      }
      teacherId = binding.teacherId;
    }
    const now = this._now();
    return this.db.transaction(() => {
      this.db.prepare(`UPDATE users SET role = ?, review_status = 'approved', teacher_id = ?,
        reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE id = ?`)
        .run(role, teacherId, actor.id, now, now, target.id);
      const updated = this.db.prepare('SELECT * FROM users WHERE id = ?').get(target.id);
      this.recordAuthorizationAudit({ actorUserId: actor.id, actorPhone: normalizePhone(actor.phone),
        targetUserId: target.id, action: 'review_user', before: target, after: updated, createdAt: now });
      return updated;
    })();
  }

  listAuthorizationUsers({ status, role, search, page = 1, pageSize = 20 } = {}) {
    const validStatuses = new Set(['pending', 'approved', 'rejected']);
    const validRoles = new Set(['super_admin', 'admin', 'teacher', 'student', 'pending']);
    if (status && !validStatuses.has(status)) { const error = new Error('Invalid review status'); error.code = 'INVALID_REVIEW_STATUS'; throw error; }
    if (role && !validRoles.has(role)) { const error = new Error('Invalid role'); error.code = 'INVALID_AUTHORIZATION_ROLE'; throw error; }
    search = String(search || '').trim();
    if (search.length > 100) { const error = new Error('Search is too long'); error.code = 'SEARCH_TOO_LONG'; throw error; }
    page = Math.max(1, Number.parseInt(page, 10) || 1);
    pageSize = Math.min(100, Math.max(1, Number.parseInt(pageSize, 10) || 20));
    const where = ['deleted = 0'];
    const params = [];
    if (status) { where.push('review_status = ?'); params.push(status); }
    if (role) { where.push('role = ?'); params.push(role); }
    if (search) {
      where.push("(COALESCE(name, '') LIKE ? OR COALESCE(nickname, '') LIKE ? OR COALESCE(phone, '') LIKE ?)");
      params.push(...Array(3).fill(`%${search}%`));
    }
    const reader = this._reader();
    const total = reader.prepare(`SELECT COUNT(*) AS count FROM users WHERE ${where.join(' AND ')}`).get(...params).count;
    const items = reader.prepare(`SELECT id, phone, name, nickname, role, status, login_enabled, review_status,
      teacher_id, student_id, reviewed_by, reviewed_at, created_at, updated_at
      FROM users WHERE ${where.join(' AND ')} ORDER BY created_at, id LIMIT ? OFFSET ?`)
      .all(...params, pageSize, (page - 1) * pageSize);
    return { items, total, page, pageSize };
  }

  getAuthorizationContextByUserId(userId, device = {}) {
    const user = this._reader().prepare('SELECT * FROM users WHERE id = ? AND deleted = 0').get(userId);
    if (!user) return null;
    const role = roleForUser(user);
    return { userId: user.id, role, reviewStatus: user.review_status,
      teacherId: user.teacher_id || null, studentId: user.student_id || null,
      scope: scopeForUser({ ...user, role }),
      device: { id: device.id || null, name: device.name || null, trusted: false } };
  }

  recordAuthorizationAudit(entry = {}) {
    const row = { id: entry.id || uuidv4(), actor_user_id: entry.actorUserId || entry.actor_user_id || null,
      actor_phone: entry.actorPhone || entry.actor_phone || null,
      target_user_id: entry.targetUserId || entry.target_user_id || null,
      action: entry.action || 'authorization_change',
      before_json: normalizeJson(entry.before === undefined ? entry.before_json : entry.before),
      after_json: normalizeJson(entry.after === undefined ? entry.after_json : entry.after),
      created_at: entry.createdAt || entry.created_at || this._now() };
    this.db.prepare(`INSERT INTO authorization_audit_log
      (id, actor_user_id, actor_phone, target_user_id, action, before_json, after_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(...Object.values(row));
    return row;
  }

  recordSyncRejection(entry = {}) {
    const row = { id: entry.id || uuidv4(), operation_id: entry.operationId || entry.operation_id || null,
      actor_user_id: entry.actorUserId || entry.actor_user_id || null,
      actor_teacher_id: entry.actorTeacherId || entry.actor_teacher_id || null,
      source_device_id: entry.sourceDeviceId || entry.source_device_id || null,
      table_name: entry.tableName || entry.table_name || null, record_id: entry.recordId || entry.record_id || null,
      reason_code: entry.reasonCode || entry.reason_code || 'SYNC_REJECTED',
      payload_json: normalizeJson(entry.payload === undefined ? entry.payload_json : entry.payload),
      created_at: entry.createdAt || entry.created_at || this._now() };
    this.db.prepare(`INSERT INTO sync_rejections
      (id, operation_id, actor_user_id, actor_teacher_id, source_device_id, table_name, record_id, reason_code, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(...Object.values(row));
    return row;
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
