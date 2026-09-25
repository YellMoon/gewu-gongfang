-- UTF-8: one canonical user keeps super_admin and teacher simultaneously; (account_id, role) already enforces role uniqueness.
BEGIN;
SET LOCAL ROLE vnext_pg17_business_owner;
DROP INDEX IF EXISTS business.miniapp_cloud_one_active_role;
COMMIT;
