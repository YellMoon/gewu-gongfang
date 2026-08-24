import json
import unittest

from apply_cloud_control_plane_m20 import apply_control_plane_m20


UPGRADE = {
    "sql": "\\set ON_ERROR_STOP on\nBEGIN;\nSELECT 20;\nCOMMIT;\n",
    "migrationCount": 1,
    "migrationId": "vnext-pg17-fixed-super-admin-invariant-20",
    "semanticVersion": 20,
    "manifestSha256": "a" * 64,
}


class FakeExecutor:
    def __init__(self, state):
        self.state = dict(state)
        self.calls = []

    def run(self, sql):
        self.calls.append(sql)
        if sql == UPGRADE["sql"]:
            self.state = {"ledgerCount": 20, "targetCount": 1, "indexPresent": True}
            return ""
        return json.dumps(self.state) + "\n"


class CloudControlPlaneM20Tests(unittest.TestCase):
    def test_applies_only_to_an_exact_m19_prefix_and_verifies_m20(self):
        executor = FakeExecutor({"ledgerCount": 19, "targetCount": 0, "indexPresent": False})
        self.assertEqual(apply_control_plane_m20(executor, UPGRADE), {
            "applied": [UPGRADE["migrationId"]], "skipped": [],
        })
        self.assertIn(UPGRADE["sql"], executor.calls)
        self.assertGreaterEqual(len(executor.calls), 3)

    def test_skips_only_an_exact_verified_m20(self):
        executor = FakeExecutor({"ledgerCount": 20, "targetCount": 1, "indexPresent": True})
        self.assertEqual(apply_control_plane_m20(executor, UPGRADE), {
            "applied": [], "skipped": [UPGRADE["migrationId"]],
        })
        self.assertNotIn(UPGRADE["sql"], executor.calls)

    def test_skips_verified_m20_when_later_migrations_exist(self):
        executor = FakeExecutor({"ledgerCount": 22, "targetCount": 1, "indexPresent": True})
        self.assertEqual(apply_control_plane_m20(executor, UPGRADE)["skipped"], [UPGRADE["migrationId"]])

    def test_rejects_unknown_or_partially_applied_state(self):
        for state in (
            {"ledgerCount": 18, "targetCount": 0, "indexPresent": False},
            {"ledgerCount": 20, "targetCount": 0, "indexPresent": True},
            {"ledgerCount": 20, "targetCount": 1, "indexPresent": False},
        ):
            with self.subTest(state=state):
                with self.assertRaisesRegex(RuntimeError, "CLOUD_CONTROL_PLANE_M20_STATE_INVALID"):
                    apply_control_plane_m20(FakeExecutor(state), UPGRADE)


if __name__ == "__main__":
    unittest.main()
