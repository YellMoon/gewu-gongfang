import importlib.util
import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("verify_cloud_business_release", ROOT / "scripts" / "verify_cloud_business_release.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class VerifyCloudBusinessReleaseTest(unittest.TestCase):
    def test_sql_checks_counts_functions_and_direct_write_denial(self):
        sql = MODULE.verification_sql()
        self.assertIn("business.schedules WHERE legacy_deleted=false", sql)
        self.assertIn("vnext_create_schedule_record_v1", sql)
        self.assertIn("has_table_privilege('vnext_pg17_writer'", sql)
        self.assertIn("has_table_privilege('vnext_pg17_runtime'", sql)
        self.assertIn("business.question_taxonomy_systems", sql)
        self.assertIn("vnext_create_question_taxonomy_node_v1", sql)
        self.assertIn("vnext-pg17-fixed-super-admin-invariant-20", sql)
        self.assertIn("vnext-pg17-desktop-session-context-reader-21", sql)
        self.assertIn("desktopSessionReaderPrivileges", sql)
        self.assertIn("vnext-pg17-desktop-canonical-phone-reader-22", sql)
        self.assertIn("vnext_role_grants_one_active_super_admin", sql)
        self.assertIn("activeSuperAdminAccountId", sql)
        self.assertIn("runtimeProjectionRead", sql)
        self.assertIn("runtimeCoreDirectWrite", sql)

    def test_validation_fails_closed(self):
        valid = dict(MODULE.EXPECTED_COUNTS)
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
            "oneActiveSuperAdmin": True,
            "uniqueSuperAdminIndex": True,
            "fixedSuperAdminPhone": True,
        })
        self.assertEqual(MODULE.validate(valid), valid)
        invalid = dict(valid, schedules=554)
        with self.assertRaisesRegex(RuntimeError, "COUNT_MISMATCH:schedules"):
            MODULE.validate(invalid)
        with self.assertRaisesRegex(RuntimeError, "DIRECT_WRITE_OPEN"):
            MODULE.validate(dict(valid, writerDirectScheduleInsert=True))
        with self.assertRaisesRegex(RuntimeError, "CONTROL_PLANE_INVARIANT"):
            MODULE.validate(dict(valid, fixedSuperAdminPhone=False))

    def test_fixed_admin_account_comparison_does_not_persist_the_account_id(self):
        payload = {"activeSuperAdminAccountId": "account-fixed"}
        self.assertEqual(MODULE.merge_fixed_admin(
            payload, {"fixedSuperAdminAccountId": "account-fixed"}
        ), {"fixedSuperAdminPhone": True})
        self.assertEqual(MODULE.merge_fixed_admin(
            {"activeSuperAdminAccountId": "account-other"},
            {"fixedSuperAdminAccountId": "account-fixed"},
        ), {"fixedSuperAdminPhone": False})


if __name__ == "__main__":
    unittest.main()
