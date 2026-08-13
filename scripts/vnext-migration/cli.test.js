'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const Database = require('better-sqlite3');

const cliPath = path.join(__dirname, 'cli.js');
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-migration-cli-'));
const outputWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-migration-output-'));

function hashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function run(args) {
  const result = spawnSync(process.execPath, [cliPath, ...args, '--json'], {
    cwd: path.dirname(path.dirname(__dirname)),
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test' },
  });
  const stdout = String(result.stdout || '').trim();
  assert.ok(stdout, `expected JSON stdout; stderr=${result.stderr}`);
  assert.doesNotThrow(() => JSON.parse(stdout), stdout);
  assert.ok(!stdout.includes(workspace), 'stdout must not expose absolute paths');
  assert.ok(!String(result.stderr || '').includes(workspace), 'stderr must not expose absolute paths');
  return { ...result, body: JSON.parse(stdout) };
}

try {
  const dbPath = path.join(workspace, 'source.db');
  const db = new Database(dbPath);
  db.exec('CREATE TABLE records(id INTEGER PRIMARY KEY, value TEXT); INSERT INTO records(value) VALUES (\'kept\')');
  db.close();
  const filesRoot = path.join(workspace, 'question-files');
  fs.mkdirSync(filesRoot);
  const questionFile = path.join(filesRoot, 'question.txt');
  fs.writeFileSync(questionFile, 'question payload', 'utf8');
  const before = { db: hashFile(dbPath), file: hashFile(questionFile) };

  const bundlePath = path.join(outputWorkspace, 'bundle-one');
  const inventory = run(['inventory', '--db', dbPath, '--files', filesRoot, '--output', bundlePath]);
  assert.strictEqual(inventory.status, 0);
  assert.strictEqual(inventory.body.ok, true);
  assert.strictEqual(inventory.body.command, 'inventory');
  assert.match(inventory.body.bundleHash, /^[a-f0-9]{64}$/);
  assert.deepStrictEqual(inventory.body.sourceIds, ['authority-db', 'question-files']);
  assert.deepStrictEqual({ db: hashFile(dbPath), file: hashFile(questionFile) }, before);

  const verify = run(['verify', '--bundle', bundlePath]);
  assert.strictEqual(verify.status, 0);
  assert.strictEqual(verify.body.ok, true);
  assert.strictEqual(verify.body.command, 'verify');
  assert.strictEqual(verify.body.bundleHash, inventory.body.bundleHash);

  const missingOutput = run(['inventory', '--db', dbPath]);
  assert.notStrictEqual(missingOutput.status, 0);
  assert.strictEqual(missingOutput.body.error.code, 'MIGRATION_OUTPUT_REQUIRED');

  const overlap = run(['inventory', '--db', dbPath, '--output', path.join(workspace, 'nested-output')]);
  assert.notStrictEqual(overlap.status, 0);
  assert.strictEqual(overlap.body.error.code, 'MIGRATION_OUTPUT_OVERLAPS_SOURCE');

  const corruptDb = path.join(workspace, 'corrupt.db');
  fs.writeFileSync(corruptDb, 'not a sqlite database', 'utf8');
  const corrupt = run(['inventory', '--db', corruptDb, '--output', path.join(os.tmpdir(), `gewu-corrupt-${process.pid}`)]);
  assert.notStrictEqual(corrupt.status, 0);
  assert.strictEqual(corrupt.body.error.code, 'MIGRATION_SQLITE_OPEN_FAILED');

  const existing = run(['inventory', '--db', dbPath, '--output', bundlePath]);
  assert.notStrictEqual(existing.status, 0);
  assert.strictEqual(existing.body.error.code, 'MIGRATION_OUTPUT_ALREADY_EXISTS');

  console.log('vNext migration CLI process checks passed');
} finally {
  fs.rmSync(workspace, { recursive: true, force: true });
  fs.rmSync(outputWorkspace, { recursive: true, force: true });
  const corruptOutput = path.join(os.tmpdir(), `gewu-corrupt-${process.pid}`);
  if (fs.existsSync(corruptOutput)) fs.rmSync(corruptOutput, { recursive: true, force: true });
  if (fs.existsSync(`${corruptOutput}.partial`)) fs.rmSync(`${corruptOutput}.partial`, { recursive: true, force: true });
}
