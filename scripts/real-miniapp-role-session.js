'use strict';

// This helper runs only inside the cloud-business-api container during local
// developer-tool acceptance. It issues short-lived tickets for the existing
// clearly marked E2E accounts and never persists or logs those tickets itself.
const { Pool } = require('pg');
const fs = require('fs');
const { makeMiniappSessionToken } = require('./real-cloud-business-acceptance');

const ROLE_KEYS = Object.freeze(['visitor', 'teacher', 'student', 'family']);
const MARKER = /^e2e-role-test-[a-z0-9-]{12,64}$/u;

function failure(code) { return Object.assign(new Error(code), { code }); }

function expectedRole(key) {
  if (key === 'visitor') return { roles: [], profileType: null, relationship: null };
  if (key === 'teacher') return { roles: ['teacher'], profileType: 'teacher', relationship: null };
  if (key === 'student') return { roles: ['student'], profileType: 'student', relationship: 'student' };
  if (key === 'family') return { roles: ['student'], profileType: 'student', relationship: 'guardian' };
  throw failure('REAL_MINIAPP_ROLE_SESSION_INPUT_INVALID');
}

function markerFor(accountId, key) {
  const prefix = `e2e-account-${key}-`;
  if (typeof accountId !== 'string' || !accountId.startsWith(prefix)) throw failure('REAL_MINIAPP_ROLE_SESSION_IDENTITY_INVALID');
  const marker = accountId.slice(prefix.length);
  if (!MARKER.test(marker)) throw failure('REAL_MINIAPP_ROLE_SESSION_IDENTITY_INVALID');
  return marker;
}

function validateRow(key, row) {
  const expected = expectedRole(key);
  if (!row || typeof row.accountId !== 'string' || row.status !== 'active' || !Array.isArray(row.roles)
    || JSON.stringify(row.roles) !== JSON.stringify(expected.roles) || row.profileType !== expected.profileType
    || row.relationship !== expected.relationship || (expected.profileType && (typeof row.profileId !== 'string' || !row.profileId))) {
    throw failure('REAL_MINIAPP_ROLE_SESSION_IDENTITY_INVALID');
  }
  return markerFor(row.accountId, key);
}

async function loadRoleSessions({ query, ticketSecret, now = new Date() }) {
  if (typeof query !== 'function' || typeof ticketSecret !== 'string' || ticketSecret.length < 24 || !(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw failure('REAL_MINIAPP_ROLE_SESSION_INPUT_INVALID');
  }
  const sessions = {};
  let marker = null;
  for (const key of ROLE_KEYS) {
    const result = await query(
      `SELECT accounts.account_id AS "accountId", accounts.status,
        COALESCE(array_agg(grants.role ORDER BY grants.role) FILTER (WHERE grants.status='active'), ARRAY[]::text[]) AS roles,
        MAX(grants.profile_type) FILTER (WHERE grants.status='active') AS "profileType",
        MAX(grants.profile_id) FILTER (WHERE grants.status='active') AS "profileId",
        MAX(grants.student_relationship) FILTER (WHERE grants.status='active') AS relationship
       FROM business.miniapp_cloud_accounts accounts
       LEFT JOIN business.miniapp_cloud_role_grants grants ON grants.account_id=accounts.account_id
       WHERE accounts.account_id LIKE $1
       GROUP BY accounts.account_id,accounts.status`,
      [`e2e-account-${key}-e2e-role-test-%`],
    );
    if (!Array.isArray(result?.rows) || result.rows.length !== 1) throw failure('REAL_MINIAPP_ROLE_SESSION_IDENTITY_INVALID');
    const row = result.rows[0];
    const rowMarker = validateRow(key, row);
    if (marker !== null && marker !== rowMarker) throw failure('REAL_MINIAPP_ROLE_SESSION_IDENTITY_INVALID');
    marker = rowMarker;
    sessions[key] = Object.freeze({ accountId: row.accountId, token: makeMiniappSessionToken(ticketSecret, row.accountId, now) });
  }
  return Object.freeze({ ok: true, marker, sessions: Object.freeze(sessions) });
}

async function main(env = process.env) {
  const ticketSecret = String(env.CLOUD_MINIAPP_TICKET_SECRET || '');
  const password = String(env.POSTGRES_PASSWORD || '');
  const user = String(env.POSTGRES_USER || 'gewu_cloud_schedule_reader');
  if (!ticketSecret || !password || !user) throw failure('REAL_MINIAPP_ROLE_SESSION_CONFIG_INVALID');
  const pool = new Pool({
    host: env.POSTGRES_HOST || '127.0.0.1', port: Number(env.POSTGRES_PORT || 5432),
    database: env.POSTGRES_DB || 'gewu_cloud', user, password, max: 1,
  });
  try {
    return await loadRoleSessions({ query: (...args) => pool.query(...args), ticketSecret });
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().then(result => {
    const outputPath = String(process.env.GEWU_REAL_MINIAPP_ROLE_SESSION_OUTPUT_PATH || '');
    if (outputPath) {
      if (!/^\/tmp\/gewu-real-miniapp-role-session-[a-f0-9]{24}\/sessions\.json$/u.test(outputPath)) throw failure('REAL_MINIAPP_ROLE_SESSION_OUTPUT_INVALID');
      fs.writeFileSync(outputPath, `${JSON.stringify(result)}\n`, { encoding: 'utf8', mode: 0o600 });
      process.stdout.write(`${JSON.stringify({ ok: true, marker: result.marker, sessionKeys: Object.keys(result.sessions) })}\n`);
      return;
    }
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }).catch(error => {
    process.stderr.write(`${error.code || error.message || error}\n`);
    process.exitCode = 1;
  });
}

module.exports = Object.freeze({ ROLE_KEYS, MARKER, expectedRole, markerFor, validateRow, loadRoleSessions, main });
