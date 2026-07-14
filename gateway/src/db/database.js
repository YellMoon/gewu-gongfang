/**
 * Gateway 数据库初始化
 * 创建用户/权限/邀请等核心表
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DB_DIR = path.join(__dirname, '../../data');
const DB_PATH = process.env.GATEWAY_DB_PATH || path.join(DB_DIR, 'gateway.db');

let db;

function getDb() {
  if (!db) {
    if (!fs.existsSync(DB_DIR)) {
      fs.mkdirSync(DB_DIR, { recursive: true });
    }
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

function initDatabase() {
  const database = getDb();
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
  database.exec(schema);
  ensureUserColumns(database);
  ensureMiniappTaskColumns(database);
  const deviceColumns = new Set(database.prepare('PRAGMA table_info(cloud_devices)').all().map(c=>c.name));
  if(!deviceColumns.has('owner_user_id')) database.prepare('ALTER TABLE cloud_devices ADD COLUMN owner_user_id TEXT').run();
  if(!deviceColumns.has('active')) database.prepare('ALTER TABLE cloud_devices ADD COLUMN active INTEGER NOT NULL DEFAULT 1').run();
  const heartbeatColumns = new Set(database.prepare('PRAGMA table_info(host_heartbeats)').all().map(c => c.name));
  if (!heartbeatColumns.has('lan_urls')) database.prepare('ALTER TABLE host_heartbeats ADD COLUMN lan_urls TEXT').run();
  database.prepare(`UPDATE desktop_device_pairings SET status='rejected' WHERE status='pending' AND id NOT IN
    (SELECT MIN(id) FROM desktop_device_pairings WHERE status='pending' GROUP BY pairing_code)`).run();
  database.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_gateway_pairing_pending_code ON desktop_device_pairings(pairing_code) WHERE status='pending'").run();
  console.log('[DB] Gateway 数据库表已创建/更新');
  return database;
}

function ensureMiniappTaskColumns(database) {
  const columns = new Set(database.prepare('PRAGMA table_info(miniapp_tasks)').all().map(row => row.name));
  const addColumn = (name, ddl) => {
    if (!columns.has(name)) {
      database.prepare(`ALTER TABLE miniapp_tasks ADD COLUMN ${name} ${ddl}`).run();
      columns.add(name);
    }
  };
  addColumn('protocol_version', 'INTEGER NOT NULL DEFAULT 1');
  addColumn('idempotency_key', 'TEXT');
  addColumn('request_hash', 'TEXT');
  addColumn('target_host_device_id', 'TEXT');
  addColumn('selection_context', 'TEXT');
  addColumn('phase', 'TEXT');
  addColumn('progress', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('claimed_by', 'TEXT');
  addColumn('claim_token_hash', 'TEXT');
  addColumn('lease_expires_at', 'TEXT');
  addColumn('row_version', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('error_code', 'TEXT');
  addColumn('cancel_requested_at', 'TEXT');
  addColumn('job_key', 'TEXT');
  addColumn('snapshot_hash', 'TEXT');
  addColumn('artifact_id', 'TEXT');
  addColumn('attempt', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('max_attempts', 'INTEGER NOT NULL DEFAULT 3');
  addColumn('next_attempt_at', 'TEXT');
  addColumn('deadline_at', 'TEXT');
  addColumn('result_expires_at', 'TEXT');
  addColumn('completion_operation_id', 'TEXT');
  addColumn('completion_result_hash', 'TEXT');
  database.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_miniapp_tasks_actor_idempotency
    ON miniapp_tasks(created_by,idempotency_key) WHERE idempotency_key IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_miniapp_tasks_target_claim
      ON miniapp_tasks(target_host_device_id,status,lease_expires_at,created_at);`);
  database.exec(`CREATE TABLE IF NOT EXISTS paper_jobs (
    job_key TEXT PRIMARY KEY, relay_scope TEXT NOT NULL, cloud_task_id TEXT NOT NULL, task_id TEXT NOT NULL, tenant_id TEXT NOT NULL, owner_user_id TEXT NOT NULL,
    request_hash TEXT NOT NULL, question_snapshot_json TEXT, snapshot_hash TEXT, selection_version TEXT,
    resource_version TEXT, status TEXT NOT NULL DEFAULT 'queued', phase TEXT NOT NULL DEFAULT 'queued',
    progress INTEGER NOT NULL DEFAULT 0, attempt INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 3,
    next_attempt_at TEXT, cancel_requested_at TEXT, deadline_at TEXT, temp_dir TEXT, artifact_id TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, claimed_at TEXT, completed_at TEXT
  );
  CREATE TABLE IF NOT EXISTS paper_artifacts (
    artifact_id TEXT PRIMARY KEY, task_id TEXT NOT NULL, job_key TEXT NOT NULL, owner_user_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL, snapshot_hash TEXT NOT NULL, format TEXT NOT NULL, mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL, sha256 TEXT NOT NULL, page_count INTEGER, formula_count INTEGER NOT NULL DEFAULT 0,
    fallback_count INTEGER NOT NULL DEFAULT 0, effective_modes_json TEXT NOT NULL, file_path TEXT NOT NULL,
    created_at TEXT NOT NULL, expires_at TEXT, storage_status TEXT NOT NULL DEFAULT 'verified'
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_paper_artifacts_job_snapshot_format_verified
    ON paper_artifacts(job_key,snapshot_hash,format) WHERE storage_status='verified';
  CREATE UNIQUE INDEX IF NOT EXISTS idx_paper_jobs_relay_task ON paper_jobs(relay_scope,cloud_task_id);`);
  database.exec(`CREATE TABLE IF NOT EXISTS paper_completion_outbox (
    outbox_id TEXT PRIMARY KEY, task_id TEXT NOT NULL, job_key TEXT NOT NULL, artifact_id TEXT NOT NULL,
    payload_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempt INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, delivered_at TEXT,
    claim_token TEXT, expected_row_version INTEGER, operation_id TEXT, result_hash TEXT,
    max_attempts INTEGER NOT NULL DEFAULT 10, last_error TEXT, terminal_at TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_paper_completion_once ON paper_completion_outbox(task_id,job_key,artifact_id);`);
  const outboxColumns = new Set(database.prepare('PRAGMA table_info(paper_completion_outbox)').all().map(row => row.name));
  for (const [name, ddl] of [['claim_token','TEXT'],['expected_row_version','INTEGER'],['operation_id','TEXT'],['result_hash','TEXT'],['max_attempts','INTEGER NOT NULL DEFAULT 10'],['last_error','TEXT'],['terminal_at','TEXT']]) {
    if (!outboxColumns.has(name)) database.prepare(`ALTER TABLE paper_completion_outbox ADD COLUMN ${name} ${ddl}`).run();
  }
}

function ensureUserColumns(database) {
  const columns = new Set(database.prepare('PRAGMA table_info(users)').all().map(c => c.name));
  const addColumn = (name, ddl) => {
    if (!columns.has(name)) {
      database.prepare(`ALTER TABLE users ADD COLUMN ${name} ${ddl}`).run();
      columns.add(name);
    }
  };
  addColumn('login_enabled', 'INTEGER DEFAULT 0');
  addColumn('student_id', 'TEXT');
  addColumn('linked_student_ids', 'TEXT');
  addColumn('teacher_id', 'TEXT');
  addColumn('review_status', "TEXT NOT NULL DEFAULT 'pending'");
  addColumn('reviewed_by', 'TEXT');
  addColumn('reviewed_at', 'TEXT');
  addColumn('is_super_admin_identity', 'INTEGER DEFAULT 0');
  addColumn('phone_normalized', 'TEXT');
  database.prepare('UPDATE users SET login_enabled = 0 WHERE login_enabled IS NULL').run();
  recoverCanonicalSuperAdmin(database);
  normalizeUniquePhones(database);
}

function normalizeUniquePhones(database) {
  const normalize = value => String(value || '').replace(/\D/g, '');
  const groups = new Map();
  for (const row of database.prepare('SELECT * FROM users').all()) {
    const phone = normalize(row.phone);
    if (phone) groups.set(phone, [...(groups.get(phone) || []), row]);
  }
  database.transaction(() => {
    database.prepare('UPDATE users SET phone_normalized = NULL').run();
    for (const [phone, rows] of groups) {
      if (rows.length > 1 && !database.prepare("SELECT 1 FROM authorization_audit_log WHERE action='phone_identity_conflict' AND before_json=?").get(JSON.stringify(rows.map(row => row.id)))) database.prepare(`INSERT INTO authorization_audit_log
        (id, action, before_json, after_json, created_at) VALUES (?, 'phone_identity_conflict', ?, ?, ?)`)
        .run(crypto.randomUUID(), JSON.stringify(rows.map(row => row.id)), JSON.stringify({ phoneHash: crypto.createHash('sha256').update(phone).digest('hex') }), new Date().toISOString());
      const canonical = phone === '13732250653' ? rows.find(row => row.is_super_admin_identity === 1) : null;
      if (rows.length === 1 || canonical) {
        const selected = canonical || rows[0];
        database.prepare('UPDATE users SET phone_normalized = ? WHERE id = ?').run(phone, selected.id);
        rows.filter(row => row.id !== selected.id).forEach(row => database.prepare("UPDATE users SET user_type='pending', review_status='pending', login_enabled=0 WHERE id=?").run(row.id));
      } else rows.forEach(row => database.prepare("UPDATE users SET user_type='pending', review_status='pending', login_enabled=0 WHERE id=?").run(row.id));
    }
  })();
  database.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_gateway_users_phone_normalized_unique ON users(phone_normalized) WHERE phone_normalized IS NOT NULL').run();
}

function recoverCanonicalSuperAdmin(database) {
  const normalize = value => String(value || '').replace(/\D/g, '');
  const rows = database.prepare('SELECT * FROM users').all();
  const fixed = rows.filter(row => normalize(row.phone) === '13732250653');
  const seeded = fixed.find(row => row.id === 'miniapp-admin-13732250653');
  const flagged = fixed.filter(row => row.is_super_admin_identity === 1);
  const selected = seeded || (flagged.length === 1 ? flagged[0] : (fixed.length === 1 && flagged.length === 0 ? fixed[0] : null));
  database.transaction(() => {
    database.prepare('UPDATE users SET is_super_admin_identity = 0 WHERE is_super_admin_identity != 0').run();
    for (const row of fixed) {
      if (!selected || row.id !== selected.id) {
        database.prepare("UPDATE users SET user_type = 'pending', review_status = 'pending', login_enabled = 0, updated_at = ? WHERE id = ?")
          .run(new Date().toISOString(), row.id);
      }
    }
    if (selected) {
      database.prepare("UPDATE users SET phone = '13732250653', user_type = 'super_admin', status = 1, login_enabled = 1, review_status = 'approved', is_super_admin_identity = 1, updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), selected.id);
    }
  })();
  database.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_gateway_single_super_identity ON users(is_super_admin_identity) WHERE is_super_admin_identity = 1');
}

function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { getDb, initDatabase, closeDatabase, DB_PATH };
