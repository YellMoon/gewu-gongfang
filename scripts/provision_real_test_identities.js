'use strict';

// Runs inside the cloud-business-api container.  It provisions only clearly
// marked, non-personal test identities through the deployed account and role
// model; it deliberately prints no credentials or signing material.
const crypto = require('crypto');
const { Pool } = require('pg');

const MARKER = /^e2e-role-test-[a-z0-9-]{12,64}$/u;

function fail(code) {
  return Object.assign(new Error(code), { code });
}

function required(value, code) {
  if (typeof value !== 'string' || value.trim() !== value || !value) throw fail(code);
  return value;
}

function fixtureId(prefix, marker) {
  return `${prefix}-${marker}`;
}

function poolConfig(env, user, password) {
  return {
    host: env.POSTGRES_HOST || 'gewu-postgres17',
    port: Number(env.POSTGRES_PORT || 5432),
    database: env.POSTGRES_DB || 'gewu_cloud',
    user,
    password,
    max: 1,
    connectionTimeoutMillis: 5000,
  };
}

function roleSpecs(marker) {
  return Object.freeze([
    Object.freeze({ key: 'visitor', accountId: fixtureId('e2e-account-visitor', marker), role: null, profileId: null, relationship: null }),
    Object.freeze({ key: 'teacher', accountId: fixtureId('e2e-account-teacher', marker), role: 'teacher', profileId: fixtureId('e2e-teacher', marker), relationship: null }),
    Object.freeze({ key: 'student', accountId: fixtureId('e2e-account-student', marker), role: 'student', profileId: fixtureId('e2e-student', marker), relationship: 'student' }),
    Object.freeze({ key: 'family', accountId: fixtureId('e2e-account-family', marker), role: 'student', profileId: fixtureId('e2e-student', marker), relationship: 'guardian' }),
  ]);
}

function hmacPhone(pepper, marker, key) {
  return crypto.createHmac('sha256', pepper).update(`e2e-role-test:${marker}:${key}`, 'utf8').digest('hex');
}

async function provisionCanonical(identityPool, spec, phoneHash, marker) {
  const result = await identityPool.query(
    'SELECT authority_id AS "authorityId", account_id AS "accountId" FROM vnext_control_plane.vnext_provision_canonical_phone_account($1,$2,$3,$4)',
    [spec.accountId, fixtureId(`e2e-contact-${spec.key}`, marker), phoneHash, crypto.createHash('sha256').update(`e2e-evidence:${marker}:${spec.key}`, 'utf8').digest('hex')],
  );
  const row = result.rows[0];
  if (!row || row.accountId !== spec.accountId || typeof row.authorityId !== 'string' || !row.authorityId) throw fail('REAL_TEST_IDENTITY_CANONICAL_PROVISION_FAILED');
  return row;
}

async function provisionBusinessProfiles(writerPool, appPool, tenantId, marker, specs, phoneHashes) {
  const teacher = specs.find(spec => spec.key === 'teacher');
  const student = specs.find(spec => spec.key === 'student');
  await writerPool.query(
    'SELECT * FROM business.vnext_self_register_teacher_v1($1,$2,$3,$4,$5,$6)',
    [tenantId, teacher.accountId, phoneHashes.teacher, teacher.profileId, `测试教师 ${marker}`, 'physics'],
  );
  await writerPool.query(
    'SELECT * FROM business.vnext_create_student_record_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)',
    [tenantId, student.profileId, `测试学生 ${marker}`, null, null, null, null, null, 'controlled e2e identity', 1, 'e2e', null, '[]'],
  );
  for (const spec of specs.filter(item => item.key !== 'teacher')) {
    await appPool.query(
      `INSERT INTO business.miniapp_cloud_accounts(account_id,phone_hmac,status)
       VALUES($1,$2,'active')
       ON CONFLICT (account_id) DO UPDATE SET phone_hmac=EXCLUDED.phone_hmac,status='active',updated_at=transaction_timestamp()`,
      [spec.accountId, phoneHashes[spec.key]],
    );
  }
  for (const spec of specs.filter(item => item.role === 'student')) {
    await appPool.query(
      `INSERT INTO business.miniapp_cloud_role_grants(account_id,role,status,profile_type,profile_id,student_relationship)
       VALUES($1,'student','active','student',$2,$3)
       ON CONFLICT (account_id,role) DO UPDATE SET status='active',profile_type='student',profile_id=EXCLUDED.profile_id,student_relationship=EXCLUDED.student_relationship,updated_at=transaction_timestamp()`,
      [spec.accountId, spec.profileId, spec.relationship],
    );
  }
}

