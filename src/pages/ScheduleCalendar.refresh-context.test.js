'use strict';
// UTF-8: right-click targeted course refresh must reuse the same sensitive financial logic as the toolbar button.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const dayjs = require('dayjs');

const calendarPath = 'src/pages/ScheduleCalendar.tsx';
const batchPath = 'src/pages/useBatchSelection.tsx';

function transpile(code) {
  return ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
}

function named(code, name) {
  const ast = ts.createSourceFile('calendar.tsx', code, 99, true, 4);
  let found;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert(found, 'missing function ' + name);
  return found.getText(ast);
}

function loadCore(code, env) {
  const names = ['stripCourseSystemPrefix', 'getCourseDisplayName', 'applyCourseRefresh', 'handleRefreshSelectedSchedules'];
  const body = names.map(name => named(code, name)).join('\n') + '\nreturn handleRefreshSelectedSchedules;';
  return new Function(...Object.keys(env), transpile(body))(...Object.values(env));
}

(async () => {
  const { normalizeRefreshDateRange } = await import('../utils/scheduleRefreshRange.mjs');
  const calendar = fs.readFileSync(calendarPath, 'utf8');
  const batch = fs.readFileSync(batchPath, 'utf8');

  // Wiring: both right-click menus must expose the targeted refresh entry.
  const contextMenuMatch = calendar.match(/const getContextMenuItems[\s\S]*?\n\];/u);
  assert(contextMenuMatch, 'missing getContextMenuItems');
  const contextMenu = contextMenuMatch[0];
  assert.ok(contextMenu.includes('刷新课程信息'), 'per-course context menu must offer 刷新课程信息');
  assert.ok(contextMenu.includes('onRefreshSchedules?.([schedule.id])'), 'per-course refresh must target the right-clicked schedule id');
  assert.ok(/key:\s*'batch-refresh'[\s\S]*?刷新课程信息[\s\S]*?onBatchRefresh\(sel\.ids\)/u.test(batch),
    'batch context menu must offer 刷新课程信息 for the selected ids');
  assert.ok(/onBatchRefresh/u.test(batch) && /useBatchSelection\([\s\S]*?onBatchDelete/u.test(batch),
    'batch refresh callback must be threaded through the hook');
  assert.ok(calendar.includes('onRefreshSchedules={handleRefreshSelectedSchedules}'),
    'calendar must pass the targeted refresh handler into the grid');

  const financialModule = (() => {
    const load = (code, req = require) => {
      const mod = { exports: {} };
      new Function('require', 'module', 'exports', transpile(code))(req, mod, mod.exports);
      return mod.exports;
    };
    const types = load(fs.readFileSync('src/types/index.ts', 'utf8'));
    return load(fs.readFileSync('src/utils/financialDetails.ts', 'utf8'), name => name === '../types' ? types : require(name));
  })();

  const courses = [{
    id: 'course', name: 'New name', display_name: 'New display', room_name: 'New address', type: 2, year: 2026,
    semester: 'autumn', teacher_id: 'teacher', teacher_name: 'Teacher', billing_unit: 2, teacher_fee_mode: 2,
    student_pricings: [{ student_id: 'a', tuition: 220, teacher_fee: 160, status: 1 }],
  }];
  const rows = [
    { id: 'lesson-0', course_id: 'course', course_name: 'Old name', room: 'Old address', start_time: '2026-09-07 09:00', end_time: '2026-09-07 10:00', status: 1, notes: 'Preserve note', billing_unit: 1, teacher_fee_mode: 1, student_pricings: [{ student_id: 'a', tuition: 180, teacher_fee: 120, status: 4 }], calculated_tuition: 0, calculated_teacher_fee: 0 },
    { id: 'lesson-1', course_id: 'course', course_name: 'Old name', room: 'Old address', start_time: '2026-09-08 09:00', end_time: '2026-09-08 10:00', status: 1, notes: 'Preserve note', billing_unit: 1, teacher_fee_mode: 1, student_pricings: [{ student_id: 'a', tuition: 180, teacher_fee: 120, status: 4 }], calculated_tuition: 0, calculated_teacher_fee: 0 },
    { id: 'missing-course', course_id: 'missing', course_name: 'Old name', room: 'Old address', start_time: '2026-09-09 09:00', end_time: '2026-09-09 10:00', status: 1, notes: 'Preserve note', billing_unit: 1, teacher_fee_mode: 1, student_pricings: [], calculated_tuition: 0, calculated_teacher_fee: 0 },
  ];

  function run(ids, accept = true) {
    const state = { rows, writes: 0, warnings: [], notices: [], prompts: [] };
    const env = {
      schedules: rows,
      dayjs,
      normalizeRefreshDateRange,
      window: { confirm: text => { state.prompts.push(text); return accept; }, dbService: { getAllCourses: () => courses } },
      buildCourseRefreshFinancialSnapshot: financialModule.buildCourseRefreshFinancialSnapshot,
      setSchedulesWithHistory: next => { state.rows = next; state.writes++; },
      message: { warning: text => state.warnings.push(text), success: text => state.notices.push(text) },
    };
    const handler = loadCore(calendar, env);
    handler(ids);
    return { state, handler };
  }

  // Targeted refresh must apply the same sensitive fields to exactly the selected lessons.
  const selected = run(['lesson-0']);
  assert.equal(selected.state.writes, 1, 'confirmed targeted refresh writes once');
  assert.equal(selected.state.prompts.length, 1, 'targeted refresh asks for confirmation');
  assert.match(selected.state.notices[0], /1/, 'targeted refresh reports the updated count');
  const target = selected.state.rows[0];
  assert.equal(target.room, 'New address');
  assert.equal(target.course_name, 'New display');
  assert.equal(target.billing_unit, 2);
  assert.equal(target.teacher_fee_mode, 2);
  assert.equal(target.teacher_name, 'Teacher');
  assert.deepEqual(target.student_pricings, courses[0].student_pricings);
  assert.equal(target.notes, 'Preserve note');
  assert.equal(selected.state.rows[1].room, 'Old address', 'unselected lessons must be untouched');
  assert.equal(selected.state.rows[1].billing_unit, 1, 'unselected lessons keep their financial snapshot');

  // Multiple selections refresh each selected lesson.
  const multi = run(['lesson-0', 'lesson-1']);
  assert.equal(multi.state.rows[0].room, 'New address');
  assert.equal(multi.state.rows[1].room, 'New address');
  assert.match(multi.state.notices[0], /2/);

  // Cancelling the confirmation must not write.
  const cancelled = run(['lesson-0'], false);
  assert.equal(cancelled.state.writes, 0, 'cancelled targeted refresh must not write');

  // Empty selection warns and does not write.
  const empty = run([]);
  assert.equal(empty.state.writes, 0, 'empty selection must not write');
  assert.equal(empty.state.warnings.length, 1, 'empty selection warns');
  assert.equal(empty.state.prompts.length, 0, 'empty selection must not prompt');

  // A selection with no matching course must not fabricate a write.
  const unmatched = run(['missing-course']);
  assert.equal(unmatched.state.writes, 0, 'unmatched selection must not write');
  assert.equal(unmatched.state.warnings.length, 1, 'unmatched selection warns');

  console.log('targeted refresh context-menu checks passed');
})().catch(error => { console.error(error); process.exit(1); });
