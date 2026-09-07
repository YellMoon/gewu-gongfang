// UTF-8. Read-only source comparison, not a runtime/business acceptance test.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const baseline = cp.execFileSync('git', ['rev-parse', '8118419f'], { cwd: root, encoding: 'utf8' }).trim();
const targets = {
  'src/pages/ScheduleCalendar.tsx': ['stripCourseSystemPrefix', 'getCourseDisplayName', 'Sidebar', 'handleOpenStudentEdit', 'handleSaveStudentEdit', 'handleDropCourse', 'checkOverlap', 'handleDragSchedule', 'handleResizeSchedule', 'handleDeleteSchedule', 'handleSave', 'handleRefreshCourseInfo'],
  'src/pages/CourseList.tsx': ['handleEdit', 'handleDelete', 'handleSubmit', 'syncSchedulesRoomName', 'getCourseStudentNames'],
  'src/pages/StudentList.tsx': ['handleEdit', 'handleDelete', 'handleSubmit'],
  'src/pages/TeacherList.tsx': ['handleEdit', 'handleDelete', 'handleSubmit'],
  'src/pages/RoomManager.tsx': ['handleEdit', 'handleDelete', 'handleSubmit'],
};
const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
function parse(file, text) { return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); }
function find(source, name) {
  let found;
  function visit(node) {
    if ((ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) && node.name?.getText(source) === name) { found = node; return; }
    if (!found) ts.forEachChild(node, visit);
  }
  visit(source);
  return found;
}
function summary(source, node) {
  if (!node) return null;
  const text = printer.printNode(ts.EmitHint.Unspecified, node, source);
  return { line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, sha256: crypto.createHash('sha256').update(text).digest('hex') };
}
const rows = [];
for (const [file, names] of Object.entries(targets)) {
  const old = parse(file, cp.execFileSync('git', ['show', `${baseline}:${file}`], { cwd: root, encoding: 'utf8' }));
  const current = parse(file, fs.readFileSync(path.join(root, file), 'utf8'));
  for (const name of names) {
    const before = summary(old, find(old, name));
    const after = summary(current, find(current, name));
    rows.push({ file, name, before, after, result: !before || !after ? 'missing-needs-inspection' : before.sha256 === after.sha256 ? 'same-source-not-runtime-proof' : 'changed-needs-behavior-review' });
  }
}
process.stdout.write(JSON.stringify({ baseline, baselineScope: 'July source comparison; not user-confirmed final business baseline', acceptance: false, rows }, null, 2) + '\n');
