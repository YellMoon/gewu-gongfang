const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-institution-student-'));
const dbPath = path.join(tempRoot, 'test.db');
process.env.DB_PATH = dbPath;
process.env.APP_ENV = 'dev';

const { DatabaseService } = require('./database');
const db = new DatabaseService();

try {
  const created = db.createInstitution({ name: '\u65b0\u4e1c\u65b9' });
  let managed = db.getAllStudents().filter(student => student.is_institution_student === 1);
  assert.strictEqual(managed.length, 1);
  assert.strictEqual(managed[0].name, '\u65b0\u4e1c\u65b9\u5b66\u751f');
  assert.strictEqual(managed[0].institution_id, created.id);
  assert.strictEqual(managed[0].source_type, 2);

  db.ensureInstitutionStudents();
  db.ensureInstitutionStudents();
  managed = db.getAllStudents().filter(student => student.is_institution_student === 1);
  assert.strictEqual(managed.length, 1);

  db.updateInstitution(created.id, { name: '\u5b66\u800c\u601d' });
  managed = db.getAllStudents().filter(student => student.is_institution_student === 1);
  assert.strictEqual(managed[0].name, '\u5b66\u800c\u601d\u5b66\u751f');

  console.log('institution student lifecycle tests passed');
} finally {
  db.close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
