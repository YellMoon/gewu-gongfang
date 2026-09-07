// UTF-8: preserve the original three-field course card; do not hide real course names.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { JSDOM } = require('jsdom');
const dayjs = require('dayjs');

const source = fs.readFileSync(path.join(__dirname, 'ScheduleCalendar.tsx'), 'utf8');
const ast = ts.createSourceFile('ScheduleCalendar.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let card;
function visit(node) {
  if (ts.isJsxExpression(node) && node.expression?.getText(ast) === 'schedule.course_name') {
    assert.equal(card, undefined, 'expected one settled course-card content block');
    card = node.parent.parent;
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert(card && ts.isJsxElement(card), 'must render the actual calendar card, not a copied template');
const compiled = ts.transpileModule(`return (${card.getText(ast)});`, {
  compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
}).outputText;
const renderCard = new Function('React', 'dayjs', 'schedule', 'roomDisplay', 'textColor', 'isDragging', compiled);

for (const name of ['初二物理', 'E2E-20260905-物理课程', '2026提高班-A01']) {
  const schedule = {
    course_name: name,
    start_time: '2026-09-07T10:00:00', end_time: '2026-09-07T12:00:00',
    id: 'INTERNAL-SCHEDULE-ID', course_id: 'INTERNAL-COURSE-ID',
    subject: '科目不另列', teacher_name: '教师不另列', status: 1,
  };
  for (const room of ['东湖上课点', '']) {
    const html = renderToStaticMarkup(renderCard(React, dayjs, schedule, room, '#333', false));
    const document = new JSDOM(html).window.document;
    const lines = [...document.body.firstElementChild.children].map(element => element.textContent);
    assert.deepEqual(lines, [name, `${room ? room + ' ' : ''}10:00-12:00`],
      'card must only contain full course name, readable address and course time');
    for (const extra of [schedule.id, schedule.course_id, schedule.subject, schedule.teacher_name]) {
      assert(!document.body.textContent.includes(extra), 'must not add internal IDs or extra business fields');
    }
    document.defaultView.close();
  }
}
console.log('original three-field calendar card rendering checks passed');
