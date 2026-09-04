import unittest
from apply_cloud_control_plane_m23 import apply_control_plane_m23, state_sql, validate_upgrade

UPGRADE = {"sql": "\\set ON_ERROR_STOP on\nSELECT 1;", "migrationCount": 1, "migrationId": "vnext-pg17-desktop-cloud-session-control-23", "semanticVersion": 23, "manifestSha256": "a" * 64}
READY = {"ledgerCount": 23, "targetCount": 1, "challengeRelation": True, "writerSelect": True, "writerFunctions": True, "publicFunctions": False}
BEFORE = {"ledgerCount": 22, "targetCount": 0, "challengeRelation": False, "writerSelect": False, "writerFunctions": False, "publicFunctions": False}

class Fake:
    def __init__(self, outputs): self.outputs = list(outputs); self.sql = []
    def run(self, sql): self.sql.append(sql); return self.outputs.pop(0)

class Tests(unittest.TestCase):
    def test_apply(self):
        fake = Fake([__import__('json').dumps(BEFORE), '', __import__('json').dumps(READY)])
        self.assertEqual(apply_control_plane_m23(fake, UPGRADE)["applied"], [UPGRADE["migrationId"]])
        self.assertIn("vnext_start_desktop_session_challenge", state_sql(UPGRADE))
    def test_skip(self):
        self.assertEqual(apply_control_plane_m23(Fake([__import__('json').dumps(READY)]), UPGRADE)["skipped"], [UPGRADE["migrationId"]])
        self.assertEqual(apply_control_plane_m23(Fake([__import__('json').dumps({**READY, "ledgerCount": 24})]), UPGRADE)["skipped"], [UPGRADE["migrationId"]])
    def test_reject_partial(self):
        with self.assertRaisesRegex(RuntimeError, "M23_STATE_INVALID"):
            apply_control_plane_m23(Fake([__import__('json').dumps({**READY, "publicFunctions": True})]), UPGRADE)
    def test_reject_config(self):
        with self.assertRaisesRegex(RuntimeError, "M23_CONFIG_INVALID"):
            validate_upgrade({**UPGRADE, "semanticVersion": 22})

if __name__ == '__main__': unittest.main()
