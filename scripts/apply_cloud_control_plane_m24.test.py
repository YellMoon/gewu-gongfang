import json
import unittest
from apply_cloud_control_plane_m24 import apply_control_plane_m24, state_sql, validate_upgrade

UPGRADE = {"sql": "\\set ON_ERROR_STOP on\nSELECT 1;", "migrationCount": 1, "migrationId": "vnext-pg17-desktop-device-revoke-status-fix-24", "semanticVersion": 24, "manifestSha256": "a" * 64}
READY = {"ledgerCount": 24, "targetCount": 1, "functionFixed": True, "writerFunction": True, "publicFunction": False}
BEFORE = {"ledgerCount": 23, "targetCount": 0, "functionFixed": False, "writerFunction": True, "publicFunction": False}

class Fake:
    def __init__(self, outputs): self.outputs = list(outputs); self.sql = []
    def run(self, sql): self.sql.append(sql); return self.outputs.pop(0)

class Tests(unittest.TestCase):
    def test_state_sql_normalizes_equivalent_production_function_format(self):
        sql = state_sql(UPGRADE)
        self.assertIn("lower(regexp_replace(pg_get_functiondef(p.oid),'[[:space:]]+','','g'))", sql)
        self.assertIn("fromvnext_control_plane.vnext_accountsasa", sql)
        self.assertIn("a.status=''active''", sql)
        self.assertNotIn("position('a.status = ''active''' in pg_get_functiondef(p.oid))", sql)

    def test_apply(self):
        fake = Fake([json.dumps(BEFORE), '', json.dumps(READY)])
        self.assertEqual(apply_control_plane_m24(fake, UPGRADE)["applied"], [UPGRADE["migrationId"]])
        self.assertIn("pg_get_functiondef", state_sql(UPGRADE))
    def test_skip(self):
        self.assertEqual(apply_control_plane_m24(Fake([json.dumps(READY)]), UPGRADE)["skipped"], [UPGRADE["migrationId"]])
        self.assertEqual(apply_control_plane_m24(Fake([json.dumps({**READY, "ledgerCount": 25})]), UPGRADE)["skipped"], [UPGRADE["migrationId"]])
    def test_reject_partial(self):
        with self.assertRaisesRegex(RuntimeError, "M24_STATE_INVALID"):
            apply_control_plane_m24(Fake([json.dumps({**READY, "publicFunction": True})]), UPGRADE)
    def test_reject_config(self):
        with self.assertRaisesRegex(RuntimeError, "M24_CONFIG_INVALID"):
            validate_upgrade({**UPGRADE, "semanticVersion": 23})

if __name__ == '__main__': unittest.main()
