'use strict';

// Prepares a disposable primary-host profile for manual packaged-Electron checks.
// It deliberately refuses normal user profiles and never operates on a configured store.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const {
  bindQuestionBankStoreToDatabase,
  initQuestionBankStore,
} = require('../backend/src/services/questionBankStorageService');
const { CANONICAL_SUPER_ADMIN_ID } = require('../backend/src/services/authorizationPolicy');

function isDisposableProfile(root, config) {
  return path.basename(root).startsWith('tmp-real-desktop-')
    && String(config.deviceId || '').startsWith('real_e2e_');
}

function main() {
  const configPath = path.resolve(process.argv[2] || '');
  assert(configPath && path.basename(configPath) === 'gewugongfang.config.json', 'TEST_CONFIG_PATH_REQUIRED');
  assert(fs.existsSync(configPath), 'TEST_CONFIG_NOT_FOUND');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const profileRoot = path.dirname(configPath);
  assert(isDisposableProfile(profileRoot, config), 'DISPOSABLE_TEST_PROFILE_REQUIRED');
  assert(config.nodeRole === 'primary-host', 'PRIMARY_HOST_TEST_PROFILE_REQUIRED');
  const dbPath = path.resolve(String(config.mainDbPath || ''));
  assert(dbPath && fs.existsSync(dbPath), 'TEST_DATABASE_NOT_FOUND');

  const db = new Database(dbPath);
  try {
    assert.strictEqual(
      db.prepare("SELECT COUNT(*) AS count FROM authority_metadata WHERE key='database_authority_id'").get().count,
      0,
      'TEST_DATABASE_ALREADY_HAS_AUTHORITY'
    );
    assert.strictEqual(
      db.prepare("SELECT COUNT(*) AS count FROM question_bank_store_bindings WHERE status='active'").get().count,
      0,
      'TEST_DATABASE_ALREADY_HAS_QUESTION_BANK_BINDING'
    );
    const owner = db.prepare('SELECT id FROM users WHERE id=? AND deleted=0').get(CANONICAL_SUPER_ADMIN_ID);
    assert(owner, 'TEST_CANONICAL_OWNER_REQUIRED');

    const root = path.join(profileRoot, 'question-bank');
    const manifest = initQuestionBankStore(root, { deviceId: config.deviceId });
    const authz = {
      role: 'super_admin',
      userId: owner.id,
      deviceTrusted: true,
      deviceActive: true,
      deviceOwnerUserId: owner.id,
      userApproved: true,
      isPrimaryHost: true,
    };
    const runtime = {
      nodeRole: 'primary-host',
      clientType: 'desktop',
      tokenUse: 'desktop-session',
      deviceId: config.deviceId,
      tokenDeviceId: config.deviceId,
    };
    const binding = bindQuestionBankStoreToDatabase({ db, root, authz, runtime });
    const nextConfig = {
      ...config,
      questionBankPath: root,
      questionAssetPath: path.join(root, 'assets'),
      questionBankCandidatePaths: [root],
      questionBankStoreId: binding.storeId || manifest.storeId,
    };
    fs.writeFileSync(configPath, JSON.stringify(nextConfig, null, 2), 'utf8');
    console.log(JSON.stringify({
      prepared: true,
      profile: path.basename(profileRoot),
      storeId: nextConfig.questionBankStoreId,
      hasBinding: true,
    }));
  } finally {
    db.close();
  }
}

main();