async function verify(appPool, specs) {
  const identities = {};
  for (const spec of specs) {
    const result = await appPool.query(
      `SELECT a.account_id AS "accountId",a.status,
        COALESCE(array_agg(g.role ORDER BY g.role) FILTER (WHERE g.status='active'), ARRAY[]::text[]) AS roles,
        MAX(g.profile_id) FILTER (WHERE g.status='active') AS "profileId",
        MAX(g.student_relationship) FILTER (WHERE g.status='active') AS relationship
       FROM business.miniapp_cloud_accounts a
       LEFT JOIN business.miniapp_cloud_role_grants g ON g.account_id=a.account_id
       WHERE a.account_id=$1 GROUP BY a.account_id,a.status`, [spec.accountId],
    );
    const row = result.rows[0];
    if (!row || row.status !== 'active' || JSON.stringify(row.roles) !== JSON.stringify(spec.role ? [spec.role] : [])
      || row.profileId !== spec.profileId || row.relationship !== spec.relationship) {
      throw fail('REAL_TEST_IDENTITY_ROLE_VERIFICATION_FAILED');
    }
    identities[spec.key] = Object.freeze({ accountId: spec.accountId, roles: row.roles, profileId: row.profileId, relationship: row.relationship });
  }
  return Object.freeze(identities);
}

async function main(env = process.env) {
  const marker = required(env.GEWU_REAL_TEST_IDENTITY_MARKER || `e2e-role-test-${crypto.randomUUID().replace(/-/g, '')}`, 'REAL_TEST_IDENTITY_MARKER_INVALID');
  if (!MARKER.test(marker)) throw fail('REAL_TEST_IDENTITY_MARKER_INVALID');
  const pepper = required(env.CLOUD_IDENTITY_PHONE_PEPPER, 'REAL_TEST_IDENTITY_CONFIG_INVALID');
  const identityPassword = required(env.IDENTITY_VERIFIER_POSTGRES_PASSWORD, 'REAL_TEST_IDENTITY_CONFIG_INVALID');
  const writerPassword = required(env.COMMAND_WRITER_POSTGRES_PASSWORD, 'REAL_TEST_IDENTITY_CONFIG_INVALID');
  const appPassword = required(env.POSTGRES_PASSWORD, 'REAL_TEST_IDENTITY_CONFIG_INVALID');
  const tenantId = required(env.CLOUD_BUSINESS_TENANT_ID || 'default', 'REAL_TEST_IDENTITY_CONFIG_INVALID');
  const appUser = required(env.POSTGRES_USER || 'gewu_cloud_schedule_reader', 'REAL_TEST_IDENTITY_CONFIG_INVALID');
  const specs = roleSpecs(marker);
  const phoneHashes = Object.fromEntries(specs.map(spec => [spec.key, hmacPhone(pepper, marker, spec.key)]));
  const identityPool = new Pool(poolConfig(env, 'vnext_pg17_identity_verifier', identityPassword));
  const writerPool = new Pool(poolConfig(env, 'vnext_pg17_writer', writerPassword));
  const appPool = new Pool(poolConfig(env, appUser, appPassword));
  try {
    for (const spec of specs) await provisionCanonical(identityPool, spec, phoneHashes[spec.key], marker);
    await provisionBusinessProfiles(writerPool, appPool, tenantId, marker, specs, phoneHashes);
    const identities = await verify(appPool, specs);
    process.stdout.write(`${JSON.stringify({ ok: true, marker, identities })}\n`);
  } finally {
    await Promise.all([identityPool.end(), writerPool.end(), appPool.end()]);
  }
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${error.code || error.message || error}\n`);
    process.exitCode = 1;
  });
}

module.exports = Object.freeze({ MARKER, roleSpecs, hmacPhone, main });
