'use strict';
// UTF-8: disposable PostgreSQL tests only. Production uses its existing role-grant directory.
const fs = require('node:fs');
const path = require('node:path');
async function applyManagedTeacherProfileFixture(db) {
  await db.query('CREATE TABLE business.miniapp_cloud_role_grants(account_id text,role text,status text,profile_type text,profile_id text); ALTER TABLE business.miniapp_cloud_role_grants OWNER TO vnext_pg17_business_owner');
  await db.query(fs.readFileSync(path.join(__dirname, '20260912-managed-teacher-profile.sql'), 'utf8'));
}
module.exports = { applyManagedTeacherProfileFixture };
