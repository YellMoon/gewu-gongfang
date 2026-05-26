#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { getInstance } = require('../backend/src/database');
const questionBank = require('../backend/src/services/questionBankService');

function usage() {
  console.log([
    'Usage:',
    '  npm run qb:stats',
    '  npm run qb:clear',
    '  npm run qb:parse-word -- <file.docx> [lecture|exam|auto]',
  ].join('\n'));
}

function count(db, sql, params = []) {
  return db.prepare(sql).get(...params).count;
}

function stats() {
  const service = getInstance();
  const db = service.db;
  const tenantId = process.env.TENANT_ID || 'default';
  const result = {
    tenant_id: tenantId,
    db_path: service.dbPath,
    questions: count(db, 'SELECT COUNT(*) AS count FROM questions WHERE tenant_id = ? AND deleted = 0', [tenantId]),
    deleted_questions: count(db, 'SELECT COUNT(*) AS count FROM questions WHERE tenant_id = ? AND deleted = 1', [tenantId]),
    question_contents: count(db, 'SELECT COUNT(*) AS count FROM question_contents WHERE tenant_id = ?', [tenantId]),
    question_assets: count(db, `SELECT COUNT(*) AS count FROM question_assets WHERE question_id IN (SELECT id FROM questions WHERE tenant_id = ?)`, [tenantId]),
    import_batches: count(db, 'SELECT COUNT(*) AS count FROM import_batches WHERE tenant_id = ?', [tenantId]),
    import_items: count(db, `SELECT COUNT(*) AS count FROM import_items WHERE batch_id IN (SELECT id FROM import_batches WHERE tenant_id = ?)`, [tenantId]),
  };
  console.log(JSON.stringify(result, null, 2));
}

function clear() {
  const service = getInstance();
  const tenantId = process.env.TENANT_ID || 'default';
  const result = questionBank.clearQuestionBankData(service.db, tenantId);
  console.log(JSON.stringify({ success: true, tenant_id: tenantId, db_path: service.dbPath, ...result }, null, 2));
}

function pythonCommand() {
  if (process.env.PYTHON_BIN) return process.env.PYTHON_BIN;
  const bundled = path.join(__dirname, '..', 'runtime', 'python', process.platform === 'win32' ? 'python.exe' : 'python');
  if (fs.existsSync(bundled)) return bundled;
  return process.platform === 'win32' ? 'python' : 'python3';
}

function parseWord(args) {
  const file = args[0];
  const sourceType = args[1] || 'auto';
  if (!file) {
    usage();
    process.exitCode = 1;
    return;
  }
  const fullPath = path.resolve(file);
  if (!fs.existsSync(fullPath)) {
    console.error(`File not found: ${fullPath}`);
    process.exitCode = 1;
    return;
  }
  const parser = path.join(__dirname, '..', 'modules', 'question-bank', 'parsers', 'parse_word.py');
  const proc = spawnSync(pythonCommand(), [parser, fullPath, sourceType], {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 200,
  });
  if (proc.stdout) process.stdout.write(proc.stdout);
  if (proc.stderr) process.stderr.write(proc.stderr);
  process.exitCode = proc.status || 0;
}

const [command, ...args] = process.argv.slice(2);
if (command === 'stats') stats();
else if (command === 'clear') clear();
else if (command === 'parse-word') parseWord(args);
else {
  usage();
  process.exitCode = command ? 1 : 0;
}
