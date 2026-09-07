'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { buildScheduleSnapshotRecoveryPlan } = require('./scheduleSnapshotRecoveryPlan');

// No apply option: proposals are separate from any future backed-up, CAS-gated restore.
function planCapturedScheduleSnapshotRecovery({ captureDirectory, outputPath }) {
  const root = fs.realpathSync(captureDirectory);
  const read = name => {
    const file = fs.realpathSync(path.join(root, name));
    if (path.dirname(file) !== root || !fs.statSync(file).isFile()) throw new Error('CAPTURE_FILE_OUTSIDE_DIRECTORY');
    const bytes = fs.readFileSync(file);
    return { data: JSON.parse(bytes.toString('utf8')), sha256: createHash('sha256').update(bytes).digest('hex') };
  };
  const lineage = read('source-lineage.json').data;
  const cached = read('schedule-snapshot-candidates.json'), source = read('source-schedules.json');
  const courses = read('source-course-rosters.json'), cloud = read('cloud-schedule-baseline.json');
  const courseLineage = read('source-course-lineage.json').data;
  if (!Array.isArray(lineage.database) || !lineage.database.length || lineage.database.some(item => !item || typeof item.path !== 'string' || path.basename(item.path) !== item.path || !/^[a-f0-9]{64}$/.test(item.sha256))) throw new Error('DATABASE_LINEAGE_REQUIRED');
  if (lineage.readOnly !== true || cached.sha256 !== lineage.cacheSha256 || source.sha256 !== lineage.schedulesSha256) throw new Error('SOURCE_EVIDENCE_CHANGED');
  if (courseLineage.readOnly !== true || courseLineage.sha256 !== courses.sha256 || JSON.stringify(courseLineage.database) !== JSON.stringify(lineage.database)) throw new Error('COURSE_SOURCE_EVIDENCE_CHANGED');
  if (cloud.data.readOnly !== true || cloud.data.role !== 'super_admin') throw new Error('FULL_CLOUD_SCOPE_REQUIRED');
  const tenants = new Set(source.data.map(row => row.tenant_id));
  if (tenants.size !== 1) throw new Error('SINGLE_SOURCE_TENANT_REQUIRED');
  const schedulingKeys = cached.data.filter(item => item.key === 'schedules' && item.array === true);
  if (schedulingKeys.length !== 1) throw new Error('UNIQUE_SCHEDULE_CACHE_REQUIRED');
  const proposal = buildScheduleSnapshotRecoveryPlan({ tenantId: [...tenants][0], cacheSchedules: schedulingKeys[0].rows,
    sourceSchedules: source.data, sourceCourses: courses.data, cloudSchedules: cloud.data.schedules, cloudTeacherIds: cloud.data.teacherIds,
    evidence: { cacheSha256: cached.sha256, sourceSha256: source.sha256, sourceCoursesSha256: courses.sha256, cloudSha256: cloud.sha256 } });
  const bytes = Buffer.from(JSON.stringify(proposal, null, 2), 'utf8');
  fs.writeFileSync(outputPath, bytes, { flag: 'wx' });
  return { mode: proposal.mode, counts: proposal.counts, cloudSnapshotFieldsProjected: proposal.cloudSnapshotFieldsProjected,
    proposalSha256: createHash('sha256').update(bytes).digest('hex') };
}
if (require.main === module) {
  if (process.argv.length !== 4) throw new Error('USAGE: node planCapturedScheduleSnapshotRecovery.js CAPTURE_DIRECTORY NEW_PROPOSAL_PATH');
  console.log(JSON.stringify(planCapturedScheduleSnapshotRecovery({ captureDirectory: process.argv[2], outputPath: process.argv[3] })));
}
module.exports = { planCapturedScheduleSnapshotRecovery };
