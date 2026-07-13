const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Sqlite = require('better-sqlite3');

const REQUIRED_COLUMNS = [
  'protocol_version', 'idempotency_key', 'request_hash', 'target_host_device_id', 'selection_context',
  'phase', 'progress', 'claimed_by', 'claim_token_hash', 'lease_expires_at', 'row_version',
  'error_code', 'cancel_requested_at',
  'job_key', 'snapshot_hash', 'artifact_id', 'attempt', 'max_attempts',
  'next_attempt_at', 'deadline_at', 'result_expires_at',
  'completion_operation_id', 'completion_result_hash',
];

const PAPER_JOB_COLUMNS = [
  'job_key', 'relay_scope', 'cloud_task_id', 'task_id', 'tenant_id', 'owner_user_id', 'request_hash', 'question_snapshot_json',
  'snapshot_hash', 'selection_version', 'resource_version', 'status', 'phase', 'progress',
  'attempt', 'max_attempts', 'next_attempt_at', 'cancel_requested_at', 'deadline_at', 'temp_dir',
  'artifact_id', 'created_at', 'updated_at', 'claimed_at', 'completed_at',
];

const PAPER_ARTIFACT_COLUMNS = [
  'artifact_id', 'task_id', 'job_key', 'owner_user_id', 'tenant_id', 'snapshot_hash', 'format',
  'mime_type', 'size_bytes', 'sha256', 'page_count', 'formula_count', 'fallback_count',
  'effective_modes_json', 'file_path', 'created_at', 'expires_at', 'storage_status',
];
const PAPER_OUTBOX_COLUMNS = ['outbox_id', 'task_id', 'job_key', 'artifact_id', 'payload_json', 'status', 'attempt', 'next_attempt_at', 'created_at', 'updated_at', 'delivered_at', 'claim_token', 'expected_row_version', 'operation_id', 'result_hash', 'max_attempts', 'last_error', 'terminal_at'];

function createLegacyDb(filePath) {
  const db = new Sqlite(filePath);
  db.exec(`CREATE TABLE miniapp_tasks (
    id TEXT PRIMARY KEY, task_type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending_host',
    payload TEXT NOT NULL, result_payload TEXT, created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  INSERT INTO miniapp_tasks(id,task_type,status,payload,created_by,created_at,updated_at)
    VALUES('legacy-row','paper-export-word','pending_host','{}','u1','t','t');`);
  db.close();
}

function assertMigrated(db, label) {
  const columns = new Set(db.prepare('PRAGMA table_info(miniapp_tasks)').all().map(row => row.name));
  for (const column of REQUIRED_COLUMNS) assert.ok(columns.has(column), `${label}: missing ${column}`);
  const legacy = db.prepare("SELECT protocol_version,row_version,progress FROM miniapp_tasks WHERE id='legacy-row'").get();
  assert.deepStrictEqual(legacy, { protocol_version: 1, row_version: 0, progress: 0 }, `${label}: legacy rows need safe V1 defaults`);
  const indexes = new Set(db.prepare("PRAGMA index_list('miniapp_tasks')").all().map(row => row.name));
  assert.ok(indexes.has('idx_miniapp_tasks_actor_idempotency'), `${label}: durable idempotency index missing`);
  assert.ok(indexes.has('idx_miniapp_tasks_target_claim'), `${label}: target/claim index missing`);
  const jobColumns = new Set(db.prepare('PRAGMA table_info(paper_jobs)').all().map(row => row.name));
  const artifactColumns = new Set(db.prepare('PRAGMA table_info(paper_artifacts)').all().map(row => row.name));
  for (const column of PAPER_JOB_COLUMNS) assert.ok(jobColumns.has(column), `${label}: paper_jobs missing ${column}`);
  for (const column of PAPER_ARTIFACT_COLUMNS) assert.ok(artifactColumns.has(column), `${label}: paper_artifacts missing ${column}`);
  const outboxColumns = new Set(db.prepare('PRAGMA table_info(paper_completion_outbox)').all().map(row => row.name));
  for (const column of PAPER_OUTBOX_COLUMNS) assert.ok(outboxColumns.has(column), `${label}: paper_completion_outbox missing ${column}`);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-task-schema-'));
let gatewayDatabase;
let backendDatabase;
try {
  const gatewayPath = path.join(root, 'gateway.db');
  createLegacyDb(gatewayPath);
  process.env.GATEWAY_DB_PATH = gatewayPath;
  delete require.cache[require.resolve('../../../gateway/src/db/database')];
  gatewayDatabase = require('../../../gateway/src/db/database');
  const gatewayDb = gatewayDatabase.initDatabase();
  try { assertMigrated(gatewayDb, 'gateway'); } finally { gatewayDatabase.closeDatabase(); }

  const backendPath = path.join(root, 'backend.db');
  createLegacyDb(backendPath);
  process.env.DB_PATH = backendPath;
  const { DatabaseService } = require('../database');
  backendDatabase = new DatabaseService();
  try { assertMigrated(backendDatabase.db, 'backend'); } finally { backendDatabase.close(); }
} finally {
  try { gatewayDatabase?.closeDatabase(); } catch (_error) { /* best effort test cleanup */ }
  try { backendDatabase?.close(); } catch (_error) { /* best effort test cleanup */ }
  delete process.env.GATEWAY_DB_PATH;
  delete process.env.DB_PATH;
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
}

console.log('cloud relay V2 task schema migration checks passed');
