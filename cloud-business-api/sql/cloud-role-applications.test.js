'use strict';

const assert = require('assert');
const fs = require('fs');

const sql = fs.readFileSync(__dirname + '/20260826-cloud-role-applications.sql', 'utf8');
assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS business.cloud_role_applications'));
assert.ok(sql.includes("requested_identity IN ('teacher','student','family_member')"));
assert.ok(sql.includes("profile_mode='existing'"));
assert.ok(sql.includes('binding_hint text NOT NULL'));
assert.ok(sql.includes('CHECK (length(binding_hint) > 0)'));
assert.ok(sql.includes('UNIQUE (tenant_id, cloud_account_id, idempotency_key)'));
assert.ok(sql.includes('REVOKE ALL ON TABLE business.cloud_role_applications FROM PUBLIC'));
assert.ok(sql.includes('CREATE OR REPLACE FUNCTION business.vnext_review_cloud_role_application_v1'));
assert.ok(sql.includes("p_decision NOT IN ('approved','rejected')"));
assert.ok(sql.includes("role='super_admin' AND status='active'"));
assert.ok(sql.includes("application_row.requested_identity='family_member' THEN 'guardian'"));
console.log('cloud role application schema checks passed');
