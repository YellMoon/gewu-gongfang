'use strict';
// UTF-8: presentation only; identity and role decisions remain in their existing services.
function desktopDisplayName(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name && name.length <= 120 && !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(name) ? name : null;
}

function createDesktopAccountDisplayNameReader({ query, tenantId } = {}) {
  if (typeof query !== 'function' || typeof tenantId !== 'string' || !tenantId.trim()) throw new TypeError('desktop display name reader configuration is invalid');
  return async function readDesktopDisplayName(account) {
    if (account?.status !== 'active' || !account.roles?.includes('teacher')
      || account.profile?.type !== 'teacher' || !account.profile.id || !account.accountId) return null;
    const result = await query(
      `SELECT t.name FROM business.miniapp_cloud_role_grants g
       JOIN business.teachers t ON t.id=g.profile_id
       WHERE g.account_id=$1 AND t.tenant_id=$2 AND t.id=$3
         AND g.status='active' AND g.role='teacher' AND g.profile_type='teacher'
         AND NOT t.legacy_deleted`,
      [account.accountId, tenantId, account.profile.id],
    );
    return result?.rows?.length === 1 ? desktopDisplayName(result.rows[0].name) : null;
  };
}

module.exports = Object.freeze({ createDesktopAccountDisplayNameReader, desktopDisplayName });
