'use strict';
// UTF-8: disposable PostgreSQL tests only. Production uses its existing role-grant directory.
const fs = require('node:fs');
const path = require('node:path');
async function applyManagedTeacherProfileFixture(db) {
  await db.query('CREATE TABLE business.miniapp_cloud_role_grants(account_id text,role text,status text,profile_type text,profile_id text); ALTER TABLE business.miniapp_cloud_role_grants OWNER TO vnext_pg17_business_owner');
  await db.query(fs.readFileSync(path.join(__dirname, '20260912-managed-teacher-profile.sql'), 'utf8'));
}
async function applyInstitutionBillingProjectionFixture(db) {
  for (const file of ['20260908-z-institution-billing-student.sql', '20260913-teacher-institution-scope.sql']) {
    await db.query(fs.readFileSync(path.join(__dirname, file), 'utf8'));
  }
  await db.query('GRANT SELECT ON business.institutions,business.institution_billing_students TO gewu_cloud_schedule_reader');
}
module.exports = { applyManagedTeacherProfileFixture, applyInstitutionBillingProjectionFixture };
