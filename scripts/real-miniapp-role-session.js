'use strict';

// This helper runs only inside the cloud-business-api container during local
// developer-tool acceptance. It issues short-lived tickets for the one formal
// super admin and the clearly marked E2E accounts, and never logs tickets.
const { Pool } = require('pg');
const fs = require('fs');
const { makeMiniappSessionToken } = require('./real-cloud-business-acceptance');

const ROLE_KEYS = Object.freeze(['super_admin', 'visitor', 'teacher', 'student', 'family']);
const E2E_ROLE_KEYS = Object.freeze(ROLE_KEYS.filter(key => key !== 'super_admin'));
const MARKER = /^e2e-role-test-[a-z0-9-]{12,64}$/u;

function failure(code) { return Object.assign(new Error(code), { code }); }

function expectedRole(key) {
  if (key === 'super_admin') return { roles: ['super_admin'], profileType: null, relationship: null };
  if (key === 'visitor') return { roles: [], profileType: null, relationship: null };
  if (key === 'teacher') return { roles: ['teacher'], profileType: 'teacher', relationship: null };
  if (key === 'student') return { roles: ['student'], profileType: 'student', relationship: 'student' };
  if (key === 'family') return { roles: ['family_member'], profileType: 'student', relationship: 'guardian' };
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
  if (!row || typeof row.accountId !== 'string' || !row.accountId || row.accountId !== row.accountId.trim() || row.accountId.length > 512
    || row.status !== 'active' || !Array.isArray(row.roles)
    || JSON.stringify(row.roles) !== JSON.stringify(expected.roles) || row.profileType !== expected.profileType
    || row.relationship !== expected.relationship || (expected.profileType && (typeof row.profileId !== 'string' || !row.profileId))
    || (!expected.profileType && row.profileId !== null)) {
    throw failure('REAL_MINIAPP_ROLE_SESSION_IDENTITY_INVALID');
  }
  if (key === 'super_admin') return null;
  return markerFor(row.accountId, key);
}

