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
    student_ids: [],
    student_pricings: [{
      student_id: '__institution_unbound__',
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
    student_pricings: [{
      student_id: 'institution-student-1',
      tuition: 480,
      teacher_fee: 240,
      status: types.StudentAttendanceStatus.NORMAL,
    }],
    active: true,
    created_at: '',
    updated_at: '',
  };

  const snapshot = financialDetails.buildCourseRefreshFinancialSnapshot(schedule, course);

  assert.deepStrictEqual(snapshot.student_ids, ['institution-student-1']);
  assert.strictEqual(snapshot.student_ids.includes(financialDetails.INSTITUTION_UNBOUND_STUDENT_ID), false);
  assert.strictEqual(snapshot.student_pricings[0].tuition, 480);
  assert.strictEqual(snapshot.student_pricings[0].teacher_fee, 240);
  assert.strictEqual(snapshot.calculated_tuition, 480);
  assert.strictEqual(snapshot.calculated_teacher_fee, 240);
}

console.log('financialDetails refresh tests passed');

// Exercise the original financial rules through the cloud projection and draft
// adapters. A field-name mismatch must not turn leave/cancellation into normal.
(async () => {
  const { buildAuthorityBackedBrowserCache } = await import('../services/authorityProjectionCacheAdapter.mjs');
  const { createAuthorityDraftFromLocalMutation } = await import('../services/authorityDraftAdapter.mjs');
  const { createDesktopCloudBusinessDraftAdapter } = await import('../services/desktopCloudBusinessDraft.mjs');
  for (const attendance of [1, 3, 4]) {
    const course = { id: 'course-attendance', billing_unit: types.BillingUnit.PER_HOUR, teacher_fee_mode: types.TeacherFeeMode.PER_SESSION };
    const row = { id: 'schedule-attendance', course_id: course.id, start_time: '2026-09-07T01:00:00Z', end_time: '2026-09-07T02:30:00Z', status: 1, updated_at: '2026-09-07T00:00:00Z', student_pricings: [{ student_id: 'student-1', attendance_status: attendance, tuition: 180, teacher_fee: 120 }] };
    const projection = { protocol: 'gewu.authority-projection.v1', sourceVersion: 1, payload: { schedules: [row], courses: [course] } };
    const cache = buildAuthorityBackedBrowserCache({ projection });
    const local = cache.schedules[0];
    assert.strictEqual(local.student_pricings[0].status, attendance, 'cloud attendance must use the field expected by the original form');
    assert.strictEqual(Object.hasOwn(local.student_pricings[0], 'attendance_status'), false, 'one canonical field prevents stale alias conflicts');
    const expected = financialDetails.buildScheduleFinancialSnapshot({ ...row, student_pricings: [{ student_id: 'student-1', status: attendance, tuition: 180, teacher_fee: 120 }] }, course);
    const calculated = financialDetails.buildScheduleFinancialSnapshot(local, course);
    assert.deepStrictEqual(calculated, expected, 'cloud-loaded lesson must keep original attendance and financial behavior');
    const mutation = createAuthorityDraftFromLocalMutation({ collection: 'schedules', action: 'update', recordId: row.id, baseVersion: row.updated_at, value: { ...local, ...calculated } });
    let submitted;
    const adapter = createDesktopCloudBusinessDraftAdapter({ baseUrl: 'https://business.example', sha256: value => `hash:${value}`, cloudClient: { updateCloudSchedule: async input => { submitted = input; return { id: row.id, updatedAt: '2026-09-07T03:00:00Z' }; } } });
    const command = adapter.createCommand({ ...mutation, id: 'draft-attendance' });
    await adapter.submit(command, { sessionToken: 'test-session' });
    assert.strictEqual(submitted.pricings[0].attendanceStatus, attendance);
    assert.strictEqual(submitted.tuition, expected.calculated_tuition);
    assert.strictEqual(submitted.teacherFee, expected.calculated_teacher_fee);
    assert.strictEqual(submitted.expectedUpdatedAt, row.updated_at);
    assert.strictEqual(submitted.billingUnit, expected.billing_unit);
    assert.strictEqual(submitted.teacherFeeMode, expected.teacher_fee_mode);
    assert.strictEqual(row.student_pricings[0].attendance_status, attendance, 'cloud input must not be mutated');
  }
  console.log('cloud attendance original financial round-trip checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
