import json
import unittest
from apply_cloud_control_plane_m30 import apply_control_plane_m30, load_upgrade, validate_upgrade

UPGRADE = {"sql": "\\set ON_ERROR_STOP on\nSELECT 1;", "migrationCount": 1, "migrationId": "vnext-pg17-miniapp-account-fence-30", "semanticVersion": 30, "manifestSha256": "a" * 64, "stateSql": "WITH expected AS (SELECT 1) SELECT 1;"}
PENDING = {"ledgerCount": 29, "prefixValid": True, "targetCount": 0, "functionCount": 0, "metadataValid": False}
READY = {"ledgerCount": 30, "prefixValid": True, "targetCount": 1, "functionCount": 1, "metadataValid": True}
class Fake:
    def __init__(self, states):
        self.states, self.calls = list(states), []
    def run(self, sql):
        self.calls.append(sql)
        return self.states.pop(0)
class Tests(unittest.TestCase):
    def test_apply_and_verify(self):
        executor = Fake([json.dumps(PENDING), "", json.dumps(READY)])
        self.assertEqual(apply_control_plane_m30(executor, UPGRADE), {"applied": [UPGRADE["migrationId"]], "skipped": []})
        self.assertEqual(executor.calls[1], UPGRADE["sql"])
        self.assertIn("ROLLBACK;", executor.calls[0])
    def test_verified_skip_including_future(self):
        for count in (30, 31):
            executor = Fake([json.dumps({**READY, "ledgerCount": count})])
            self.assertEqual(apply_control_plane_m30(executor, UPGRADE)["skipped"], [UPGRADE["migrationId"]])
            self.assertEqual(len(executor.calls), 1)
    def test_refuse_drift_partial_and_malformed(self):
        for mutation in ({"prefixValid": False}, {"metadataValid": False}, {"functionCount": 2}, {"targetCount": 0}, {"ledgerCount": True}, {"prefixValid": 1}):
            executor = Fake([json.dumps({**READY, **mutation})])
            with self.subTest(mutation=mutation), self.assertRaisesRegex(RuntimeError, "M30_STATE_INVALID"):
                apply_control_plane_m30(executor, UPGRADE)
            self.assertEqual(len(executor.calls), 1)
    def test_postcheck_failure(self):
        with self.assertRaisesRegex(RuntimeError, "M30_VERIFICATION_FAILED"):
            apply_control_plane_m30(Fake([json.dumps(PENDING), "", json.dumps({**READY, "metadataValid": False})]), UPGRADE)
    def test_loader_and_validation(self):
        actual = validate_upgrade(load_upgrade())
        self.assertIn("has_table_privilege", actual["stateSql"])
        with self.assertRaisesRegex(RuntimeError, "M30_CONFIG_INVALID"):
            validate_upgrade({**UPGRADE, "semanticVersion": 29})
if __name__ == '__main__':
    unittest.main()
