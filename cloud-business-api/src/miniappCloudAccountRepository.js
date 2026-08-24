'use strict';

const { types } = require('util');

function invalid() {
  return Object.assign(new Error('miniapp cloud account repository input is invalid'), { code: 'CLOUD_MINIAPP_IDENTITY_INVALID' });
}

function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) throw invalid();
  if (Reflect.ownKeys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw invalid();
  const copy = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw invalid();
    copy[key] = descriptor.value;
  }
  return copy;
}

function accountRow(row) {
  if (!row || typeof row.accountId !== 'string' || !row.accountId || !['active', 'disabled'].includes(row.status) || !Array.isArray(row.roles)) throw invalid();
  const ordinary = row.roles.filter(role => role === 'teacher' || role === 'student');
  if (ordinary.length > 1 || (ordinary.length === 0 && (row.profileType !== null || row.profileId !== null))) throw invalid();
  if (ordinary.length === 1) {
    if (row.profileType !== ordinary[0] || typeof row.profileId !== 'string' || !row.profileId) throw invalid();
    return { accountId: row.accountId, status: row.status, roles: row.roles.slice(), profile: { type: row.profileType, id: row.profileId } };
  }
  return { accountId: row.accountId, status: row.status, roles: row.roles.slice(), profile: null };
}

function grantRole(value) {
  return typeof value === 'string' && ['admin', 'teacher', 'student'].includes(value) ? value : null;
}

