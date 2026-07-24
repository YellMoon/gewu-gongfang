'use strict';

const crypto = require('crypto');
const Database = require('better-sqlite3');

const dbPath = process.env.GEWU_PAIRING_INSPECT_DB || 'D:/GewuDataHost/data/scheduling.db';
const db = new Database(dbPath, { readonly: true, fileMustExist: true });

function opaque(value) {
  if (!value) return null;
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 10);
}

function tableExists(name) {
  return Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?"
  ).get(name));
}

function safeRecent(table, columns, orderColumn = 'created_at', limit = 8) {
  if (!tableExists(table)) return [];
  const available = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
  const selected = columns.filter(column => available.has(column));
  if (!selected.length || !available.has(orderColumn)) return [];
  return db.prepare(
    `SELECT ${selected.join(',')} FROM ${table} ORDER BY ${orderColumn} DESC LIMIT ?`
  ).all(limit).map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => (
    /(^id$|_id$|device_id|user_id|authorization_id|challenge_id|request_id|grant_id)/.test(key)
      ? [key, opaque(value)]
      : [key, value]
  ))));
}

try {
  const evidence = {
    quickCheck: db.pragma('quick_check', { simple: true }),
    pairingRequests: safeRecent('desktop_single_user_pairing_requests', [
      'id', 'grant_id', 'device_id', 'status', 'authorization_id', 'error_code',
      'created_at', 'updated_at', 'completed_at',
    ]),
    authorizations: safeRecent('desktop_device_authorizations', [
      'id', 'device_id', 'device_name', 'device_kind', 'user_id', 'status',
      'authorization_source', 'credential_version', 'row_version', 'created_at', 'updated_at',
    ]),
    sessionChallenges: safeRecent('desktop_session_challenges', [
      'id', 'authorization_id', 'device_id', 'status', 'error_code',
      'created_at', 'updated_at', 'expires_at', 'consumed_at',
    ]),
    sessions: safeRecent('desktop_sessions', [
      'id', 'authorization_id', 'device_id', 'user_id', 'status', 'active_role',
      'credential_version', 'created_at', 'updated_at', 'expires_at', 'revoked_at',
    ]),
  };
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  db.close();
}