async function loadRoleSessions({ query, ticketSecret, now = new Date() }) {
  if (typeof query !== 'function' || typeof ticketSecret !== 'string' || ticketSecret.length < 24 || !(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw failure('REAL_MINIAPP_ROLE_SESSION_INPUT_INVALID');
  }
  const adminResult = await query(
    `SELECT accounts.account_id AS "accountId", accounts.status,
      COALESCE(array_agg(grants.role ORDER BY grants.role) FILTER (WHERE grants.status='active'), ARRAY[]::text[]) AS roles,
      MAX(grants.profile_type) FILTER (WHERE grants.status='active') AS "profileType",
      MAX(grants.profile_id) FILTER (WHERE grants.status='active') AS "profileId",
      MAX(grants.student_relationship) FILTER (WHERE grants.status='active') AS relationship,
      MAX(accounts.updated_at) AS "updatedAt"
     FROM business.miniapp_cloud_accounts accounts
     LEFT JOIN business.miniapp_cloud_role_grants grants ON grants.account_id=accounts.account_id
     WHERE EXISTS (
       SELECT 1 FROM business.miniapp_cloud_role_grants admin_grant
       WHERE admin_grant.account_id=accounts.account_id AND admin_grant.role='super_admin' AND admin_grant.status='active'
     )
     GROUP BY accounts.account_id,accounts.status`,
    [],
  );
  if (!Array.isArray(adminResult?.rows)) throw failure('REAL_MINIAPP_ROLE_SESSION_IDENTITY_INVALID');
  const adminCandidates = adminResult.rows.filter(row => {
    try {
      validateRow('super_admin', row);
      return true;
    } catch (error) {
      if (error?.code === 'REAL_MINIAPP_ROLE_SESSION_IDENTITY_INVALID') return false;
      throw error;
    }
  });
  if (adminCandidates.length !== 1) throw failure('REAL_MINIAPP_ROLE_SESSION_IDENTITY_INVALID');
  const candidatesByRole = {};
  for (const key of E2E_ROLE_KEYS) {
    const result = await query(
      `SELECT accounts.account_id AS "accountId", accounts.status,
        COALESCE(array_agg(grants.role ORDER BY grants.role) FILTER (WHERE grants.status='active'), ARRAY[]::text[]) AS roles,
        MAX(grants.profile_type) FILTER (WHERE grants.status='active') AS "profileType",
        MAX(grants.profile_id) FILTER (WHERE grants.status='active') AS "profileId",
        MAX(grants.student_relationship) FILTER (WHERE grants.status='active') AS relationship,
        MAX(accounts.updated_at) AS "updatedAt"
       FROM business.miniapp_cloud_accounts accounts
       LEFT JOIN business.miniapp_cloud_role_grants grants ON grants.account_id=accounts.account_id
       WHERE accounts.account_id LIKE $1
       GROUP BY accounts.account_id,accounts.status`,
      [`e2e-account-${key}-e2e-role-test-%`],
    );
    if (!Array.isArray(result?.rows)) throw failure('REAL_MINIAPP_ROLE_SESSION_IDENTITY_INVALID');
    candidatesByRole[key] = result.rows.flatMap(row => {
      try {
        const rowMarker = validateRow(key, row);
        const updatedAt = Date.parse(row.updatedAt);
        if (!Number.isFinite(updatedAt)) return [];
        return [{ marker: rowMarker, row, updatedAt }];
      } catch (error) {
        if (error?.code === 'REAL_MINIAPP_ROLE_SESSION_IDENTITY_INVALID') return [];
        throw error;
      }
    });
    if (candidatesByRole[key].length === 0) throw failure('REAL_MINIAPP_ROLE_SESSION_IDENTITY_INVALID');
  }
  const commonMarkers = candidatesByRole.visitor
    .map(candidate => candidate.marker)
    .filter(candidateMarker => E2E_ROLE_KEYS.every(key => candidatesByRole[key].some(candidate => candidate.marker === candidateMarker)));
  const rankedMarkers = [...new Set(commonMarkers)].map(candidateMarker => ({
    marker: candidateMarker,
    updatedAt: Math.min(...E2E_ROLE_KEYS.map(key => candidatesByRole[key].find(candidate => candidate.marker === candidateMarker).updatedAt)),
  })).sort((left, right) => right.updatedAt - left.updatedAt || left.marker.localeCompare(right.marker));
  if (rankedMarkers.length === 0) throw failure('REAL_MINIAPP_ROLE_SESSION_IDENTITY_INVALID');
  const marker = rankedMarkers[0].marker;
  const selected = {
    super_admin: adminCandidates[0],
    ...Object.fromEntries(E2E_ROLE_KEYS.map(key => [key, candidatesByRole[key].find(candidate => candidate.marker === marker).row])),
  };
  if (selected.student.profileId !== selected.family.profileId) throw failure('REAL_MINIAPP_ROLE_SESSION_IDENTITY_INVALID');
  const sessions = Object.fromEntries(ROLE_KEYS.map(key => [key, Object.freeze({
    accountId: selected[key].accountId,
    token: makeMiniappSessionToken(ticketSecret, selected[key].accountId, now),
  })]));
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

function writeRoleSessionResult(result, env = process.env, {
  writeFileSync = fs.writeFileSync,
  stdout = process.stdout,
} = {}) {
  const outputPath = String(env.GEWU_REAL_MINIAPP_ROLE_SESSION_OUTPUT_PATH || '');
  if (!outputPath) throw failure('REAL_MINIAPP_ROLE_SESSION_OUTPUT_REQUIRED');
  if (!/^\/tmp\/gewu-real-miniapp-role-session-[a-f0-9]{24}\/sessions\.json$/u.test(outputPath)) {
    throw failure('REAL_MINIAPP_ROLE_SESSION_OUTPUT_INVALID');
  }
  writeFileSync(outputPath, `${JSON.stringify(result)}\n`, { encoding: 'utf8', mode: 0o600 });
  stdout.write(`${JSON.stringify({
    ok: true,
    marker: result.marker,
    sessionKeys: Object.keys(result.sessions),
  })}\n`);
}

if (require.main === module) {
  main().then(result => writeRoleSessionResult(result)).catch(error => {
    process.stderr.write(`${error.code || error.message || error}\n`);
    process.exitCode = 1;
  });
}

module.exports = Object.freeze({
  ROLE_KEYS,
  MARKER,
  expectedRole,
  markerFor,
  validateRow,
  loadRoleSessions,
  main,
  writeRoleSessionResult,
});
