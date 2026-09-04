import json
import unittest
from apply_cloud_control_plane_m25 import apply_control_plane_m25, state_sql, validate_upgrade

UPGRADE = {"sql": "\\set ON_ERROR_STOP on\nSELECT 1;", "migrationCount": 1, "migrationId": "vnext-pg17-desktop-session-source-lock-25", "semanticVersion": 25, "manifestSha256": "a" * 64}
READY = {"ledgerCount": 25, "targetCount": 1, "startFixed": True, "exchangeFixed": True, "writerStart": True, "writerExchange": True, "publicStart": False, "publicExchange": False}
BEFORE = {"ledgerCount": 24, "targetCount": 0, "startFixed": False, "exchangeFixed": False, "writerStart": True, "writerExchange": True, "publicStart": False, "publicExchange": False}

class Fake:
    def __init__(self, outputs): self.outputs = list(outputs); self.sql = []
    def run(self, sql): self.sql.append(sql); return self.outputs.pop(0)

class Tests(unittest.TestCase):
    def test_state_sql_normalizes_equivalent_production_function_format(self):
        sql = state_sql(UPGRADE)
        self.assertIn("lower(regexp_replace(pg_get_functiondef(p.oid),'[[:space:]]+','','g'))", sql)
        for marker in (
            "s.status=''active''",
            "s.expires_at>now_at",
            "forshareofs",
            "source_sessionvnext_control_plane.vnext_sessions%rowtype",
            "source_session.status<>''active''",
            "forupdate",
        ):
            self.assertIn(marker, sql)
        self.assertNotIn("position('s.status = ''active''' in pg_get_functiondef(p.oid))", sql)
        self.assertNotIn("position('source_session.status <> ''active''' in pg_get_functiondef(p.oid))", sql)

    def test_apply(self):
        fake = Fake([json.dumps(BEFORE), '', json.dumps(READY)])
        self.assertEqual(apply_control_plane_m25(fake, UPGRADE)["applied"], [UPGRADE["migrationId"]])
        self.assertIn("pg_get_functiondef", state_sql(UPGRADE))
    def test_skip(self):
        self.assertEqual(apply_control_plane_m25(Fake([json.dumps(READY)]), UPGRADE)["skipped"], [UPGRADE["migrationId"]])
        self.assertEqual(apply_control_plane_m25(Fake([json.dumps({**READY, "ledgerCount": 26})]), UPGRADE)["skipped"], [UPGRADE["migrationId"]])
    def test_reject_partial(self):
        with self.assertRaisesRegex(RuntimeError, "M25_STATE_INVALID"):
            apply_control_plane_m25(Fake([json.dumps({**READY, "exchangeFixed": False})]), UPGRADE)
    def test_reject_config(self):
        with self.assertRaisesRegex(RuntimeError, "M25_CONFIG_INVALID"):
            validate_upgrade({**UPGRADE, "semanticVersion": 24})

if __name__ == '__main__': unittest.main()
