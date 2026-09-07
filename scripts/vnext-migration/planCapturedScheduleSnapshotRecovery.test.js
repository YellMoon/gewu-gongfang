'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createHash } = require('node:crypto');
const { planCapturedScheduleSnapshotRecovery } = require('./planCapturedScheduleSnapshotRecovery');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-recovery-plan-test-'));
const write = (name, data) => fs.writeFileSync(path.join(root, name), JSON.stringify(data), 'utf8');
const hash = name => createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex');
try {
  write('source-schedules.json', [{ id: 'lesson-1', tenant_id: 'default' }]);
  write('source-course-rosters.json', []);
  write('schedule-snapshot-candidates.json', [{ key: 'schedules', array: true, rows: [{ id: 'lesson-1' }] }]);
  const database = [{ path: 'scheduling.db', sha256: 'a'.repeat(64) }];
  write('source-lineage.json', { readOnly: true, database, schedulesSha256: hash('source-schedules.json'), cacheSha256: hash('schedule-snapshot-candidates.json') });
  write('source-course-lineage.json', { readOnly: true, database, sha256: hash('source-course-rosters.json') });
  write('cloud-schedule-baseline.json', { readOnly: true, role: 'super_admin', schedules: [], teacherIds: [] });
  const outputPath = path.join(root, 'proposal.json');
  const before = hash('source-schedules.json');
  const receipt = planCapturedScheduleSnapshotRecovery({ captureDirectory: root, outputPath });
  assert.equal(receipt.mode, 'read_only_proposal');
  assert.deepEqual(receipt.counts, { NO_EXPLICIT_CACHE_SNAPSHOT: 1 });
  assert.equal(receipt.proposalSha256, hash('proposal.json'));
  assert.equal(hash('source-schedules.json'), before);
  assert.throws(() => planCapturedScheduleSnapshotRecovery({ captureDirectory: root, outputPath }), /EEXIST/);
  write('cloud-schedule-baseline.json', { readOnly: true, role: 'student', schedules: [], teacherIds: [] });
  assert.throws(() => planCapturedScheduleSnapshotRecovery({ captureDirectory: root, outputPath: path.join(root, 'student.json') }), /FULL_CLOUD_SCOPE_REQUIRED/);
  assert.equal(fs.existsSync(path.join(root, 'student.json')), false);
  write('source-course-rosters.json', [{ id: 'changed' }]);
  assert.throws(() => planCapturedScheduleSnapshotRecovery({ captureDirectory: root, outputPath }), /COURSE_SOURCE_EVIDENCE_CHANGED/);
  write('source-course-rosters.json', []);
  write('source-schedules.json', []);
  assert.throws(() => planCapturedScheduleSnapshotRecovery({ captureDirectory: root, outputPath }), /SOURCE_EVIDENCE_CHANGED/);
} finally {
  // Only the exact directory freshly created by this test; never a user-supplied path.
  fs.rmSync(root, { recursive: true, force: true });
}
console.log('captured schedule recovery read-only CLI checks passed');
