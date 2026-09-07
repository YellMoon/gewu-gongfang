import unittest
from verify_cloud_schedule_snapshot_recovery import validate_probe_receipt


class RecoveryShadowReceiptTests(unittest.TestCase):
    def receipt(self):
        return {"ok": True, "productionWrite": False, "fullBackupRestored": True, "ownershipAndPrivilegesVerified": True,
                "database": "gewu_snapshot_shadow_" + "a" * 16, "planSha256": "b" * 64, "backupSha256": "c" * 64,
                "candidateCount": 158, "applied": 158, "rolledBack": 158, "persistentReceiptCount": 1,
                "freshConnectionRetryVerified": True, "failedReceiptWriteRolledBack": True,
                "failedRollbackReceiptRolledBack": True, "nonRecoveryDataUnchanged": True, "rollbackChangedVersionsOnly": True}

    def validate(self, value):
        return validate_probe_receipt(value, "gewu_snapshot_shadow_" + "a" * 16, "b" * 64, "c" * 64, 158)

    def test_complete_receipt(self):
        self.validate(self.receipt())

    def test_rejects_wrong_scope_counts_or_any_missing_check(self):
        changes = {"database": "gewu_cloud", "productionWrite": True, "fullBackupRestored": False, "ownershipAndPrivilegesVerified": False,
                   "planSha256": "d" * 64, "backupSha256": "d" * 64, "candidateCount": 0,
                   "applied": 157, "rolledBack": 157, "persistentReceiptCount": 0,
                   "freshConnectionRetryVerified": False, "failedReceiptWriteRolledBack": False,
                   "failedRollbackReceiptRolledBack": False, "nonRecoveryDataUnchanged": False, "rollbackChangedVersionsOnly": False}
        for key, changed in changes.items():
            with self.subTest(key=key):
                value = self.receipt()
                value[key] = changed
                with self.assertRaisesRegex(RuntimeError, "SHADOW_PROBE_RECEIPT_INVALID"):
                    self.validate(value)


if __name__ == "__main__":
    unittest.main()
