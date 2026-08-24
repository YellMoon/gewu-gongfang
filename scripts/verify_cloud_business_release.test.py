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

    def test_validation_fails_closed(self):
        valid = dict(MODULE.EXPECTED_COUNTS)
        valid.update({
            "scheduleCreateFunction": True,
            "institutionCreateFunction": True,
            "schoolCreateFunction": True,
            "writerScheduleExecute": True,
            "writerDirectScheduleInsert": False,
            "runtimeDirectScheduleInsert": False,
        })
        self.assertEqual(MODULE.validate(valid), valid)
        invalid = dict(valid, schedules=554)
        with self.assertRaisesRegex(RuntimeError, "COUNT_MISMATCH:schedules"):
            MODULE.validate(invalid)
        with self.assertRaisesRegex(RuntimeError, "DIRECT_WRITE_OPEN"):
            MODULE.validate(dict(valid, writerDirectScheduleInsert=True))


if __name__ == "__main__":
    unittest.main()