function createMiniappCloudAccountRepository({ query, tenantId }) {
  if (typeof query !== 'function' || typeof tenantId !== 'string' || !tenantId || tenantId !== tenantId.trim()) throw invalid();
  return Object.freeze({
    async resolveOrCreate(input) {
      const request = exact(input, ['accountId', 'phoneHmac', 'bootstrapAdmin']);
      if (typeof request.accountId !== 'string' || !request.accountId || !/^[0-9a-f]{64}$/u.test(request.phoneHmac) || typeof request.bootstrapAdmin !== 'boolean') throw invalid();
      const result = await query(
        `WITH selected AS (
           INSERT INTO business.miniapp_cloud_accounts (account_id, phone_hmac, status)
           VALUES ($1,$2,'active')
           ON CONFLICT (phone_hmac) DO UPDATE SET phone_hmac=EXCLUDED.phone_hmac
           RETURNING account_id,status
         ), bootstrap AS (
           INSERT INTO business.miniapp_cloud_role_grants (account_id, role, status)
           SELECT account_id,'super_admin','active' FROM selected WHERE $3::boolean
           ON CONFLICT (account_id,role) DO NOTHING
         )
         SELECT s.account_id AS "accountId",s.status AS "status",
           COALESCE(array_agg(g.role ORDER BY g.role) FILTER (WHERE g.status='active'), ARRAY[]::text[]) AS "roles",
           MAX(g.profile_type) FILTER (WHERE g.status='active') AS "profileType",
           MAX(g.profile_id) FILTER (WHERE g.status='active') AS "profileId"
         FROM selected s
         LEFT JOIN business.miniapp_cloud_role_grants g ON g.account_id=s.account_id
         GROUP BY s.account_id,s.status`,
        [request.accountId, request.phoneHmac, request.bootstrapAdmin],
      );
      return accountRow(result.rows[0]);
    },
    async readContext(input) {
      const request = exact(input, ['accountId']);
      if (typeof request.accountId !== 'string' || !request.accountId) throw invalid();
      const result = await query(
        `SELECT a.account_id AS "accountId",a.status AS "status",
           COALESCE(array_agg(g.role ORDER BY g.role) FILTER (WHERE g.status='active'), ARRAY[]::text[]) AS "roles",
           MAX(g.profile_type) FILTER (WHERE g.status='active') AS "profileType",
           MAX(g.profile_id) FILTER (WHERE g.status='active') AS "profileId"
         FROM business.miniapp_cloud_accounts a
         LEFT JOIN business.miniapp_cloud_role_grants g ON g.account_id=a.account_id
         WHERE a.account_id=$1
         GROUP BY a.account_id,a.status`,
        [request.accountId],
      );
      return result.rows[0] ? accountRow(result.rows[0]) : null;
    },
    async readContextByPhoneHmac(input) {
      const request = exact(input, ['phoneHmac']);
      if (typeof request.phoneHmac !== 'string' || !/^[0-9a-f]{64}$/u.test(request.phoneHmac)) throw invalid();
      const result = await query(
        `SELECT a.account_id AS "accountId",a.status AS "status",
           COALESCE(array_agg(g.role ORDER BY g.role) FILTER (WHERE g.status='active'), ARRAY[]::text[]) AS "roles",
           MAX(g.profile_type) FILTER (WHERE g.status='active') AS "profileType",
           MAX(g.profile_id) FILTER (WHERE g.status='active') AS "profileId"
         FROM business.miniapp_cloud_accounts a
         LEFT JOIN business.miniapp_cloud_role_grants g ON g.account_id=a.account_id
         WHERE a.phone_hmac=$1
         GROUP BY a.account_id,a.status`,
        [request.phoneHmac],
      );
      return result.rows[0] ? accountRow(result.rows[0]) : null;
    },
    async listPending() {
      const result = await query(
        `SELECT a.account_id AS "accountId",a.status AS "status",a.created_at AS "createdAt"
         FROM business.miniapp_cloud_accounts a
         WHERE a.status='active'
           AND NOT EXISTS (
             SELECT 1 FROM business.miniapp_cloud_role_grants g
             WHERE g.account_id=a.account_id AND g.status='active'
           )
         ORDER BY a.created_at ASC,a.account_id ASC`,
        [],
      );
      if (!Array.isArray(result.rows) || result.rows.some(row => !row || typeof row.accountId !== 'string' || !row.accountId || row.status !== 'active' || !(row.createdAt instanceof Date))) throw invalid();
      return result.rows.map(row => Object.freeze({ accountId: row.accountId, status: 'pending_authorization', createdAt: row.createdAt.toISOString() }));
    },
    async assignRole(input) {
      const request = exact(input, ['accountId', 'role', 'profileId', 'studentRelationship']);
      const role = grantRole(request.role);
      if (typeof request.accountId !== 'string' || !request.accountId || typeof request.profileId !== 'string' || !request.profileId || !role
        || (role === 'student' && !['student', 'guardian'].includes(request.studentRelationship))
        || (role !== 'student' && request.studentRelationship !== null)) throw invalid();
      const result = await query(
        `WITH target AS (
           SELECT a.account_id,a.status
           FROM business.miniapp_cloud_accounts a
           WHERE a.account_id=$1
           FOR UPDATE
         ), profile AS (
           SELECT id FROM business.teachers WHERE $2='teacher' AND id=$3 AND tenant_id=$5 AND legacy_deleted=false
           UNION ALL
           SELECT id FROM business.students WHERE $2='student' AND id=$3 AND tenant_id=$5 AND legacy_deleted=false
         ), compatible AS (
           SELECT t.account_id
           FROM target t
           WHERE t.status='active'
             AND EXISTS (SELECT 1 FROM profile)
             AND (($2='student' AND $4 IN ('student','guardian')) OR ($2<>'student' AND $4 IS NULL))
             AND NOT EXISTS (
               SELECT 1 FROM business.miniapp_cloud_role_grants g
               WHERE g.account_id=t.account_id AND g.status='active' AND g.role<>$2
             )
         ), activated AS (
           UPDATE business.miniapp_cloud_accounts a
           SET status='active'
           FROM compatible c
           WHERE a.account_id=c.account_id
           RETURNING a.account_id,a.status
         ), granted AS (
           INSERT INTO business.miniapp_cloud_role_grants (account_id,role,status,profile_type,profile_id,student_relationship)
           SELECT account_id,$2,'active',$2,$3,$4::text FROM activated
           ON CONFLICT (account_id,role) DO UPDATE SET status='active',profile_type=EXCLUDED.profile_type,profile_id=EXCLUDED.profile_id,student_relationship=EXCLUDED.student_relationship,updated_at=transaction_timestamp()
           RETURNING account_id
         )
         SELECT a.account_id AS "accountId",a.status AS "status",
           COALESCE(array_agg(g.role ORDER BY g.role) FILTER (WHERE g.status='active'), ARRAY[]::text[]) AS "roles",
           MAX(g.profile_type) FILTER (WHERE g.status='active') AS "profileType",
           MAX(g.profile_id) FILTER (WHERE g.status='active') AS "profileId"
         FROM business.miniapp_cloud_accounts a
         JOIN granted r ON r.account_id=a.account_id
         LEFT JOIN business.miniapp_cloud_role_grants g ON g.account_id=a.account_id
         GROUP BY a.account_id,a.status`,
        [request.accountId, role, request.profileId, request.studentRelationship, tenantId],
      );
      return result.rows[0] ? accountRow(result.rows[0]) : null;
    },
  });
}

module.exports = Object.freeze({ createMiniappCloudAccountRepository });
