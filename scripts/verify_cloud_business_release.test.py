import importlib.util
import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("verify_cloud_business_release", ROOT / "scripts" / "verify_cloud_business_release.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class VerifyCloudBusinessReleaseTest(unittest.TestCase):
    def test_device_revocation_verification_normalizes_equivalent_production_function_format(self):
        sql = MODULE.verification_sql()
        revocation_check = sql.split("'desktopDeviceRevocationFixed'", 1)[1].split("'controlPlaneM25'", 1)[0]
        self.assertIn("lower(regexp_replace(pg_get_functiondef(p.oid),'[[:space:]]+','','g')) AS normalized_definition", revocation_check)
        self.assertIn("fromvnext_control_plane.vnext_accountsasa", revocation_check)
        self.assertIn("a.status=''active''", revocation_check)
        self.assertNotIn("position('FROM vnext_control_plane.vnext_accounts AS a' in pg_get_functiondef(p.oid))", revocation_check)
        self.assertNotIn("position('a.status = ''active''' in pg_get_functiondef(p.oid))", revocation_check)

    def test_sql_checks_counts_functions_and_direct_write_denial(self):
        sql = MODULE.verification_sql()
        self.assertIn("jsonb_object_agg", sql)
        self.assertNotIn("SELECT json_build_object(", sql)
        self.assertIn("VALUES", sql)
        self.assertEqual(MODULE.CONTROL_PLANE_M25_ID, "vnext-pg17-desktop-session-source-lock-25")
        self.assertEqual(MODULE.CONTROL_PLANE_M25_SHA256, "0b9a7a2f7cbd29fcbfb12391636657396ed3be153ccd5fef88a9487aa1b245bb")
        self.assertEqual(MODULE.CONTROL_PLANE_M26_ID, "vnext-pg17-desktop-device-revoke-authorization-lock-26")
        self.assertEqual(MODULE.CONTROL_PLANE_M26_SHA256, "48bcfbdd3958d70a224ce807f4da1e23ce7142024a62913ce2e59b7eb8cd87cc")
        self.assertEqual(MODULE.CONTROL_PLANE_M27_ID, "vnext-pg17-family-member-canonical-role-27")
        self.assertEqual(MODULE.CONTROL_PLANE_M27_SHA256, "297f705391d59c85733505e8b84e708ce33e4c90abb24a8a9231ad1bfc02de1c")
        for table in ("institutions", "schools", "rooms", "courses", "schedules"):
            self.assertIn(f"(SELECT count(*) FROM business.{table})", sql)
            self.assertNotIn(f"business.{table} WHERE legacy_deleted=false", sql)
        self.assertIn("vnext_create_schedule_record_v1", sql)
        self.assertIn("has_table_privilege('vnext_pg17_writer'", sql)
        self.assertIn("has_table_privilege('vnext_pg17_runtime'", sql)
        self.assertIn("business.question_taxonomy_systems", sql)
        self.assertIn("vnext_create_question_taxonomy_node_v1", sql)
        self.assertIn("vnext-pg17-fixed-super-admin-invariant-20", sql)
        self.assertIn("vnext-pg17-desktop-session-context-reader-21", sql)
        self.assertIn("desktopSessionReaderPrivileges", sql)
        self.assertIn("vnext-pg17-desktop-canonical-phone-reader-22", sql)
        self.assertIn("vnext-pg17-desktop-cloud-session-control-23", sql)
        self.assertIn("vnext-pg17-desktop-device-revoke-status-fix-24", sql)
        self.assertIn("desktopDeviceRevocationFixed", sql)
        self.assertIn("vnext-pg17-desktop-session-source-lock-25", sql)
        self.assertIn("semantic_version=25", sql)
        self.assertIn("0b9a7a2f7cbd29fcbfb12391636657396ed3be153ccd5fef88a9487aa1b245bb", sql)
        self.assertIn("desktopSessionStartSourceLocked", sql)
        self.assertIn("desktopSessionExchangeSourceLocked", sql)
        self.assertIn("vnext-pg17-desktop-device-revoke-authorization-lock-26", sql)
        self.assertIn("semantic_version=26", sql)
        self.assertIn("48bcfbdd3958d70a224ce807f4da1e23ce7142024a62913ce2e59b7eb8cd87cc", sql)
        self.assertIn("vnext-pg17-family-member-canonical-role-27", sql)
        self.assertIn("semantic_version=27", sql)
        self.assertIn("297f705391d59c85733505e8b84e708ce33e4c90abb24a8a9231ad1bfc02de1c", sql)
        self.assertIn("controlPlaneFamilyMemberRole", sql)
        self.assertIn("businessFamilyMemberRole", sql)
        self.assertIn("businessFamilyMemberReviewV4", sql)
        self.assertIn("desktopDeviceRevocationAuthorizationLocked", sql)
        self.assertIn("actor_session.session_kind<>''online''", sql)
        self.assertIn("actor_session.account_auth_version", sql)
        self.assertIn("actor_grant", sql)
        self.assertIn("g.role=''super_admin''", sql)
        self.assertIn("g.status=''active''", sql)
        self.assertIn("forshareofs", sql)
        self.assertIn("s.status=''active''", sql)
        self.assertIn("s.expires_at>now_at", sql)
        self.assertIn("row(s.account_auth_version", sql)
        self.assertIn("source_session.status<>''active''", sql)
        self.assertIn("source_session.expires_at<=now_at", sql)
        self.assertIn("row(source_session.account_auth_version", sql)
        self.assertIn("vnext_start_desktop_session_challenge", sql)
        self.assertIn("vnext_revoke_desktop_device", sql)
        self.assertIn("vnext_role_grants_one_active_super_admin", sql)
        self.assertIn("activeSuperAdminAccountId", sql)
        self.assertIn("businessActiveSuperAdminAccountId", sql)
        self.assertIn("miniapp_cloud_role_grants_one_active_super_admin", sql)
        self.assertIn("runtimeProjectionRead", sql)
        self.assertIn("runtimeCoreDirectWrite", sql)
        self.assertIn("business.teachers WHERE id NOT LIKE 'e2e-teacher-%'", sql)
        self.assertIn("business.students WHERE id NOT LIKE 'e2e-student-%'", sql)
        self.assertNotIn("business.teachers WHERE legacy_deleted=false", sql)
        self.assertNotIn("business.students WHERE legacy_deleted=false", sql)

    def test_validation_fails_closed(self):
        valid = dict(MODULE.IMPORTED_COUNT_BASELINES)
        valid.update({
            "scheduleCreateFunction": True,
            "institutionCreateFunction": True,
            "schoolCreateFunction": True,
            "writerScheduleExecute": True,
            "writerDirectScheduleInsert": False,
            "runtimeDirectScheduleInsert": False,
            "taxonomySystemTable": True,
            "taxonomyNodeTable": True,
            "taxonomyFunctions": True,
            "writerTaxonomyExecute": True,
            "writerDirectTaxonomyInsert": False,
            "supplementalAuthorityTables": True,
            "writerSupplementalInsert": True,
            "runtimeSupplementalInsert": False,
            "readerSupplementalWrite": False,
            "runtimeProjectionRead": True,
            "runtimeCoreDirectWrite": False,
            "controlPlaneM20": True,
            "controlPlaneM21": True,
            "desktopSessionReaderPrivileges": True,
            "controlPlaneM22": True,
            "desktopCanonicalPhoneReader": True,
            "controlPlaneM23": True,
            "desktopCloudSessionContracts": True,
            "controlPlaneM24": True,
            "desktopDeviceRevocationFixed": True,
            "controlPlaneM25": True,
            "desktopSessionStartSourceLocked": True,
            "desktopSessionExchangeSourceLocked": True,
            "controlPlaneM26": True,
            "controlPlaneM27": True,
            "controlPlaneFamilyMemberRole": True,
            "businessFamilyMemberRole": True,
            "businessFamilyMemberReviewV4": True,
            "desktopDeviceRevocationAuthorizationLocked": True,
            "oneActiveSuperAdmin": True,
            "uniqueSuperAdminIndex": True,
            "businessOneActiveSuperAdmin": True,
            "businessUniqueSuperAdminIndex": True,
            "fixedSuperAdminPhone": True,
        })
        self.assertEqual(MODULE.validate(valid), valid)
        grown = dict(valid, institutions=MODULE.IMPORTED_COUNT_BASELINES["institutions"] + 1)
        self.assertEqual(MODULE.validate(grown), grown)
        invalid = dict(valid, schedules=554)
        with self.assertRaisesRegex(RuntimeError, "COUNT_BELOW_BASELINE:schedules"):
            MODULE.validate(invalid)
        with self.assertRaisesRegex(RuntimeError, "COUNT_BELOW_BASELINE:institutions"):
            MODULE.validate(dict(valid, institutions=4.5))
        with self.assertRaisesRegex(RuntimeError, "DIRECT_WRITE_OPEN"):
            MODULE.validate(dict(valid, writerDirectScheduleInsert=True))
        with self.assertRaisesRegex(RuntimeError, "ACCOUNT_ROLE_INVARIANT"):
            MODULE.validate(dict(valid, fixedSuperAdminPhone=False))
        with self.assertRaisesRegex(RuntimeError, "ACCOUNT_ROLE_INVARIANT"):
            MODULE.validate(dict(valid, controlPlaneM25=False))
        with self.assertRaisesRegex(RuntimeError, "ACCOUNT_ROLE_INVARIANT"):
            MODULE.validate(dict(valid, desktopSessionStartSourceLocked=False))
        with self.assertRaisesRegex(RuntimeError, "ACCOUNT_ROLE_INVARIANT"):
            MODULE.validate(dict(valid, desktopSessionExchangeSourceLocked=False))
        with self.assertRaisesRegex(RuntimeError, "ACCOUNT_ROLE_INVARIANT"):
            MODULE.validate(dict(valid, controlPlaneM26=False))
        with self.assertRaisesRegex(RuntimeError, "ACCOUNT_ROLE_INVARIANT:controlPlaneM27"):
            MODULE.validate(dict(valid, controlPlaneM27=False))
        with self.assertRaisesRegex(RuntimeError, "ACCOUNT_ROLE_INVARIANT"):
            MODULE.validate(dict(valid, businessFamilyMemberRole=False))
        with self.assertRaisesRegex(RuntimeError, "ACCOUNT_ROLE_INVARIANT"):
            MODULE.validate(dict(valid, desktopDeviceRevocationAuthorizationLocked=False))

    def test_fixed_admin_account_comparison_does_not_persist_the_account_id(self):
        payload = {"activeSuperAdminAccountId": "account-fixed", "businessActiveSuperAdminAccountId": "account-fixed"}
        self.assertEqual(MODULE.merge_fixed_admin(
            payload, {"fixedSuperAdminAccountId": "account-fixed"}
        ), {"fixedSuperAdminPhone": True})
        self.assertEqual(MODULE.merge_fixed_admin(
            {"activeSuperAdminAccountId": "account-other", "businessActiveSuperAdminAccountId": "account-fixed"},
            {"fixedSuperAdminAccountId": "account-fixed"},
        ), {"fixedSuperAdminPhone": False})
        self.assertEqual(MODULE.merge_fixed_admin(
            {"activeSuperAdminAccountId": "account-fixed", "businessActiveSuperAdminAccountId": "account-other"},
            {"fixedSuperAdminAccountId": "account-fixed"},
        ), {"fixedSuperAdminPhone": False})


if __name__ == "__main__":
    unittest.main()
