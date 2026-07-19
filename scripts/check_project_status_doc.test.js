const assert = require('assert');
const fs = require('fs');
const path = require('path');

const STATUS_DOC = path.join(process.cwd(), 'docs/project-status-2026-06-27.md');
const IDENTITY_VERIFICATION_DOC = path.join(
  process.cwd(),
  'docs/verification-2026-07-17-desktop-human-identity.md'
);
const STATUS_CHECK_SCRIPT = path.join(process.cwd(), 'scripts/check_project_status_doc.js');

assert.ok(fs.existsSync(STATUS_DOC), 'current project status document should exist');
assert.ok(fs.existsSync(STATUS_CHECK_SCRIPT), 'project status executable gate should exist');
assert.ok(fs.existsSync(IDENTITY_VERIFICATION_DOC), 'desktop human identity verification document should exist');

const doc = fs.readFileSync(STATUS_DOC, 'utf-8');

for (const required of [
  '阿里云后端',
  '微信小程序',
  '等待审核',
  '本地数据主机',
  '移动硬盘题库',
  'NAS 备份',
  '离线同步',
  '权限边界',
  '不打包',
  '不上传夸克网盘',
  'gewu/master',
]) {
  assert.ok(doc.includes(required), `status document should mention: ${required}`);
}

assert.ok(doc.includes('5.0.34'), 'status document should record current deployed/uploaded version');
assert.ok(doc.includes('I:/GewuQuestionBank'), 'status document should record active question bank path');
assert.ok(doc.includes('\\\\192.168.124.2\\lin1225_存储空间1'), 'status document should record NAS backup share');
assert.ok(doc.includes('https://physicsedu.xyz/scheduling'), 'status document should record cloud API base URL');
assert.ok(doc.includes('发布线上版'), 'status document should describe the next action after miniapp approval');

const identityVerification = fs.readFileSync(IDENTITY_VERIFICATION_DOC, 'utf-8');
for (const evidenceKey of [
  'dual-role-super-admin-teacher',
  'device-host',
  'device-second',
  'device-replacement',
  'fresh-phone-challenge',
  'same-device-self-approval-rejected',
  'trusted-device-approval',
  'password-wrong-and-recovery',
  'online-offline-expired',
  'teacher-admin-scope',
  'revocation',
  'host-bootstrap',
  'transfer-failure-and-success',
  'recovery-missing-factor-rejected',
  'electron-host-wide',
  'electron-client-narrow',
  'redacted_evidence_only: true',
  'release_status: not-published',
]) {
  assert.ok(identityVerification.includes(evidenceKey), `identity verification should include: ${evidenceKey}`);
}

const statusGate = require('./check_project_status_doc');
assert.deepStrictEqual(statusGate.checkProjectStatusDocs().issues, []);

console.log('project status document checks passed');
