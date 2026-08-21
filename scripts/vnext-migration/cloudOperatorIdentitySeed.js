'use strict';

const crypto = require('crypto');

function invalid() {
  return Object.assign(new Error('cloud operator identity input is invalid'), { code: 'VNEXT_CLOUD_OPERATOR_IDENTITY_INVALID' });
}

function text(value) {
  if (typeof value !== 'string' || value.trim() !== value || value === '') throw invalid();
  return `'${value.replace(/'/gu, "''")}'`;
}

function opaqueId(kind, legacyId) {
  return `legacy-${kind}-${crypto.createHash('sha256').update(`v1:${kind}:${legacyId}`, 'utf8').digest('hex').slice(0, 32)}`;
}

function buildCloudOperatorIdentitySeedSql(input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.operators)) throw invalid();
  const authorityId = text(input.authorityId);
  const ids = new Set();
  const operators = input.operators.map(operator => {
    if (!operator || typeof operator !== 'object' || (operator.role !== 'admin' && operator.role !== 'super_admin')) throw invalid();
    if (ids.has(operator.id)) throw invalid();
    ids.add(operator.id);
    if (typeof operator.id !== 'string' || operator.id.trim() !== operator.id || operator.id === '') throw invalid();
    return Object.freeze({ id: operator.id, role: operator.role });
  });
  if (operators.length === 0) throw invalid();
  const lines = ['BEGIN;', "SET LOCAL ROLE vnext_pg17_owner;"];
  lines.push(`INSERT INTO vnext_control_plane.vnext_authorities (authority_id,status,created_at,updated_at) VALUES (${authorityId},'active',transaction_timestamp(),transaction_timestamp());`);
  for (const operator of operators) {
    const accountId = text(opaqueId('account', operator.id));
    lines.push(`INSERT INTO vnext_control_plane.vnext_accounts (account_id,authority_id,status,auth_version,access_version,revocation_version,row_version,created_at,updated_at) VALUES (${accountId},${authorityId},'active',1,1,1,1,transaction_timestamp(),transaction_timestamp());`);
    if (operator.role === 'super_admin') lines.push(`INSERT INTO vnext_control_plane.vnext_role_grants (grant_id,authority_id,account_id,role,status,grant_version,row_version,starts_at,ends_at,revoked_at,granted_by_account_id,created_at,updated_at) VALUES (${text(opaqueId('role', operator.id))},${authorityId},${accountId},'super_admin','active',1,1,transaction_timestamp(),NULL,NULL,NULL,transaction_timestamp(),transaction_timestamp());`);
  }
  lines.push('RESET ROLE;');
  lines.push('COMMIT;');
  return Object.freeze({ sql: `${lines.join('\n')}\n`, accountCount: operators.length, superAdminGrantCount: operators.filter(operator => operator.role === 'super_admin').length });
}

module.exports = Object.freeze({ buildCloudOperatorIdentitySeedSql });
