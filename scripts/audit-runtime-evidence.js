'use strict';

const Sqlite = require('better-sqlite3');

const databasePath = String(process.env.GEWU_AUDIT_DB_PATH || '').trim();
if (!databasePath) throw new Error('GEWU_AUDIT_DB_PATH_REQUIRED');

const db = new Sqlite(databasePath, { readonly: true, fileMustExist: true });
const tableExists = name => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
const count = (table, where = '', parameters = []) => tableExists(table)
  ? Number(db.prepare(`SELECT COUNT(*) count FROM ${table} ${where}`).get(...parameters).count)
  : 0;

try {
  const taxonomySystems = tableExists('taxonomy_systems')
    ? db.prepare('SELECT subject,name FROM taxonomy_systems WHERE deleted=0 ORDER BY subject,name').all()
    : [];
  const activeEpoch = tableExists('primary_host_epochs')
    ? db.prepare("SELECT generation,status FROM primary_host_epochs WHERE status='active' ORDER BY generation DESC LIMIT 1").get() || null
    : null;
  console.log(JSON.stringify({
    quickCheck: db.pragma('quick_check', { simple: true }),
    taxonomy: {
      systems: taxonomySystems,
      nodes: count('taxonomy_nodes', 'WHERE deleted=0'),
      annotations: count('question_taxonomy_nodes'),
      deletionBackups: count('taxonomy_deletion_backups'),
      audits: count('authorization_audit_log', "WHERE action LIKE 'taxonomy_%'"),
    },
    identity: {
      activeDesktopAuthorizations: count('desktop_device_authorizations', "WHERE status='active'"),
      activeEpoch,
    },
    businessCounts: {
      users: count('users', 'WHERE deleted=0'),
      questions: count('questions', 'WHERE deleted=0'),
    },
  }));
} finally {
  db.close();
}
