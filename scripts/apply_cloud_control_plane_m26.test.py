import json
import re
import unittest

from apply_cloud_control_plane_m26 import apply_control_plane_m26, load_upgrade, state_sql, validate_upgrade


UPGRADE = {
    "sql": "\\set ON_ERROR_STOP on\nSELECT 1;",
    "migrationCount": 1,
    "migrationId": "vnext-pg17-desktop-device-revoke-authorization-lock-26",
    "semanticVersion": 26,
    "manifestSha256": "a" * 64,
}
READY = {
    "ledgerCount": 26,
    "targetCount": 1,
    "actorSessionLocked": True,
    "accountParentLocked": True,
    "deviceParentLocked": True,
    "installationParentLocked": True,
    "linkParentLocked": True,
    "activeSuperAdminLocked": True,
    "writerRevoke": True,
    "publicRevoke": False,
}
BEFORE = {
    "ledgerCount": 25,
    "targetCount": 0,
    "actorSessionLocked": False,
    "accountParentLocked": False,
    "deviceParentLocked": False,
    "installationParentLocked": False,
    "linkParentLocked": False,
    "activeSuperAdminLocked": False,
    "writerRevoke": True,
    "publicRevoke": False,
}


class Fake:
    def __init__(self, outputs):
        self.outputs = list(outputs)
        self.sql = []

    def run(self, sql):
        self.sql.append(sql)
        return self.outputs.pop(0)


class Tests(unittest.TestCase):
    def test_apply_and_verify_exact_state(self):
        fake = Fake([json.dumps(BEFORE), "", json.dumps(READY)])
        self.assertEqual(apply_control_plane_m26(fake, UPGRADE)["applied"], [UPGRADE["migrationId"]])
        self.assertEqual(len(fake.sql), 3)

    def test_skip_only_exact_ready_state(self):
        self.assertEqual(
            apply_control_plane_m26(Fake([json.dumps(READY)]), UPGRADE)["skipped"],
            [UPGRADE["migrationId"]],
        )
        with self.assertRaisesRegex(RuntimeError, "M26_STATE_INVALID"):
            apply_control_plane_m26(Fake([json.dumps({**READY, "ledgerCount": 27})]), UPGRADE)

    def test_rejects_each_partial_lock_or_privilege_state(self):
        for key in (
            "actorSessionLocked",
            "accountParentLocked",
            "deviceParentLocked",
            "installationParentLocked",
            "linkParentLocked",
            "activeSuperAdminLocked",
        ):
            with self.subTest(key=key), self.assertRaisesRegex(RuntimeError, "M26_STATE_INVALID"):
                apply_control_plane_m26(Fake([json.dumps({**READY, key: False})]), UPGRADE)
        for mutation in (
            {"writerRevoke": False},
            {"publicRevoke": True},
            {"targetCount": 0},
        ):
            with self.subTest(mutation=mutation), self.assertRaisesRegex(RuntimeError, "M26_STATE_INVALID"):
                apply_control_plane_m26(Fake([json.dumps({**READY, **mutation})]), UPGRADE)

    def test_state_sql_checks_exact_ledger_function_locks_and_privileges(self):
        sql = state_sql(UPGRADE)
        self.assertIn(UPGRADE["migrationId"], sql)
        self.assertIn("semantic_version=26", sql)
        self.assertIn(UPGRADE["manifestSha256"], sql)
        self.assertIn("s.session_id=p_actor_session_idforupdate", sql)
        self.assertIn("actor_session.account_auth_version", sql)
        self.assertIn("actor_account.auth_version", sql)
        self.assertIn("actor_session.device_credential_version", sql)
        self.assertIn("actor_device.credential_version", sql)
        self.assertIn("actor_session.installation_credential_version", sql)
        self.assertIn("actor_installation.credential_version", sql)
        self.assertIn("actor_session.link_auth_version", sql)
        self.assertIn("actor_link.auth_version", sql)
        self.assertIn("g.role='super_admin'", sql)
        self.assertIn("g.status='active'", sql)
        self.assertIn("g.starts_at<=now_at", sql)
        self.assertIn("g.ends_atisnullorg.ends_at>now_at", sql)
        self.assertIn("has_function_privilege('vnext_pg17_writer'", sql)
        self.assertIn("has_function_privilege('public'", sql)

    def test_state_sql_normalizes_equivalent_postgres_function_formatting(self):
        sql = state_sql(UPGRADE)
        self.assertIn(
            "lower(regexp_replace(pg_get_functiondef('",
            sql,
            "pg_get_functiondef verification must ignore PostgreSQL keyword case as well as whitespace",
        )
        lock_needles = re.findall(r"position\(\$lock\$(.*?)\$lock\$ in definition\)", sql)
        self.assertGreaterEqual(len(lock_needles), 20)
        self.assertTrue(
            all(needle == needle.lower() for needle in lock_needles),
            "every comparison must target the normalized lowercase function definition",
        )

    def test_reject_config(self):
        with self.assertRaisesRegex(RuntimeError, "M26_CONFIG_INVALID"):
            validate_upgrade({**UPGRADE, "semanticVersion": 25})
        with self.assertRaisesRegex(RuntimeError, "M26_CONFIG_INVALID"):
            validate_upgrade({**UPGRADE, "unexpected": True})

    def test_loads_exact_manifest_upgrade(self):
        loaded = validate_upgrade(load_upgrade())
        self.assertEqual(loaded["migrationId"], UPGRADE["migrationId"])
        self.assertEqual(loaded["semanticVersion"], 26)
        self.assertRegex(loaded["manifestSha256"], r"^[0-9a-f]{64}$")
        compact_upgrade = re.sub(r"\s+", "", loaded["sql"]).lower()
        lock_needles = re.findall(r"position\(\$lock\$(.*?)\$lock\$ in definition\)", state_sql(loaded))
        self.assertGreaterEqual(len(lock_needles), 20)
        for needle in lock_needles:
            with self.subTest(needle=needle):
                self.assertIn(needle, compact_upgrade)


if __name__ == "__main__":
    unittest.main()
