const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { DatabaseService } = require('../database');
const questionBank = require('./questionBankService');

function withTempDatabase(testFn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-question-bank-'));
  const dbPath = path.join(dir, 'test.db');
  const previousDbPath = process.env.DB_PATH;
  const previousReadDbPath = process.env.READ_DB_PATH;
  process.env.DB_PATH = dbPath;
  process.env.READ_DB_PATH = dbPath;

  const service = new DatabaseService();
  try {
    testFn(service.db);
  } finally {
    service.close();
    if (previousDbPath === undefined) delete process.env.DB_PATH;
    else process.env.DB_PATH = previousDbPath;
    if (previousReadDbPath === undefined) delete process.env.READ_DB_PATH;
    else process.env.READ_DB_PATH = previousReadDbPath;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function testImportValidationPrecedesDuplicateDetection() {
  withTempDatabase((db) => {
    const items = [];
    for (let i = 0; i < 993; i++) {
      items.push({ stem: `valid question ${i}`, answer: 'A', subject: 'physics' });
    }
    for (let i = 0; i < 4; i++) {
      items.push({ stem: '   ', answer: '', subject: 'physics' });
    }
    for (let i = 0; i < 3; i++) {
      items.push({ stem: 'duplicate valid', answer: 'B', subject: 'physics' });
    }

    const batch = questionBank.createImportBatch(db, {
      items,
      source_type: 'test',
      file_name: 'bulk.json',
    }, 'default');

    assert.strictEqual(batch.total_items, 1000);
    assert.strictEqual(batch.rejected_items, 4);
    assert.strictEqual(batch.duplicate_items, 2);
    assert.strictEqual(batch.quality_report.errors.missing_stem, 4);
  });
}

function main() {
  testImportValidationPrecedesDuplicateDetection();
  console.log('questionBankService tests passed');
}

main();
