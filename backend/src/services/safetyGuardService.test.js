const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createMaintenanceToken,
  prepareDangerousAction,
  commitDangerousAction,
  assertSafeDiskTarget,
  auditSafetyEvent,
} = require('./safetyGuardService');

assert.throws(() => {
  prepareDangerousAction({
    action: 'format-question-bank-disk',
    target: { label: 'SSK USB SSD' },
    token: 'missing',
    nowMs: 1000,
  });
}, /maintenance token/i);

const token = createMaintenanceToken({ actor: 'codex', nowMs: 1000, ttlMs: 5000 });
assert.strictEqual(token.actor, 'codex');
assert.ok(token.token.length >= 32);

const prepared = prepareDangerousAction({
  action: 'clear-question-bank-data',
  target: { label: 'GEWU_QB_SSD I:' },
  token: token.token,
  nowMs: 1500,
  ttlMs: 5000,
});
assert.match(prepared.challenge, /clear-question-bank-data/);
assert.match(prepared.challenge, /GEWU_QB_SSD I:/);

assert.throws(() => {
  commitDangerousAction({
    challengeId: prepared.challengeId,
    response: 'wrong phrase',
    token: token.token,
    nowMs: 2000,
  });
}, /challenge/i);

const committed = commitDangerousAction({
  challengeId: prepared.challengeId,
  response: prepared.challenge,
  token: token.token,
  nowMs: 2000,
});
assert.strictEqual(committed.ok, true);
assert.strictEqual(committed.action, 'clear-question-bank-data');

assert.throws(() => {
  commitDangerousAction({
    challengeId: prepared.challengeId,
    response: prepared.challenge,
    token: token.token,
    nowMs: 2100,
  });
}, /already used/i);

assert.throws(() => {
  prepareDangerousAction({
    action: 'format-question-bank-disk',
    target: { label: 'GEWU_QB_SSD I:' },
    token: token.token,
    nowMs: 7000,
  });
}, /expired/i);

assert.doesNotThrow(() => assertSafeDiskTarget({
  diskNumber: 1,
  busType: 'USB',
  friendlyName: 'SSK USB SSD',
  driveLetter: 'I',
  rootPath: 'I:/GewuQuestionBank',
}, {
  expectedFriendlyNameIncludes: 'SSK',
  expectedRootName: 'GewuQuestionBank',
}));

assert.throws(() => assertSafeDiskTarget({
  diskNumber: 0,
  busType: 'NVMe',
  friendlyName: 'System Disk',
  driveLetter: 'C',
  rootPath: 'C:/Users/83423',
}), /system disk/i);

assert.throws(() => assertSafeDiskTarget({
  diskNumber: 2,
  busType: 'USB',
  friendlyName: 'Random USB',
  driveLetter: 'C',
  rootPath: 'C:/GewuQuestionBank',
}), /system drive/i);

const auditDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-safety-audit-'));
const auditPath = path.join(auditDir, 'safety-audit.log');
auditSafetyEvent({
  type: 'dangerous-action-prepared',
  actor: 'codex',
  action: 'format-question-bank-disk',
  token: token.token,
}, { logPath: auditPath, nowMs: 3000 });

const auditLine = fs.readFileSync(auditPath, 'utf-8').trim();
const auditRecord = JSON.parse(auditLine);
assert.strictEqual(auditRecord.type, 'dangerous-action-prepared');
assert.strictEqual(auditRecord.action, 'format-question-bank-disk');
assert.strictEqual(auditRecord.token, undefined);
assert.strictEqual(auditRecord.at, new Date(3000).toISOString());

console.log('safety guard checks passed');
