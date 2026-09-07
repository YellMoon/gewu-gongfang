'use strict';
// Test-process-only entry: no production endpoint or authentication changes.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Pool } = require('pg');
let stage = 'input';

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const config = JSON.parse(input); input = '';
  assert.match(config.env.POSTGRES_DB, /^gewu_ui_shadow_[a-f0-9]{16}$/);
  assert.equal(config.env.CLOUD_PAPER_EXPORT_WORKER_ENABLED, '0');
  Object.assign(process.env, config.env);
  const pool = new Pool({host: process.env.POSTGRES_HOST, database: process.env.POSTGRES_DB,
    user: 'vnext_pg17_identity_verifier', password: process.env.IDENTITY_VERIFIER_POSTGRES_PASSWORD});
  const reader = new Pool({host: process.env.POSTGRES_HOST, database: process.env.POSTGRES_DB,
    user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD});
  let login;
  try {
    stage = 'database_guard';
    assert.equal((await reader.query('SELECT current_database() AS name')).rows[0].name, process.env.POSTGRES_DB);
    // Only an existing, explicitly marked test teacher in the restored backup.
    stage = 'test_teacher_read';
    const row = (await reader.query(`SELECT a.account_id, g.profile_id
      FROM business.miniapp_cloud_accounts a JOIN business.miniapp_cloud_role_grants g USING(account_id)
      WHERE a.account_id=$1 AND a.status='active' AND g.role='teacher' AND g.status='active'`,
      ['e2e-account-teacher-e2e-role-test-0f0cc7fdd4e0476f99166b8fd9cfca8f'])).rows;
    assert.equal(row.length, 1, 'isolated test teacher missing');
    const authorities = [...new Set(JSON.parse(process.env.CLOUD_OPERATOR_PHONE_HMACS).map(r => r.authorityId))];
    assert.equal(authorities.length, 1);
    const password = crypto.randomBytes(24).toString('base64url');
    const name = 'parity.' + crypto.randomBytes(8).toString('hex');
    const service = require('/shadow/src/desktopPasswordIdentityService').createDesktopPasswordIdentityService({
      phoneHash: () => { throw new Error('phone not used'); }, randomBytes: crypto.randomBytes,
      lookupByPhoneHash: async () => null, lookupByLoginName: async () => null,
      saveCredential: async c => pool.query('SELECT * FROM vnext_control_plane.vnext_set_desktop_password_credential($1,$2,$3,$4,$5,$6)',
        [c.authorityId,c.accountId,c.loginName,c.algorithm,c.saltB64,c.passwordHashB64]),
    });
    stage = 'test_password_enrollment';
    await service.enrollVerifiedAccount({authorityId:authorities[0], accountId:row[0].account_id,
      phoneHash:null, loginName:name, password});
    login = {login:name,password,teacherId:row[0].profile_id};
  } finally { await Promise.all([pool.end(), reader.end()]); }
  const { verifyFixedSuperAdminFromEnvironment } = require('/shadow/scripts/verifyFixedSuperAdmin');
  stage = 'startup_verification';
  await verifyFixedSuperAdminFromEnvironment();
  require('/shadow/src/startupVerificationState').markFixedSuperAdminVerified();
  stage = 'server_start';
  require('/shadow/server');
  // Private SSH stdout only. Orchestrator never persists or prints this line.
  process.stdout.write(JSON.stringify({shadowLogin:login}) + '\n');
}
main().catch(error => { console.error(JSON.stringify({stage, code:error.code || 'SHADOW_BOOTSTRAP_FAILED'})); process.exit(1); });
