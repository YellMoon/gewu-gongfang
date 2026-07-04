const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

function loadTsModule(modulePath, cache = new Map()) {
  const absolutePath = path.resolve(__dirname, modulePath);
  if (cache.has(absolutePath)) return cache.get(absolutePath).exports;

  const source = fs.readFileSync(absolutePath, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.React,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019,
    },
  }).outputText;

  const module = { exports: {} };
  cache.set(absolutePath, module);

  const localRequire = (request) => {
    if (request.startsWith('.')) {
      const basePath = path.resolve(path.dirname(absolutePath), request);
      for (const candidate of [
        basePath,
        `${basePath}.ts`,
        `${basePath}.tsx`,
        `${basePath}.js`,
        `${basePath}.mjs`,
        path.join(basePath, 'index.ts'),
      ]) {
        if (!fs.existsSync(candidate)) continue;
        if (fs.statSync(candidate).isDirectory()) continue;
        if (candidate.endsWith('.ts') || candidate.endsWith('.tsx')) {
          return loadTsModule(path.relative(__dirname, candidate), cache);
        }
        return require(candidate);
      }
    }
    return require(request);
  };

  const runner = new Function('require', 'module', 'exports', '__filename', '__dirname', compiled);
  runner(localRequire, module, module.exports, absolutePath, path.dirname(absolutePath));
  return module.exports;
}

const financialDetails = loadTsModule('./financialDetails.ts');
const types = loadTsModule('../types/index.ts');

assert.strictEqual(
  typeof financialDetails.buildCourseRefreshFinancialSnapshot,
  'function',
  'course refresh should expose a dedicated financial snapshot builder'
);

{
  const schedule = {
    id: 'schedule-pure-institution',
    course_id: 'course-institution',
    start_time: '2026-07-01 10:00',
    end_time: '2026-07-01 12:00',
    status: types.ScheduleStatus.PLANNED,
    student_ids: [financialDetails.INSTITUTION_UNBOUND_STUDENT_ID],
    student_pricings: [{
      student_id: financialDetails.INSTITUTION_UNBOUND_STUDENT_ID,
      tuition: 120,
      teacher_fee: 60,
      status: types.StudentAttendanceStatus.NORMAL,
    }],
    billing_unit: types.BillingUnit.PER_SESSION,
    teacher_fee_mode: types.TeacherFeeMode.PER_SESSION,
    calculated_tuition: 120,
    calculated_teacher_fee: 60,
  };
  const course = {
    id: 'course-institution',
    name: '机构课',
    display_name: '机构课',
    type: types.CourseType.GROUP,
    source_type: types.CourseSourceType.INSTITUTION,
    institution_id: 'inst-1',
    price_tuition: 480,
    price_teacher: 240,
    billing_unit: types.BillingUnit.PER_SESSION,
    teacher_fee_mode: types.TeacherFeeMode.PER_SESSION,
    student_pricings: [],
    active: true,
    created_at: '',
    updated_at: '',
  };

  const snapshot = financialDetails.buildCourseRefreshFinancialSnapshot(schedule, course);

  assert.deepStrictEqual(snapshot.student_ids, [financialDetails.INSTITUTION_UNBOUND_STUDENT_ID]);
  assert.strictEqual(snapshot.student_pricings[0].tuition, 480);
  assert.strictEqual(snapshot.student_pricings[0].teacher_fee, 240);
  assert.strictEqual(snapshot.calculated_tuition, 480);
  assert.strictEqual(snapshot.calculated_teacher_fee, 240);
}

console.log('financialDetails refresh tests passed');
