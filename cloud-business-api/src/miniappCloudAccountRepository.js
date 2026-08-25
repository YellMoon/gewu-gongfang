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
  });
}

module.exports = Object.freeze({ createMiniappCloudAccountRepository });
