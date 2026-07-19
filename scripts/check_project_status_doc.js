const fs = require('fs');
const path = require('path');

const STATUS_DOC_PATH = 'docs/project-status-2026-06-27.md';
const IDENTITY_VERIFICATION_PATH = 'docs/verification-2026-07-17-desktop-human-identity.md';

const STATUS_MARKERS = Object.freeze([
  '\u963f\u91cc\u4e91\u540e\u7aef',
  '\u5fae\u4fe1\u5c0f\u7a0b\u5e8f',
  '\u672c\u5730\u6570\u636e\u4e3b\u673a',
  '\u79fb\u52a8\u786c\u76d8\u9898\u5e93',
  '\u79bb\u7ebf\u540c\u6b65',
  'gewu/master',
]);

const IDENTITY_EVIDENCE_KEYS = Object.freeze([
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
]);

function readRequired(relativePath) {
  const absolutePath = path.join(process.cwd(), relativePath);
  if (!fs.existsSync(absolutePath)) return null;
  return fs.readFileSync(absolutePath, 'utf-8');
}

function checkProjectStatusDocs() {
  const issues = [];
  const statusDoc = readRequired(STATUS_DOC_PATH);
  const identityDoc = readRequired(IDENTITY_VERIFICATION_PATH);
  if (statusDoc === null) issues.push(`${STATUS_DOC_PATH}: missing`);
  if (identityDoc === null) issues.push(`${IDENTITY_VERIFICATION_PATH}: missing`);
  if (statusDoc !== null) {
    for (const marker of STATUS_MARKERS) {
      if (!statusDoc.includes(marker)) issues.push(`${STATUS_DOC_PATH}: missing marker ${marker}`);
    }
  }
  if (identityDoc !== null) {
    for (const key of IDENTITY_EVIDENCE_KEYS) {
      if (!identityDoc.includes(key)) issues.push(`${IDENTITY_VERIFICATION_PATH}: missing evidence ${key}`);
    }
    for (const [label, pattern] of [
      ['raw phone number', /\b1[3-9]\d{9}\b/],
      ['bearer token', /Bearer\s+[A-Za-z0-9._~-]{8,}/i],
      ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
      ['private Windows user path', /[A-Za-z]:\\Users\\[^\\\s]+/i],
      ['recovery secret value', /recoveryCode\s*[:=]\s*[A-Za-z0-9_-]{16,}/i],
    ]) {
      if (pattern.test(identityDoc)) issues.push(`${IDENTITY_VERIFICATION_PATH}: contains ${label}`);
    }
  }
  return Object.freeze({
    statusDoc: STATUS_DOC_PATH,
    identityVerification: IDENTITY_VERIFICATION_PATH,
    issues: Object.freeze(issues),
  });
}

function main() {
  const result = checkProjectStatusDocs();
  console.log('Project status documentation gate');
  console.log(`- status document: ${result.statusDoc}`);
  console.log(`- identity verification: ${result.identityVerification}`);
  console.log(`- result: ${result.issues.length === 0 ? 'pass' : 'fail'}`);
  for (const issue of result.issues) console.log(`- ${issue}`);
  if (result.issues.length > 0) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = {
  checkProjectStatusDocs,
  IDENTITY_EVIDENCE_KEYS,
  IDENTITY_VERIFICATION_PATH,
  STATUS_DOC_PATH,
};
