BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT role
      FROM business.miniapp_cloud_role_grants
     WHERE role='super_admin' AND status='active'
     GROUP BY role
    HAVING count(*)>1
  ) THEN
    RAISE EXCEPTION 'CLOUD_BUSINESS_FIXED_SUPER_ADMIN_INVARIANT_VIOLATED' USING ERRCODE='P0001';
  END IF;
END;
$$;

CREATE UNIQUE INDEX miniapp_cloud_role_grants_one_active_super_admin
  ON business.miniapp_cloud_role_grants(role)
  WHERE role='super_admin' AND status='active';

COMMIT;
