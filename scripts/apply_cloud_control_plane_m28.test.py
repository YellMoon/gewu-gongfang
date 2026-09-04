import json
import unittest

from apply_cloud_control_plane_m28 import (
    apply_control_plane_m28,
    behavior_sql,
    state_sql,
    validate_upgrade,
)


UPGRADE = {
    "sql": "\\set ON_ERROR_STOP on\nSELECT 1;",
    "migrationCount": 1,
    "migrationId": "vnext-pg17-desktop-password-conflict-target-fix-28",
    "semanticVersion": 28,
    "manifestSha256": "a" * 64,
}
READY = {"ledgerCount": 28, "targetCount": 1, "conflictTargetFixed": True}
PENDING = {"ledgerCount": 27, "targetCount": 0, "conflictTargetFixed": False}


class Fake:
    def __init__(self, outputs):
        self.outputs = list(outputs)
        self.sql = []

    def run(self, sql):
        self.sql.append(sql)
        return self.outputs.pop(0)


class Tests(unittest.TestCase):
    def test_applies_verifies_and_exercises_exact_m28_state(self):
        fake = Fake([json.dumps(PENDING), "", json.dumps(READY), ""])
        self.assertEqual(
            apply_control_plane_m28(fake, UPGRADE),
            {"applied": [UPGRADE["migrationId"]], "skipped": []},
        )
        self.assertEqual(len(fake.sql), 4)
        self.assertIn("ROLLBACK;", fake.sql[-1])

    def test_ready_state_is_still_exercised_before_skip(self):
        fake = Fake([json.dumps(READY), ""])
        self.assertEqual(
            apply_control_plane_m28(fake, UPGRADE),
            {"applied": [], "skipped": [UPGRADE["migrationId"]]},
        )
        self.assertEqual(len(fake.sql), 2)
        self.assertIn("vnext_set_desktop_password_credential", fake.sql[-1])

    def test_skips_ready_state_after_later_migrations(self):
        after_m29 = {**READY, "ledgerCount": 29}
        fake = Fake([json.dumps(after_m29), ""])
        self.assertEqual(
            apply_control_plane_m28(fake, UPGRADE),
            {"applied": [], "skipped": [UPGRADE["migrationId"]]},
        )
        self.assertIn("vnext_set_desktop_password_credential", fake.sql[-1])
        for mutation in (
            {"ledgerCount": 27},
            {"ledgerCount": True},
            {"targetCount": 0},
            {"conflictTargetFixed": False},
        ):
            with self.subTest(mutation=mutation), self.assertRaisesRegex(
                RuntimeError, "M28_STATE_INVALID"
            ):
                apply_control_plane_m28(Fake([json.dumps({**READY, **mutation})]), UPGRADE)

    def test_state_sql_verifies_ledger_and_exact_constraint_target(self):
        sql = state_sql(UPGRADE)
        self.assertIn(UPGRADE["migrationId"], sql)
        self.assertIn("semantic_version=28", sql)
        self.assertIn("pg_get_functiondef", sql)
        self.assertIn(
            "onconflictonconstraintvnext_desktop_password_credentials_pkeydoupdate",
            sql,
        )
        self.assertIn("updatevnext_control_plane.vnext_accountsasa", sql)
        self.assertIn(
            "wherea.authority_id=p_authority_idanda.account_id=p_account_id", sql
        )
        self.assertIn("::regprocedure", sql)

    def test_behavior_probe_calls_insert_and_update_paths_then_rolls_back(self):
        sql = behavior_sql()
        self.assertIn("vnext_set_desktop_password_credential", sql)
        self.assertGreaterEqual(sql.count("vnext_set_desktop_password_credential"), 2)
        self.assertIn("first_version <> 1", sql)
        self.assertIn("second_version <> 2", sql)
        self.assertIn("auth_version <> 3", sql)
        self.assertIn("row_version <> 3", sql)
        self.assertIn("ROLLBACK;", sql)
        self.assertNotIn("COMMIT;", sql)

    def test_rejects_invalid_configuration(self):
        with self.assertRaisesRegex(RuntimeError, "M28_CONFIG_INVALID"):
            validate_upgrade({**UPGRADE, "semanticVersion": 27})


if __name__ == "__main__":
    unittest.main()
