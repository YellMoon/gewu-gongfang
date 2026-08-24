import unittest

from apply_cloud_control_plane_m21 import apply_control_plane_m21, state_sql, validate_upgrade


UPGRADE = {
    "sql": "\\set ON_ERROR_STOP on\nSELECT 1;",
    "migrationCount": 1,
    "migrationId": "vnext-pg17-desktop-session-context-reader-21",
    "semanticVersion": 21,
    "manifestSha256": "a" * 64,
}


class FakeExecutor:
    def __init__(self, states):
        self.states = list(states)
        self.calls = []

    def run(self, sql):
        self.calls.append(sql)
        if sql.startswith("\\set ON_ERROR_STOP on\nBEGIN;\nGRANT"):
            return self.states.pop(0)
        return ""


class ControlPlaneM21Tests(unittest.TestCase):
    def test_state_query_checks_exact_ledger_and_minimum_reader_privileges(self):
        sql = state_sql(UPGRADE)
        self.assertIn("semantic_version=21", sql)
        self.assertIn("vnext_control_plane.vnext_sessions", sql)
        self.assertIn("vnext_control_plane.vnext_role_grants", sql)
        self.assertNotIn("INSERT')", sql)

    def test_applies_from_exact_m20_and_verifies(self):
        before = '{"ledgerCount":20,"targetCount":0,"readerPrivileges":false}'
        after = '{"ledgerCount":21,"targetCount":1,"readerPrivileges":true}'
        executor = FakeExecutor([before, after])
        self.assertEqual(apply_control_plane_m21(executor, UPGRADE), {
            "applied": [UPGRADE["migrationId"]], "skipped": [],
        })
        self.assertIn(UPGRADE["sql"], executor.calls)

    def test_skips_only_exact_verified_m21(self):
        state = '{"ledgerCount":21,"targetCount":1,"readerPrivileges":true}'
        self.assertEqual(apply_control_plane_m21(FakeExecutor([state]), UPGRADE), {
            "applied": [], "skipped": [UPGRADE["migrationId"]],
        })

    def test_skips_verified_m21_when_later_migrations_exist(self):
        state = '{"ledgerCount":22,"targetCount":1,"readerPrivileges":true}'
        self.assertEqual(apply_control_plane_m21(FakeExecutor([state]), UPGRADE)["skipped"], [UPGRADE["migrationId"]])

    def test_rejects_drift_and_bad_config(self):
        with self.assertRaisesRegex(RuntimeError, "M21_STATE_INVALID"):
            apply_control_plane_m21(FakeExecutor(['{"ledgerCount":21,"targetCount":1,"readerPrivileges":false}']), UPGRADE)
        with self.assertRaisesRegex(RuntimeError, "M21_CONFIG_INVALID"):
            validate_upgrade({**UPGRADE, "semanticVersion": 20})


if __name__ == "__main__":
    unittest.main()
