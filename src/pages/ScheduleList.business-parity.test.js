const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

const source = fs.readFileSync('src/pages/ScheduleList.tsx', 'utf8');
const ast = ts.createSourceFile('ScheduleList.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const tags = [];
const visit = node => {
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) tags.push(node.tagName.getText(ast));
  ts.forEachChild(node, visit);
};
visit(ast);
// The pre-migration list (323862ef^) is a query/export surface. Mutations use
// the existing calendar workflow, not a second, reduced cloud-only form.
assert(!tags.includes('Modal') && !tags.includes('Form'), 'migration must not add a parallel schedule editor to the list');
for (const command of ['openCloudScheduleEditor', 'saveCloudSchedule', 'updateCloudSchedule', 'editingSchedule']) {
  assert(!source.includes(command), `retired parallel list editor must not retain ${command}`);
}
assert(source.includes('applyScheduleListFilters') && source.includes('createScheduleWorkbook'));
assert(source.includes('listCloudBusinessProjection') && source.includes('projectCloudScheduleRecords(projection)'));
console.log('schedule list original business surface checks passed');
