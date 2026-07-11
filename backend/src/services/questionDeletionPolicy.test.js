const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { DatabaseService } = require('../database');
const questionBank = require('./questionBankService');
const { canDeleteQuestion } = require('./questionDeletionPolicy');

const trustedHost = {
  runtimeNodeRole: 'primary-host', tokenUse: 'desktop-session',
  tokenDeviceId: 'host-1', deviceId: 'host-1', deviceTrusted: true,
  deviceActive: true, deviceOwnerUserId: 'u1', userId: 'u1', userApproved: true,
  role: 'teacher', gateway: false,
};

const cases = [
  ['own local draft on desktop', { storageState: 'local_draft', sourceDeviceId: 'client-1', deviceId: 'client-1', ownerUserId: 'u1', userId: 'u1', userApproved: true }, true],
  ['trusted primary host teacher', { ...trustedHost, storageState: 'host_committed' }, true],
  ['trusted primary host admin', { ...trustedHost, role: 'admin', storageState: 'host_committed' }, true],
  ['client desktop super admin', { ...trustedHost, runtimeNodeRole: 'desktop-client', role: 'super_admin', storageState: 'host_committed' }, false],
  ['primary host miniapp super admin', { ...trustedHost, tokenUse: 'miniapp-session', role: 'super_admin', storageState: 'host_committed' }, false],
  ['cloud relay', { ...trustedHost, gateway: true, storageState: 'host_committed' }, false],
  ['pending user', { ...trustedHost, role: 'pending', userApproved: false, storageState: 'host_committed' }, false],
  ['student on host desktop', { ...trustedHost, role: 'student', storageState: 'host_committed' }, false],
];

for (const [name, context, expected] of cases) {
  assert.strictEqual(canDeleteQuestion(context), expected, name);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-delete-policy-'));
const previous = { DB_PATH: process.env.DB_PATH, READ_DB_PATH: process.env.READ_DB_PATH };
process.env.DB_PATH = path.join(dir, 'test.db');
process.env.READ_DB_PATH = process.env.DB_PATH;
const service = new DatabaseService();
try {
  const columns = service.db.prepare('PRAGMA table_info(questions)').all().map(row => row.name);
  for (const name of ['storage_state', 'committed_at', 'committed_by_device_id']) assert.ok(columns.includes(name), `missing ${name}`);
  const created = questionBank.createQuestion(service.db, { stem: 'committed', type: 'fill', storage_state: 'host_committed' });
  assert.throws(() => questionBank.deleteQuestion(service.db, created.id, 'default'), error => error.code === 'HOST_DESKTOP_REQUIRED_FOR_COMMITTED_DELETE');
  assert.ok(questionBank.getQuestion(service.db, created.id, 'default'), 'denied deletion must not mutate row');
  assert.strictEqual(questionBank.deleteQuestion(service.db, created.id, 'default', trustedHost), true);
} finally {
  service.close();
  for (const [key, value] of Object.entries(previous)) value === undefined ? delete process.env[key] : process.env[key] = value;
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('questionDeletionPolicy tests passed');
