'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function loadTs(filename, customRequire = require, clock = Date) {
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'Date', output)(customRequire, module, module.exports, clock);
  return module.exports;
}
const desktop = loadTs(path.join(__dirname, '../../..', 'src/utils/helpers.ts'));
const { studentSchoolLabel, studentGradeLabel, studentPaymentAmount } = loadTs(path.join(__dirname, 'studentDisplay.ts'), name => {
  assert.equal(name, '../../../src/utils/helpers');
  return desktop;
});
assert.equal(studentSchoolLabel('["School A"]'), 'School A');
assert.equal(studentSchoolLabel('["School A","School B"]'), 'School A\u3001School B');
assert.equal(studentSchoolLabel(' School A '), 'School A');
assert.equal(studentSchoolLabel(null), '');
assert.equal(studentSchoolLabel('[]'), '');
assert.equal(studentSchoolLabel('[invalid'), '[invalid');
for (const year of [2019, 2023, 2024, 2025, 2026, 2027]) {
  assert.equal(studentGradeLabel({ grade_year: year, grade_current: 'stale' }), desktop.calculateGrade(year));
}
assert.equal(studentGradeLabel({ grade_current: 'Existing grade' }), 'Existing grade');
assert.equal(studentGradeLabel({}), '');
assert.equal(studentPaymentAmount({ payment_type: 1, amount: 1200 }), '+\u00a51200');
assert.equal(studentPaymentAmount({ payment_type: 2, amount: 12 }), '+12 \u8bfe\u65f6');
const detail = fs.readFileSync(path.join(__dirname, '../pages/student-detail/index.tsx'), 'utf8');
assert.match(detail, /studentPaymentAmount\(p\)/);
// UTF-8: Cache-aware failure behavior is executed in detailRuntime.test.js.
assert.match(detail, /refreshed = await pullFromCloudBusinessProjection\(\)/);
assert.match(detail, /setLoadFailed\(!refreshed\)/);
assert.match(detail, /if \(!student && loadFailed\)/, 'failed uncached reads cannot be rendered as empty ledger records');
for (const timestamp of ['2026-08-31T12:00:00', '2026-09-01T12:00:00']) {
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [timestamp])); } }
  const original = loadTs(path.join(__dirname, '../../..', 'src/utils/helpers.ts'), require, FixedDate);
  const mobile = loadTs(path.join(__dirname, 'studentDisplay.ts'), require, FixedDate);
  for (const year of [2023, 2024, 2025, 2026, 2027]) {
    assert.equal(mobile.studentGradeLabel({ grade_year: year }), original.calculateGrade(year));
  }
}
for (const filename of ['students/index.tsx', 'student-detail/index.tsx']) {
  const source = fs.readFileSync(path.join(__dirname, '../pages', filename), 'utf8');
  assert.match(source, /studentSchoolLabel\(/);
  assert.match(source, /studentGradeLabel\(/);
  assert.doesNotMatch(source, /\$\{s\.grade_year\}年级/);
}
console.log('student school and desktop grade presentation parity checks passed');
