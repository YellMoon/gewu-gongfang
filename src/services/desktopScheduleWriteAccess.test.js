const assert = require('node:assert/strict');
(async () => {
  const { hasDesktopScheduleWriteAccess: canWrite } = await import('./desktopScheduleWriteAccess.mjs');
  assert.equal(canWrite({ activeRole: 'super_admin', eligibleRoles: ['super_admin'] }), true);
  assert.equal(canWrite({ activeRole: 'teacher', eligibleRoles: ['teacher'], teacherId: 'teacher-1' }), true);
  assert.equal(canWrite({ activeRole: 'teacher', eligibleRoles: ['super_admin', 'teacher'], teacherId: 'teacher-1' }), true);
  for (const input of [null, {}, { activeRole: 'teacher', eligibleRoles: ['teacher'] },
    { activeRole: 'teacher', eligibleRoles: ['teacher'], teacherId: ' teacher-1 ' },
    { activeRole: 'teacher', eligibleRoles: ['super_admin'], teacherId: 'teacher-1' },
    { activeRole: 'student', eligibleRoles: ['super_admin', 'student'] },
    { activeRole: 'family_member', eligibleRoles: ['family_member'] },
    { activeRole: 'visitor', eligibleRoles: [] },
  ]) assert.equal(canWrite(input), false);
  console.log('desktop schedule write access checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
