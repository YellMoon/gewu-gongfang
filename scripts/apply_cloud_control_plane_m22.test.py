import unittest
from apply_cloud_control_plane_m22 import apply_control_plane_m22, state_sql, validate_upgrade
UPGRADE = {"sql": "\\set ON_ERROR_STOP on\nSELECT 1;", "migrationCount": 1, "migrationId": "vnext-pg17-desktop-canonical-phone-reader-22", "semanticVersion": 22, "manifestSha256": "a" * 64}
class Fake:
    def __init__(self, states): self.states=list(states); self.calls=[]
    def run(self, sql):
        self.calls.append(sql)
        return self.states.pop(0) if "json_build_object" in sql else ""
class Tests(unittest.TestCase):
    def test_state_and_apply(self):
        self.assertIn("vnext_verified_contacts", state_sql(UPGRADE))
        fake=Fake(['{"ledgerCount":21,"targetCount":0,"readerPrivilege":false}','{"ledgerCount":22,"targetCount":1,"readerPrivilege":true}'])
        self.assertEqual(apply_control_plane_m22(fake,UPGRADE)["applied"],[UPGRADE["migrationId"]])
    def test_skip_and_drift(self):
        self.assertEqual(apply_control_plane_m22(Fake(['{"ledgerCount":22,"targetCount":1,"readerPrivilege":true}']),UPGRADE)["skipped"],[UPGRADE["migrationId"]])
        with self.assertRaisesRegex(RuntimeError,"M22_STATE_INVALID"): apply_control_plane_m22(Fake(['{"ledgerCount":22,"targetCount":1,"readerPrivilege":false}']),UPGRADE)
        with self.assertRaisesRegex(RuntimeError,"M22_CONFIG_INVALID"): validate_upgrade({**UPGRADE,"semanticVersion":21})
if __name__ == "__main__": unittest.main()
