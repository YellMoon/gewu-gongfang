import json
import unittest

from apply_cloud_control_plane_m27 import apply_control_plane_m27, state_sql, validate_upgrade


UPGRADE = {
    "sql": "\\set ON_ERROR_STOP on\nSELECT 1;",
    "migrationCount": 1,
    "migrationId": "vnext-pg17-family-member-canonical-role-27",
    "semanticVersion": 27,
    "manifestSha256": "a" * 64,
}
READY = {"ledgerCount": 27, "targetCount": 1, "familyMemberRole": True}
PENDING = {"ledgerCount": 26, "targetCount": 0, "familyMemberRole": False}


class Fake:
    def __init__(self, outputs):
        self.outputs = list(outputs)
        self.sql = []

    def run(self, sql):
        self.sql.append(sql)
        return self.outputs.pop(0)


class Tests(unittest.TestCase):
    def test_applies_and_verifies_exact_m27_state(self):
        fake = Fake([json.dumps(PENDING), "", json.dumps(READY)])
        self.assertEqual(apply_control_plane_m27(fake, UPGRADE), {"applied": [UPGRADE["migrationId"]], "skipped": []})
        self.assertEqual(len(fake.sql), 3)

    def test_skips_only_exact_ready_state(self):
        self.assertEqual(apply_control_plane_m27(Fake([json.dumps(READY)]), UPGRADE)["skipped"], [UPGRADE["migrationId"]])
        for mutation in ({"ledgerCount": 28}, {"targetCount": 0}, {"familyMemberRole": False}):
            with self.subTest(mutation=mutation), self.assertRaisesRegex(RuntimeError, "M27_STATE_INVALID"):
                apply_control_plane_m27(Fake([json.dumps({**READY, **mutation})]), UPGRADE)

    def test_state_sql_verifies_ledger_and_exact_role_constraint(self):
        sql = state_sql(UPGRADE)
        self.assertIn(UPGRADE["migrationId"], sql)
        self.assertIn("semantic_version=27", sql)
        self.assertIn("family_member", sql)
        self.assertIn("vnext_role_grants_role_check", sql)

    def test_role_constraint_verification_does_not_parse_function_formatting(self):
        sql = state_sql(UPGRADE)
        self.assertNotIn("pg_get_functiondef", sql)
        self.assertIn("pg_get_constraintdef", sql)

    def test_role_constraint_verification_extracts_the_exact_semantic_role_set(self):
        sql = state_sql(UPGRADE)
        self.assertIn("regexp_matches(definition,$role$'([^']+)'$role$,'g')", sql)
        self.assertIn(
            "array_agg(role_name ORDER BY role_name)=ARRAY['family_member','student','super_admin','teacher']::text[]",
            sql,
        )
        self.assertNotIn("position('super_admin' in definition)", sql)

    def test_rejects_invalid_configuration(self):
        with self.assertRaisesRegex(RuntimeError, "M27_CONFIG_INVALID"):
            validate_upgrade({**UPGRADE, "semanticVersion": 26})


if __name__ == "__main__":
    unittest.main()
