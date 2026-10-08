'use strict';

const { types } = require('node:util');
const { desktopDisplayName } = require('./desktopAccountDisplayName');

function failure(code) { return Object.assign(new Error(code), { code }); }
function nonBlank(value) { return typeof value === 'string' && value.length > 0 && value === value.trim(); }
function displayText(value, maximum) {
  if (typeof value !== 'string') return null;
  const result = value.trim();
  return result && result.length <= maximum && !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(result) ? result : null;
}
function exactInput(input, keys) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || types.isProxy(input)
    || Object.getPrototypeOf(input) !== Object.prototype || Reflect.ownKeys(input).length !== keys.length
    || keys.some(key => !Object.hasOwn(input, key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(input, key), 'value'))) {
    throw failure('DESKTOP_IDENTITY_INPUT_FORBIDDEN');
  }
  if (keys.some(key => !nonBlank(input[key]))) throw failure('DESKTOP_PROFILE_INPUT_INVALID');
  return input;
}
function singleRow(result) {
  if (!result || !Array.isArray(result.rows) || result.rows.length > 1) throw failure('DESKTOP_PROFILE_SOURCE_INVALID');
  return result.rows[0] || null;
}

function createDesktopAccountProfileReader({ canonicalQuery, identityQuery, businessQuery, tenantId } = {}) {
  if ([canonicalQuery, identityQuery, businessQuery].some(query => typeof query !== 'function') || !nonBlank(tenantId)) throw new TypeError('desktop profile reader configuration is invalid');
  return Object.freeze({
    async readAccountName(input) {
      const { authorityId, accountId } = exactInput(input, ['authorityId', 'accountId']);
      // Writer SELECT grants cover contacts/accounts. Password tables remain inaccessible;
      // only the existing identity-verifier function is used, projecting public login metadata.
      const contact = singleRow(await canonicalQuery(
        `SELECT v.normalized_value_hash AS "phoneHmac"
         FROM vnext_control_plane.vnext_verified_contacts v
         JOIN vnext_control_plane.vnext_accounts a ON a.authority_id=v.authority_id AND a.account_id=v.account_id
         JOIN vnext_control_plane.vnext_authorities au ON au.authority_id=a.authority_id AND au.status='active'
         WHERE v.authority_id=$1 AND v.account_id=$2 AND a.status='active'
           AND v.contact_type='phone' AND v.verification_state='verified'
           AND v.verified_at IS NOT NULL AND v.revoked_at IS NULL LIMIT 2`,
        [authorityId, accountId],
      ));
      if (!contact) return null;
      if (!/^[0-9a-f]{64}$/u.test(contact.phoneHmac)) throw failure('DESKTOP_PROFILE_SOURCE_INVALID');
      const credential = singleRow(await identityQuery(
        `SELECT login_name AS "loginName" FROM vnext_control_plane.vnext_read_desktop_password_by_phone_hash($1)
         WHERE authority_id=$2 AND account_id=$3 LIMIT 2`,
        [contact.phoneHmac, authorityId, accountId],
      ));
      if (!credential || credential.loginName === null) return null;
      if (typeof credential.loginName !== 'string' || !/^[A-Za-z][A-Za-z0-9._-]{2,63}$/u.test(credential.loginName)) throw failure('DESKTOP_PROFILE_SOURCE_INVALID');
      return credential.loginName;
    },
    async readTeacher(input) {
      const { teacherId } = exactInput(input, ['teacherId']);
      // teacherId is derived from authenticated sessionContext's resolved business profile,
      // including canonical accounts merged by verified phone; never a caller-supplied ID.
      return singleRow(await businessQuery(
        `SELECT name, phone_legacy AS phone, subject FROM business.teachers
         WHERE tenant_id=$1 AND id=$2 AND NOT legacy_deleted LIMIT 2`,
        [tenantId, teacherId],
      ));
    },
  });
}

function createDesktopAccountProfileService({ sessionContext, readAccountName, readTeacher } = {}) {
  if ([sessionContext, readAccountName, readTeacher].some(read => typeof read !== 'function')) throw new TypeError('desktop profile service configuration is invalid');
  return Object.freeze({
    async read(input) {
      const { sessionToken } = exactInput(input, ['sessionToken']);
      // This validates signed expiry, revocation, device/link state and current role grants.
      const context = await sessionContext({ sessionToken });
      if (!context || !nonBlank(context.authorityId) || !nonBlank(context.accountId)
        || !Array.isArray(context.roles) || context.roles.length === 0 || context.roles.length > 2
        || context.roles.some(role => !['teacher', 'super_admin'].includes(role))
        || new Set(context.roles).size !== context.roles.length || !context.roles.includes(context.activeRole)) throw failure('CLOUD_ONLINE_IDENTITY_REJECTED');
      const accountName = await readAccountName({ authorityId: context.authorityId, accountId: context.accountId });
      if (accountName !== null && (typeof accountName !== 'string' || !/^[A-Za-z][A-Za-z0-9._-]{2,63}$/u.test(accountName))) throw failure('DESKTOP_PROFILE_SOURCE_INVALID');
      const teacher = context.roles.includes('teacher') && nonBlank(context.teacherId)
        ? await readTeacher({ teacherId: context.teacherId }) : null;
      return Object.freeze({
        accountName,
        name: desktopDisplayName(teacher?.name),
        phone: displayText(teacher?.phone, 64),
        subject: displayText(teacher?.subject, 256),
        // No teacher own-handle source exists. OpenID/UnionID and guardian handles
        // cannot represent this account's personal WeChat handle or a binding claim.
        wechat: null,
        activeRole: context.activeRole,
        eligibleRoles: Object.freeze(context.roles.slice()),
      });
    },
  });
}

module.exports = Object.freeze({ createDesktopAccountProfileService, createDesktopAccountProfileReader });
